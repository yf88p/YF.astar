// Package render formats tasks for terminals without performing any I/O.
package render

import (
	"fmt"
	"strings"
	"time"

	"kanban/internal/model"
)

// Options controls layout and optional SGR styling. Width defaults to 80 when
// nonpositive and is bounded to 2..180 cells. Color never changes the layout.
type Options struct {
	Width      int
	Color      bool
	SelectedID string
}

type line struct {
	text  string
	style string
}

func (o Options) width() int {
	if o.Width <= 0 {
		return 80
	}
	return min(180, max(2, o.Width))
}

func (o Options) paint(text, style string) string {
	if !o.Color || style == "" || text == "" {
		return text
	}
	return "\x1b[" + style + "m" + text + "\x1b[0m"
}

func (o Options) selected(task model.Task) bool {
	return o.SelectedID != "" && o.SelectedID == task.ID
}

func statusStyle(status string) string {
	switch status {
	case "todo":
		return "33"
	case "doing":
		return "36"
	case "done":
		return "32"
	}
	return "2"
}

func priorityStyle(priority string) string {
	switch priority {
	case "urgent":
		return "1;31"
	case "high":
		return "33"
	case "medium":
		return "36"
	}
	return "2"
}

func safeTask(task model.Task) model.Task {
	task.ID = sanitize(task.ID, false)
	task.Title = sanitize(task.Title, false)
	task.Description = sanitize(task.Description, true)
	task.Status = sanitize(task.Status, false)
	task.Priority = sanitize(task.Priority, false)
	task.Due = sanitize(task.Due, false)
	tags := make([]string, len(task.Tags))
	for i, tag := range task.Tags {
		tags[i] = sanitize(tag, false)
	}
	task.Tags = tags
	return task
}

func value(text string) string {
	if strings.TrimSpace(text) == "" {
		return "-"
	}
	return text
}

func tagsText(tags []string) string {
	var result []string
	for _, tag := range tags {
		if strings.TrimSpace(tag) != "" {
			result = append(result, "#"+tag)
		}
	}
	return value(strings.Join(result, " "))
}

func appendWrapped(lines []line, text string, width int, style string) []line {
	for _, text := range wrap(text, width) {
		lines = append(lines, line{text, style})
	}
	return lines
}

func writeLines(out *strings.Builder, lines []line, opts Options) {
	for _, row := range lines {
		out.WriteString(opts.paint(row.text, row.style))
		out.WriteByte('\n')
	}
}

func introduction(out *strings.Builder, title string, count int, opts Options) {
	noun := "tasks"
	if count == 1 {
		noun = "task"
	}
	writeLines(out, appendWrapped(nil, fmt.Sprintf("%s / %d %s", title, count, noun), opts.width(), "1"), opts)
	out.WriteByte('\n')
}

func emptyHint(out *strings.Builder, opts Options) {
	writeLines(out, appendWrapped(nil, "No tasks yet. Start with:\nkanban add \"Task title\"", opts.width(), "2"), opts)
}

// List renders aligned columns at widths of at least 72 cells, or stacked cards
// on smaller terminals. Titles and tags wrap rather than being truncated.
func List(tasks []model.Task, opts Options) string {
	var out strings.Builder
	width := opts.width()
	introduction(&out, "TASKS", len(tasks), opts)
	if len(tasks) == 0 {
		emptyHint(&out, opts)
		return out.String()
	}
	if width < 72 {
		for i, task := range tasks {
			if i > 0 {
				out.WriteByte('\n')
			}
			writeLines(&out, card(task, width, opts, true), opts)
		}
		return out.String()
	}

	widths := []int{8, 6, 8, 10, width - 42}
	headers := []string{"ID", "STATUS", "PRIORITY", "DUE", "TITLE / TAGS"}
	out.WriteString("  ")
	for i, header := range headers {
		if i > 0 {
			out.WriteString("  ")
		}
		if i < len(headers)-1 {
			header = pad(header, widths[i])
		}
		out.WriteString(opts.paint(header, "1"))
	}
	out.WriteByte('\n')
	out.WriteString(opts.paint(strings.Repeat("-", width), "2"))
	out.WriteByte('\n')
	for _, original := range tasks {
		task := safeTask(original)
		fields := []string{value(task.ID), value(task.Status), value(task.Priority), value(task.Due), value(task.Title)}
		styles := []string{"2", statusStyle(task.Status), priorityStyle(task.Priority), "", ""}
		selected := opts.selected(original)
		if selected {
			styles[0], styles[4] = "1;36", "1"
		}
		columns := make([][]string, len(fields))
		height := 0
		for i, field := range fields {
			columns[i] = wrap(field, widths[i])
			height = max(height, len(columns[i]))
		}
		titleHeight := len(columns[4])
		if tags := tagsText(task.Tags); tags != "-" {
			columns[4] = append(columns[4], wrap(tags, widths[4])...)
			height = max(height, len(columns[4]))
		}
		for row := 0; row < height; row++ {
			if selected && row == 0 {
				out.WriteString(opts.paint("> ", "1;36"))
			} else {
				out.WriteString("  ")
			}
			for col, column := range columns {
				text := ""
				if row < len(column) {
					text = column[row]
				}
				if col > 0 {
					out.WriteString("  ")
				}
				if col < len(columns)-1 {
					text = pad(text, widths[col])
				}
				style := styles[col]
				if col == 4 && row >= titleHeight {
					style = "2"
				}
				out.WriteString(opts.paint(text, style))
			}
			out.WriteByte('\n')
		}
	}
	return out.String()
}

func card(original model.Task, width int, opts Options, showStatus bool) []line {
	task := safeTask(original)
	indent := "  "
	if width < 6 {
		indent = ""
	}
	var lines []line
	add := func(text, style string) {
		for _, text := range wrap(text, width-len(indent)) {
			lines = append(lines, line{indent + text, style})
		}
	}
	add(value(task.ID), "1")
	if opts.selected(original) {
		if indent == "" {
			lines = append([]line{{">", "1;36"}}, lines...)
		} else {
			lines[0] = line{"> " + strings.TrimPrefix(lines[0].text, indent), "1;36"}
		}
	}
	add(value(task.Title), "")
	if showStatus {
		add("Status: "+value(task.Status), statusStyle(task.Status))
	}
	add("Priority: "+value(task.Priority), priorityStyle(task.Priority))
	add("Due: "+value(task.Due), "2")
	add("Tags: "+tagsText(task.Tags), "2")
	return lines
}

// Board renders three lanes from 72 cells upward, otherwise vertically stacked
// lanes. Unknown statuses appear in an Other lane rather than disappearing.
func Board(tasks []model.Task, opts Options) string {
	var out strings.Builder
	width := opts.width()
	introduction(&out, "KANBAN", len(tasks), opts)
	groups := make([][]model.Task, 4)
	for _, task := range tasks {
		index := 3
		switch task.Status {
		case "todo":
			index = 0
		case "doing":
			index = 1
		case "done":
			index = 2
		}
		groups[index] = append(groups[index], task)
	}
	names := []string{"Todo", "Doing", "Done", "Other"}
	styles := []string{"33", "36", "32", "2"}
	lane := func(index, laneWidth int) []line {
		lines := appendWrapped(nil, fmt.Sprintf("%s (%d)", names[index], len(groups[index])), laneWidth, "1;"+styles[index])
		lines = append(lines, line{strings.Repeat("-", laneWidth), "2"})
		if len(groups[index]) == 0 {
			return appendWrapped(lines, "No tasks", laneWidth, "2")
		}
		for i, task := range groups[index] {
			if i > 0 {
				lines = append(lines, line{})
			}
			lines = append(lines, card(task, laneWidth, opts, index == 3)...)
		}
		return lines
	}
	if width >= 72 {
		widths := []int{(width - 6) / 3, (width - 6) / 3, 0}
		widths[2] = width - 6 - widths[0] - widths[1]
		lanes := [][]line{lane(0, widths[0]), lane(1, widths[1]), lane(2, widths[2])}
		for row, height := 0, max(len(lanes[0]), len(lanes[1]), len(lanes[2])); row < height; row++ {
			for col, rows := range lanes {
				if col > 0 {
					out.WriteString(opts.paint(" | ", "2"))
				}
				var cell line
				if row < len(rows) {
					cell = rows[row]
				}
				out.WriteString(opts.paint(pad(cell.text, widths[col]), cell.style))
			}
			out.WriteByte('\n')
		}
	} else {
		for index := 0; index < 3; index++ {
			if index > 0 {
				out.WriteByte('\n')
			}
			writeLines(&out, lane(index, width), opts)
		}
	}
	if len(groups[3]) > 0 {
		out.WriteByte('\n')
		writeLines(&out, lane(3, width), opts)
	}
	if len(tasks) == 0 {
		out.WriteByte('\n')
		emptyHint(&out, opts)
	}
	return out.String()
}

// Details renders every field, retaining description paragraphs and indentation.
// User-supplied newlines are allowed only within the indented description area.
func Details(original model.Task, opts Options) string {
	var out strings.Builder
	width := opts.width()
	task := safeTask(original)
	header := "TASK DETAILS"
	if opts.selected(original) {
		header = "> " + header
	}
	writeLines(&out, appendWrapped(nil, header, width, "1;36"), opts)
	out.WriteByte('\n')
	stamp := func(t time.Time) string {
		if t.IsZero() {
			return "-"
		}
		return t.Format(time.RFC3339Nano)
	}
	fields := []struct{ label, text, style string }{
		{"ID", value(task.ID), ""},
		{"Title", value(task.Title), "1"},
		{"Status", value(task.Status), statusStyle(task.Status)},
		{"Priority", value(task.Priority), priorityStyle(task.Priority)},
		{"Due", value(task.Due), ""},
		{"Tags", tagsText(task.Tags), ""},
		{"Created", stamp(task.CreatedAt), "2"},
		{"Updated", stamp(task.UpdatedAt), "2"},
		{"Description", value(task.Description), ""},
	}
	for _, field := range fields {
		if width < 32 {
			writeLines(&out, appendWrapped(nil, field.label+":", width, "1"), opts)
			indent := "  "
			if width < 6 {
				indent = ""
			}
			for _, text := range wrap(field.text, width-len(indent)) {
				out.WriteString(indent + opts.paint(text, field.style) + "\n")
			}
		} else {
			for i, text := range wrap(field.text, width-13) {
				label := strings.Repeat(" ", 13)
				if i == 0 {
					label = pad(field.label+":", 13)
				}
				out.WriteString(opts.paint(label, "1") + opts.paint(text, field.style) + "\n")
			}
		}
	}
	return out.String()
}
