// Package report renders the persisted run snapshot and worker states as Markdown.
package report

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/util"
	"automator/internal/worker"
)

// Write atomically refreshes report.md while holding worker.RunLockPath(runDir).
// Callers, including the executor, must release run and model transition locks
// before calling Write: the run lock is not reentrant. Run deletion must use the
// same lock. A missing/deleted run returns an error and is never recreated.
func Write(runDir string) error {
	if err := checkRunDir(runDir); err != nil {
		return err
	}
	unlock, err := persistence.Lock(context.Background(), worker.RunLockPath(runDir))
	if err != nil {
		return err
	}
	defer unlock()

	// Load only after acquiring the lock, including when deletion won the race.
	var snapshot config.RunSnapshot
	if err := persistence.LoadYAML(filepath.Join(runDir, "run.yaml"), &snapshot); err != nil {
		return err
	}
	states, err := LoadStates(runDir)
	if err != nil {
		return err
	}
	hasLegacyTokens := false
	for _, state := range states {
		if state.InputTokens != nil && state.CacheReadTokens == nil && state.ReasoningTokens == nil {
			hasLegacyTokens = true
			break
		}
	}
	inputHeader := "Input (cache miss)"
	if hasLegacyTokens {
		inputHeader = "Input*"
	}
	var md strings.Builder
	fmt.Fprintf(&md, "# %s\n\n", snapshot.Name)
	fmt.Fprintf(&md, "| Model | Provider | Tool | Status | Duration | %s | Cache hit | Cache write | Output | Reasoning | Total Tokens | Cost | Project | Session |\n", inputHeader)
	md.WriteString("|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|\n")
	for _, state := range states {
		status := string(state.Status)
		if status != "" {
			status = strings.ToUpper(status[:1]) + status[1:]
		}
		session := ""
		if state.NativeSessionID != nil {
			session = *state.NativeSessionID
		}
		fmt.Fprintf(&md, "| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n",
			state.Model, state.Provider, state.Tool, status, fmtDuration(state.DurationSeconds),
			optUint(state.InputTokens), optUint(state.CacheReadTokens), optUint(state.CacheWriteTokens),
			optUint(state.OutputTokens), optUint(state.ReasoningTokens), optUint(state.TotalTokens),
			fmtCost(state.Cost), relativeProject(runDir, state.ProjectPath), session)
	}
	if hasLegacyTokens {
		md.WriteString("\n* Legacy Input can include cache and reasoning tokens because the original state predates separate token fields.\n")
	}
	md.WriteString("\n## Reopen\n\n")
	session := snapshot.HerdrSession
	if session == "" {
		session = "Automator"
	}
	fmt.Fprintf(&md, "- herdr: `herdr session attach %s`\n", util.ShellQuote(session))
	for _, state := range states {
		fmt.Fprintf(&md, "- %s tool session: `%s`\n", state.Model, state.NativeReopen)
		if state.HerdrAttach != nil {
			fmt.Fprintf(&md, "- %s herdr: `%s`\n", state.Model, *state.HerdrAttach)
		}
	}

	// WriteFile creates parents, so never invoke it for a vanished run.
	if err := checkRunDir(runDir); err != nil {
		return err
	}
	path := filepath.Join(runDir, "report.md")
	mode := os.FileMode(0600)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	return persistence.WriteFile(path, []byte(md.String()), mode)
}

func checkRunDir(runDir string) error {
	info, err := os.Stat(runDir)
	if err != nil {
		return fmt.Errorf("stat run %s: %w", runDir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("run path is not a directory: %s", runDir)
	}
	return nil
}

// LoadStates reads only .yaml entries in .automator/state, sorted by model.
// A missing state directory is empty; malformed or unreadable states are errors.
// It does not acquire locks or create files. Atomic state writes make each read
// consistent; callers needing a run-wide snapshot can hold the run lock.
func LoadStates(runDir string) ([]worker.State, error) {
	states := make([]worker.State, 0)
	entries, err := os.ReadDir(filepath.Join(runDir, ".automator", "state"))
	if errors.Is(err, os.ErrNotExist) {
		return states, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".yaml" || entry.Name() == ".yaml" {
			continue
		}
		var state worker.State
		if err := persistence.LoadYAML(filepath.Join(runDir, ".automator", "state", entry.Name()), &state); err != nil {
			return nil, err
		}
		states = append(states, state)
	}
	sort.SliceStable(states, func(i, j int) bool { return states[i].Model < states[j].Model })
	return states, nil
}

// Print resolves a run name or path, prints the report path, then its contents if
// present. Like the Rust CLI, it adds a newline after the contents, even when the
// report already ends in one. It does not generate or refresh the report.
func Print(run string) error {
	dir, err := config.FindRun(run)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, "report.md")
	if _, err := fmt.Fprintln(os.Stdout, path); err != nil {
		return err
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if !utf8.Valid(data) {
		return fmt.Errorf("read %s: invalid UTF-8", path)
	}
	_, err = fmt.Fprintln(os.Stdout, string(data))
	return err
}

func optUint(value *uint64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatUint(*value, 10)
}

func fmtCost(value *float64) string {
	if value == nil {
		return ""
	}
	// Rust uses lowercase infinities, without Go's leading plus sign.
	if math.IsInf(*value, 1) {
		return "$inf"
	}
	if math.IsInf(*value, -1) {
		return "$-inf"
	}
	return fmt.Sprintf("$%.4f", *value)
}

func fmtDuration(value *uint64) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%dm %ds", *value/60, *value%60)
}

func relativeProject(base, path string) string {
	// Match Rust's component-wise strip_prefix, not filepath.Rel: do not resolve
	// '..' or symlinks, and retain the spelling of the remaining path.
	components := func(path string) [][2]int {
		var spans [][2]int
		start := 0
		for i := 0; i <= len(path); i++ {
			if i < len(path) && !os.IsPathSeparator(path[i]) {
				continue
			}
			if i == 0 && len(path) > 0 {
				spans = append(spans, [2]int{0, 1})
			}
			if i > start && (path[start:i] != "." || start == 0) {
				spans = append(spans, [2]int{start, i})
			}
			start = i + 1
		}
		return spans
	}
	b, p := components(base), components(path)
	if len(b) > len(p) {
		return path
	}
	for i, span := range b {
		if base[span[0]:span[1]] != path[p[i][0]:p[i][1]] {
			return path
		}
	}
	if len(b) == len(p) {
		return "./"
	}
	return "./" + path[p[len(b)][0]:p[len(p)-1][1]]
}
