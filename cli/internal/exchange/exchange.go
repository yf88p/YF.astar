// Package exchange imports, exports, and transactionally merges kanban boards.
package exchange

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"kanban/internal/model"
)

const maxInputSize = 32 << 20

func Decode(r io.Reader) (model.Board, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxInputSize+1))
	if err != nil {
		return model.Board{}, fmt.Errorf("read board: %w", err)
	}
	if len(data) > maxInputSize {
		return model.Board{}, fmt.Errorf("board JSON exceeds 32 MiB")
	}
	if !json.Valid(data) {
		return model.Board{}, fmt.Errorf("board must contain exactly one valid JSON value")
	}
	if err := validateJSONText(data); err != nil {
		return model.Board{}, err
	}
	fields, err := decodeObject(data, []string{"version", "tasks"})
	if err != nil {
		return model.Board{}, fmt.Errorf("board: %w", err)
	}
	board := model.NewBoard()
	if err := json.Unmarshal(fields["version"], &board.Version); err != nil {
		return model.Board{}, fmt.Errorf("version: %w", err)
	}
	var tasks []json.RawMessage
	if err := json.Unmarshal(fields["tasks"], &tasks); err != nil {
		return model.Board{}, fmt.Errorf("tasks: %w", err)
	}
	for i, raw := range tasks {
		if _, err := decodeObject(raw, []string{
			"id", "title", "description", "status", "priority", "tags", "created_at", "updated_at",
		}, "due"); err != nil {
			return model.Board{}, fmt.Errorf("task %d: %w", i+1, err)
		}
		var task model.Task
		if err := json.Unmarshal(raw, &task); err != nil {
			return model.Board{}, fmt.Errorf("task %d: %w", i+1, err)
		}
		board.Tasks = append(board.Tasks, task)
	}
	if err := model.ValidateBoard(board); err != nil {
		return model.Board{}, fmt.Errorf("board: %w", err)
	}
	return board, nil
}

// decodeObject enforces exact field names, required fields, and no duplicate or
// null fields. encoding/json otherwise accepts duplicates and case-folded names.
func decodeObject(data []byte, required []string, optional ...string) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	if token != json.Delim('{') {
		return nil, fmt.Errorf("expected an object")
	}
	fields := make(map[string]json.RawMessage, len(required)+len(optional))
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		name, ok := token.(string)
		if !ok || !(slices.Contains(required, name) || slices.Contains(optional, name)) {
			return nil, fmt.Errorf("unknown field %q", token)
		}
		if _, exists := fields[name]; exists {
			return nil, fmt.Errorf("duplicate field %q", name)
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, err
		}
		if bytes.Equal(value, []byte("null")) {
			return nil, fmt.Errorf("field %q must not be null", name)
		}
		fields[name] = value
	}
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	for _, name := range required {
		if _, exists := fields[name]; !exists {
			return nil, fmt.Errorf("missing field %q", name)
		}
	}
	return fields, nil
}

func validateJSONText(data []byte) error {
	if !utf8.Valid(data) {
		return fmt.Errorf("board JSON must be valid UTF-8")
	}
	// JSON syntax has already been checked. Reject unpaired UTF-16 escapes
	// rather than letting encoding/json silently replace them with U+FFFD.
	for i := 0; i < len(data); i++ {
		if data[i] != '\\' {
			continue
		}
		i++
		if data[i] != 'u' {
			continue
		}
		r, _ := strconv.ParseUint(string(data[i+1:i+5]), 16, 16)
		i += 4
		if r >= 0xD800 && r <= 0xDBFF {
			if i+6 >= len(data) || data[i+1] != '\\' || data[i+2] != 'u' {
				return fmt.Errorf("board JSON contains an unpaired Unicode surrogate")
			}
			low, err := strconv.ParseUint(string(data[i+3:i+7]), 16, 16)
			if err != nil || low < 0xDC00 || low > 0xDFFF {
				return fmt.Errorf("board JSON contains an unpaired Unicode surrogate")
			}
			i += 6
		} else if r >= 0xDC00 && r <= 0xDFFF {
			return fmt.Errorf("board JSON contains an unpaired Unicode surrogate")
		}
	}
	return nil
}

func JSON(w io.Writer, board model.Board) error {
	if err := model.ValidateBoard(board); err != nil {
		return fmt.Errorf("board: %w", err)
	}
	// Export empty collections as arrays, without changing the caller's board.
	tasks := make([]model.Task, len(board.Tasks))
	copy(tasks, board.Tasks)
	for i := range tasks {
		// UTC also preserves instants for time zones with sub-minute offsets,
		// which RFC3339 cannot encode directly.
		tasks[i].CreatedAt = tasks[i].CreatedAt.UTC()
		tasks[i].UpdatedAt = tasks[i].UpdatedAt.UTC()
		if tasks[i].Tags == nil {
			tasks[i].Tags = []string{}
		}
	}
	board.Tasks = tasks
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(board); err != nil {
		return fmt.Errorf("write board JSON: %w", err)
	}
	return nil
}

func Markdown(w io.Writer, board model.Board) error {
	if err := model.ValidateBoard(board); err != nil {
		return fmt.Errorf("board: %w", err)
	}
	var out strings.Builder
	out.WriteString("# Kanban Board\n")
	for _, group := range []struct{ status, heading string }{
		{"todo", "Todo"}, {"doing", "Doing"}, {"done", "Done"},
	} {
		fmt.Fprintf(&out, "\n## %s\n\n", group.heading)
		count := 0
		for _, task := range board.Tasks {
			if task.Status != group.status {
				continue
			}
			count++
			check := " "
			if task.Status == "done" {
				check = "x"
			}
			fmt.Fprintf(&out, "- [%s] %s\n", check, escapeMarkdown(task.Title))
			fmt.Fprintf(&out, "  - ID: `%s`\n  - Priority: %s\n", task.ID, task.Priority)
			if len(task.Tags) > 0 {
				tags := make([]string, len(task.Tags))
				for i, tag := range task.Tags {
					tags[i] = escapeMarkdown(tag)
				}
				fmt.Fprintf(&out, "  - Tags: %s\n", strings.Join(tags, ", "))
			}
			if task.Due != "" {
				fmt.Fprintf(&out, "  - Due: %s\n", task.Due)
			}
			fmt.Fprintf(&out, "  - Created: %s\n  - Updated: %s\n",
				task.CreatedAt.UTC().Format(time.RFC3339Nano), task.UpdatedAt.UTC().Format(time.RFC3339Nano))
			if task.Description != "" {
				out.WriteString("\n")
				for _, line := range strings.Split(task.Description, "\n") {
					// Block quotes retain blank lines and hard breaks without
					// allowing descriptions to create headings or list items.
					fmt.Fprintf(&out, "  > %s  \n", escapeMarkdown(line))
				}
			}
			out.WriteString("\n")
		}
		if count == 0 {
			out.WriteString("No tasks.\n")
		}
	}
	if _, err := io.WriteString(w, out.String()); err != nil {
		return fmt.Errorf("write board Markdown: %w", err)
	}
	return nil
}

func escapeMarkdown(text string) string {
	var out strings.Builder
	leading := true
	for _, r := range text {
		if r == ' ' && !leading {
			out.WriteRune(r)
			continue
		}
		if r != ' ' && r != '\t' {
			leading = false
		}
		switch r {
		case '&':
			out.WriteString("&amp;")
		case '<':
			out.WriteString("&lt;")
		case '>':
			out.WriteString("&gt;")
		case '\t', ' ':
			// Leading whitespace must not turn untrusted text into code blocks.
			if r == '\t' {
				out.WriteString("&#9;")
			} else {
				out.WriteString("&#32;")
			}
		default:
			if strings.ContainsRune("\\`*_{}[]()#+-.!|~\"':=/", r) {
				out.WriteByte('\\')
			}
			out.WriteRune(r)
		}
	}
	return out.String()
}

// Merge validates and checks every collision before committing any additions.
// Tag order is significant; timestamps are compared by instant, not location.
func Merge(dst *model.Board, src model.Board) (added, skipped int, err error) {
	if dst == nil {
		return 0, 0, fmt.Errorf("destination board must not be nil")
	}
	if err := model.ValidateBoard(*dst); err != nil {
		return 0, 0, fmt.Errorf("destination board: %w", err)
	}
	if err := model.ValidateBoard(src); err != nil {
		return 0, 0, fmt.Errorf("source board: %w", err)
	}
	byID := make(map[string]model.Task, len(dst.Tasks))
	for _, task := range dst.Tasks {
		byID[task.ID] = task
	}
	var additions []model.Task
	for _, task := range src.Tasks {
		if existing, exists := byID[task.ID]; exists {
			if existing.Title != task.Title ||
				existing.Description != task.Description || existing.Status != task.Status ||
				existing.Priority != task.Priority || !slices.Equal(existing.Tags, task.Tags) ||
				existing.Due != task.Due || !existing.CreatedAt.Equal(task.CreatedAt) ||
				!existing.UpdatedAt.Equal(task.UpdatedAt) {
				return 0, 0, fmt.Errorf("task ID %q has conflicting data", task.ID)
			}
			skipped++
			continue
		}
		task.Tags = slices.Clone(task.Tags)
		additions = append(additions, task)
	}
	if len(additions) > 0 {
		// Allocate a new backing array even when dst and src share storage.
		tasks := make([]model.Task, 0, len(dst.Tasks)+len(additions))
		tasks = append(tasks, dst.Tasks...)
		dst.Tasks = append(tasks, additions...)
	}
	return len(additions), skipped, nil
}
