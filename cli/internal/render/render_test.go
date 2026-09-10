package render

import (
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"

	"kanban/internal/model"
)

var sgr = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func sampleTasks() []model.Task {
	created := time.Date(2026, 9, 7, 10, 11, 12, 123000000, time.UTC)
	return []model.Task{
		{ID: "1234abcd", Title: "Ship a thoughtful terminal experience with every word intact", Status: "todo", Priority: "urgent", Tags: []string{"release", "terminal"}, Due: "2026-09-10", Description: "First paragraph.\n\nSecond paragraph.\n  Indented line.\n\tTabbed line.", CreatedAt: created, UpdatedAt: created.Add(time.Hour)},
		{ID: "abcd1234", Title: "Review layout", Status: "doing", Priority: "medium", Tags: []string{"design"}},
		{ID: "deadbeef", Title: "Write tests", Status: "done", Priority: "low"},
	}
}

func checkWidth(t *testing.T, output string, width int) {
	t.Helper()
	if !utf8.ValidString(output) {
		t.Fatal("output is not valid UTF-8")
	}
	if !strings.HasSuffix(output, "\n") {
		t.Error("missing final newline")
	}
	for i, row := range strings.Split(sgr.ReplaceAllString(output, ""), "\n") {
		if got := displayWidth(row); got > width {
			t.Errorf("row %d width %d exceeds %d: %q", i, got, width, row)
		}
	}
}

func TestLayouts(t *testing.T) {
	tasks := sampleTasks()
	tasks[0].Title += " \u4e16\u754c e\u0301 \U0001f469\u200d\U0001f4bb " + strings.Repeat("longword", 20)
	for _, width := range []int{2, 3, 5, 6, 12, 24, 40, 71, 72, 80, 120, 180, 1000000, 0, -5} {
		for _, color := range []bool{false, true} {
			opts := Options{Width: width, Color: color, SelectedID: tasks[0].ID}
			for name, output := range map[string]string{"list": List(tasks, opts), "board": Board(tasks, opts), "details": Details(tasks[0], opts)} {
				t.Run(fmt.Sprintf("%s/width=%d/color=%t", name, width, color), func(t *testing.T) {
					checkWidth(t, output, opts.width())
					if strings.Contains(output, "\x1b") != color {
						t.Error("ANSI styling does not match Color")
					}
					if strings.Contains(sgr.ReplaceAllString(output, ""), "\x1b") {
						t.Error("non-SGR escape in output")
					}
				})
			}
		}
	}
}

func TestListColumnsAndFullTitle(t *testing.T) {
	tasks := sampleTasks()
	output := List(tasks, Options{Width: 80, SelectedID: tasks[0].ID})
	rows := strings.Split(output, "\n")
	wantHeader := "  ID        STATUS  PRIORITY  DUE         TITLE / TAGS"
	if rows[2] != wantHeader {
		t.Fatalf("header = %q, want %q", rows[2], wantHeader)
	}
	if !strings.HasPrefix(rows[4], "> 1234abcd  todo    urgent    2026-09-10  ") {
		t.Fatalf("misaligned selected row: %q", rows[4])
	}
	var title []string
	for _, row := range rows[4:] {
		if strings.Contains(row, tasks[1].ID) {
			break
		}
		if len(row) >= 42 && !strings.HasPrefix(row[42:], "#") {
			title = append(title, strings.TrimSpace(row[42:]))
		}
	}
	if got := strings.Join(title, " "); got != tasks[0].Title {
		t.Errorf("wrapped title = %q, want %q", got, tasks[0].Title)
	}
	for _, text := range []string{"3 tasks", "#release #terminal", "abcd1234", "deadbeef"} {
		if !strings.Contains(output, text) {
			t.Errorf("missing %q", text)
		}
	}
	for _, text := range []string{"Status: todo", "Priority: urgent", "Due: 2026-09-10", "Tags: #release"} {
		if narrow := List(tasks, Options{Width: 30}); !strings.Contains(narrow, text) {
			t.Errorf("narrow list missing %q:\n%s", text, narrow)
		}
	}
}

func TestBoardLanesAndSelection(t *testing.T) {
	tasks := sampleTasks()
	wide := Board(tasks, Options{Width: 100, SelectedID: tasks[1].ID})
	rows := strings.Split(wide, "\n")
	for _, lane := range []string{"Todo (1)", "Doing (1)", "Done (1)"} {
		if !strings.Contains(rows[2], lane) {
			t.Errorf("missing lane %q on header row: %q", lane, rows[2])
		}
	}
	for _, text := range []string{"3 tasks", "1234abcd", "> abcd1234", "deadbeef", "Priority: urgent", "Due: 2026-09-10", "#release", "#terminal"} {
		if !strings.Contains(wide, text) {
			t.Errorf("missing %q:\n%s", text, wide)
		}
	}
	if strings.Count(wide, "> ") != 1 {
		t.Error("selection must mark exactly one task")
	}
	narrow := Board(tasks, Options{Width: 40})
	if strings.Contains(narrow, " | ") || strings.Contains(narrow, "> ") {
		t.Error("stacked, unselected board contains separators or selection")
	}
	if !(strings.Index(narrow, "Todo (1)") < strings.Index(narrow, "Doing (1)") && strings.Index(narrow, "Doing (1)") < strings.Index(narrow, "Done (1)")) {
		t.Error("stacked lanes are out of order")
	}
	tasks[0].Status = "unrecognized"
	if output := Board(tasks, Options{}); !strings.Contains(output, "Other (1)") || !strings.Contains(output, "Status: unrecognized") {
		t.Error("unvalidated status silently lost a task")
	}
}

func TestEmpty(t *testing.T) {
	for name, output := range map[string]string{"list": List(nil, Options{}), "board": Board(nil, Options{})} {
		for _, text := range []string{"0 tasks", "No tasks yet", `kanban add "Task title"`} {
			if !strings.Contains(output, text) {
				t.Errorf("%s missing %q", name, text)
			}
		}
	}
	for _, lane := range []string{"Todo (0)", "Doing (0)", "Done (0)"} {
		if !strings.Contains(Board(nil, Options{}), lane) {
			t.Errorf("empty board missing %q", lane)
		}
	}
}

func TestDetails(t *testing.T) {
	task := sampleTasks()[0]
	output := Details(task, Options{Width: 120, SelectedID: task.ID})
	for _, text := range []string{"> TASK DETAILS", task.ID, task.Title, task.Status, task.Priority, task.Due, "#release #terminal", "2026-09-07T10:11:12.123Z", "2026-09-07T11:11:12.123Z", "Description: First paragraph.\n             \n             Second paragraph.\n               Indented line.\n                 Tabbed line."} {
		if !strings.Contains(output, text) {
			t.Errorf("details missing %q:\n%s", text, output)
		}
	}
	narrow := Details(task, Options{Width: 24})
	for _, text := range []string{"Description:\n  First paragraph.\n  \n  Second paragraph.", "Title:\n", "Created:\n", "Updated:\n"} {
		if !strings.Contains(narrow, text) {
			t.Errorf("narrow details missing %q:\n%s", text, narrow)
		}
	}
	if output := Details(model.Task{}, Options{}); !strings.Contains(output, "Created:     -") || !strings.Contains(output, "Description: -") {
		t.Errorf("zero task placeholders missing:\n%s", output)
	}
}

func TestSanitizationAndColorParity(t *testing.T) {
	bad := "start\nFAKE\r\t\x00\x07\x08\x1b[2J\x1b[31m\x1b]0;owned\x07\u009b2J\u009d\u202e\u2066\u2028end\xff"
	task := model.Task{ID: bad, Title: bad, Description: bad, Status: bad, Priority: bad, Due: bad, Tags: []string{bad}}
	for _, width := range []int{24, 80, 180} {
		plainOpts := Options{Width: width, SelectedID: bad}
		colorOpts := plainOpts
		colorOpts.Color = true
		plain := []string{List([]model.Task{task}, plainOpts), Board([]model.Task{task}, plainOpts), Details(task, plainOpts)}
		colored := []string{List([]model.Task{task}, colorOpts), Board([]model.Task{task}, colorOpts), Details(task, colorOpts)}
		for i, output := range plain {
			checkWidth(t, output, width)
			for _, r := range output {
				if unicode.IsControl(r) && r != '\n' || unicode.Is(unicode.Cf, r) {
					t.Errorf("renderer %d leaked control %U", i, r)
				}
			}
			if strings.Contains(output, "\nFAKE") {
				t.Errorf("renderer %d allowed a forged row", i)
			}
			if got := sgr.ReplaceAllString(colored[i], ""); got != output {
				t.Errorf("renderer %d changed text/layout with Color", i)
			}
		}
	}
}

func TestNoMutation(t *testing.T) {
	tasks := sampleTasks()
	tasks[0].Tags[0] = "unsafe\nvalue"
	before := append([]model.Task(nil), tasks...)
	before[0].Tags = append([]string(nil), tasks[0].Tags...)
	List(tasks, Options{})
	Board(tasks, Options{})
	Details(tasks[0], Options{})
	if !reflect.DeepEqual(tasks, before) {
		t.Error("rendering mutated caller-owned tasks or tags")
	}
}

func TestDisplayWidthAndWrapping(t *testing.T) {
	for _, test := range []struct {
		text  string
		width int
	}{
		{"plain", 5}, {"e\u0301", 1}, {"\u4e16\u754c", 4}, {"\uff21", 2},
		{"\U0001f680", 2}, {"\U0001f44d\U0001f3fd", 2}, {"\U0001f1ec\U0001f1e7", 2},
		{"\U0001f469\u200d\U0001f4bb", 2}, {"\u2764\ufe0f", 2}, {"1\ufe0f\u20e3", 2},
		{"\u2705", 2}, {"\u231a", 2}, {"\u26a1", 2}, {"\U0001f004", 2},
		{"A\u200dB", 2}, {"\u4e16\u200d\u754c", 4}, {"\U0001f680\u200dA", 3},
	} {
		if got := displayWidth(test.text); got != test.width {
			t.Errorf("width(%q) = %d, want %d", test.text, got, test.width)
		}
		text := strings.Repeat(test.text, 12)
		for _, width := range []int{2, 3, 5, 12} {
			rows := wrap(text, width)
			if strings.Join(rows, "") != text {
				t.Errorf("wrap(%q, %d) lost content", text, width)
			}
			for _, row := range rows {
				if displayWidth(row) > width {
					t.Errorf("wrap(%q, %d) produced too-wide %q", text, width, row)
				}
				if len(cells(test.text)) == 1 && len(cells(row))*len(test.text) != len(row) {
					t.Errorf("split a grapheme in %q", row)
				}
			}
		}
	}
	if got := wrap("alpha beta gamma", 10); !reflect.DeepEqual(got, []string{"alpha beta", "gamma"}) {
		t.Errorf("word wrapping = %#v", got)
	}
}

func FuzzRender(f *testing.F) {
	for _, seed := range []string{"ordinary title", "\x1b[2J\r\n", "\u4e16\u754c\U0001f469\u200d\U0001f4bb", "\xff\u0301"} {
		f.Add(seed, 24)
	}
	f.Fuzz(func(t *testing.T, text string, width int) {
		opts := Options{Width: width}
		task := model.Task{ID: text, Title: text, Description: text, Status: text, Priority: text, Tags: []string{text}, Due: text}
		for _, output := range []string{List([]model.Task{task}, opts), Board([]model.Task{task}, opts), Details(task, opts)} {
			checkWidth(t, output, opts.width())
			for _, r := range output {
				if unicode.IsControl(r) && r != '\n' {
					t.Fatalf("leaked control %U", r)
				}
			}
		}
	})
}
