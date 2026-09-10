package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"kanban/internal/model"
	"kanban/internal/render"
	"kanban/internal/store"
)

type cliHarness struct {
	app    app
	path   string
	clock  time.Time
	out    bytes.Buffer
	errOut bytes.Buffer
}

func newCLIHarness(t *testing.T) *cliHarness {
	t.Helper()
	h := &cliHarness{
		path:  filepath.Join(t.TempDir(), "board.json"),
		clock: time.Date(2026, 9, 7, 12, 30, 0, 123, time.FixedZone("test", 2*60*60)),
	}
	h.app = app{
		in: strings.NewReader(""), out: &h.out, errOut: &h.errOut,
		getenv: func(key string) string {
			if key == "KANBAN_DB" {
				return h.path
			}
			return ""
		},
		now: func() time.Time { return h.clock }, display: render.Options{Width: 120},
	}
	return h
}

func (h *cliHarness) invoke(args ...string) error {
	h.out.Reset()
	h.errOut.Reset()
	return h.app.run(args)
}

func (h *cliHarness) mustRun(t *testing.T, args ...string) string {
	t.Helper()
	if err := h.invoke(args...); err != nil {
		t.Fatalf("run %q: %v\nstdout: %s\nstderr: %s", args, err, &h.out, &h.errOut)
	}
	if h.errOut.Len() != 0 {
		t.Fatalf("run %q wrote unexpected stderr: %s", args, &h.errOut)
	}
	return h.out.String()
}

func readCLIBytes(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func decodeCLIBoard(t *testing.T, data []byte) model.Board {
	t.Helper()
	var board model.Board
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&board); err != nil {
		t.Fatalf("decode board: %v\noutput: %s", err, data)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		t.Fatalf("board has trailing output: %v\noutput: %s", err, data)
	}
	if err := model.ValidateBoard(board); err != nil {
		t.Fatal(err)
	}
	return board
}

func (h *cliHarness) board(t *testing.T) model.Board {
	t.Helper()
	return decodeCLIBoard(t, readCLIBytes(t, h.path))
}

func assertCLIUnchanged(t *testing.T, path string, before []byte) {
	t.Helper()
	if after := readCLIBytes(t, path); !bytes.Equal(after, before) {
		t.Fatalf("board bytes changed:\nbefore: %s\nafter: %s", before, after)
	}
}

func assertCLIContains(t *testing.T, output string, parts ...string) {
	t.Helper()
	for _, part := range parts {
		if !strings.Contains(output, part) {
			t.Errorf("output missing %q:\n%s", part, output)
		}
	}
}

func TestCLIWorkflow(t *testing.T) {
	h := newCLIHarness(t)
	assertCLIContains(t, h.mustRun(t, "init"), "Initialized", h.path)
	if board := h.board(t); board.Version != 1 || len(board.Tasks) != 0 {
		t.Fatalf("new board = %#v", board)
	}
	h.mustRun(t, "add", "  Ship API  ", "--desc", "First line\nSecond line", "--priority=urgent", "--tag", " backend ", "--tag=release", "--tag=backend", "--due=2028-02-29")
	board := h.board(t)
	if len(board.Tasks) != 1 {
		t.Fatalf("add created %d tasks", len(board.Tasks))
	}
	id := board.Tasks[0].ID
	if !regexp.MustCompile(`^[0-9a-f]{8}$`).MatchString(id) {
		t.Fatalf("invalid generated ID %q", id)
	}
	assertCLIContains(t, h.out.String(), "Added "+id, "todo", "Ship API")
	want := model.Task{
		ID: id, Title: "Ship API", Description: "First line\nSecond line", Status: "todo", Priority: "urgent",
		Tags: []string{"backend", "release"}, Due: "2028-02-29", CreatedAt: h.clock.UTC(), UpdatedAt: h.clock.UTC(),
	}
	checkTask := func() {
		t.Helper()
		if got := h.board(t).Tasks[0]; !reflect.DeepEqual(got, want) {
			t.Fatalf("task = %#v; want %#v", got, want)
		}
	}
	checkTask()
	assertCLIContains(t, h.mustRun(t, "show", id), id, "Ship API", "First line", "Second line", "todo", "urgent", "2028-02-29", "backend", "release", want.CreatedAt.Format(time.RFC3339Nano))
	for _, priority := range []string{"low", "medium", "high"} {
		h.mustRun(t, "add", priority+" task", "--priority", priority)
	}
	h.mustRun(t, "add", "Default task")
	board = h.board(t)
	if len(board.Tasks) != 5 {
		t.Fatalf("got %d tasks, want 5", len(board.Tasks))
	}
	seen := make(map[string]bool)
	for i, priority := range []string{"urgent", "low", "medium", "high", "medium"} {
		task := board.Tasks[i]
		if seen[task.ID] || task.Priority != priority || task.Status != "todo" || !task.CreatedAt.Equal(h.clock) || !task.UpdatedAt.Equal(h.clock) {
			t.Fatalf("unexpected task %d: %#v", i, task)
		}
		seen[task.ID] = true
	}
	otherTasks := board.Tasks[1:]
	before := readCLIBytes(t, h.path)
	assertCLIContains(t, h.mustRun(t, "init"), "already initialized")
	assertCLIUnchanged(t, h.path, before)

	h.clock = h.clock.Add(time.Hour)
	h.mustRun(t, "move", id, "doing")
	want.Status, want.UpdatedAt = "doing", h.clock.UTC()
	checkTask()
	assertCLIContains(t, h.mustRun(t, "board"), "Todo (4)", "Doing (1)", "Done (0)", id)

	// Equal and backward clocks must still advance UpdatedAt, not CreatedAt.
	h.mustRun(t, "edit", id, "--title=Ship v2", "--desc=--db", "--priority=low", "--tag=frontend", "--tag=release", "--due=")
	want.Title, want.Description, want.Priority, want.Due = "Ship v2", "--db", "low", ""
	want.Tags, want.UpdatedAt = []string{"frontend", "release"}, want.UpdatedAt.Add(time.Nanosecond)
	checkTask()
	h.clock = h.clock.Add(-24 * time.Hour)
	h.mustRun(t, "edit", "--desc=", id, "--clear-tags")
	want.Description, want.Tags, want.UpdatedAt = "", []string{}, want.UpdatedAt.Add(time.Nanosecond)
	checkTask()
	h.mustRun(t, "move", id, "todo")
	want.Status, want.UpdatedAt = "todo", want.UpdatedAt.Add(time.Nanosecond)
	checkTask()
	h.mustRun(t, "done", id)
	want.Status, want.UpdatedAt = "done", want.UpdatedAt.Add(time.Nanosecond)
	checkTask()
	if got := h.board(t).Tasks[1:]; !reflect.DeepEqual(got, otherTasks) {
		t.Fatalf("editing one task changed other tasks: %#v", got)
	}

	before = readCLIBytes(t, h.path)
	h.app.display.Color = true
	exported := h.mustRun(t, "export")
	if got := decodeCLIBoard(t, []byte(exported)); !reflect.DeepEqual(got, h.board(t)) {
		t.Fatalf("JSON export differs from persisted board: %#v", got)
	}
	markdown := h.mustRun(t, "export", "--format=markdown")
	assertCLIContains(t, markdown, "# Kanban Board", "## Todo", "## Doing", "## Done", "- [x] Ship v2", id, "Priority: low", want.CreatedAt.Format(time.RFC3339Nano), want.UpdatedAt.Format(time.RFC3339Nano))
	if strings.Contains(markdown, "\x1b") {
		t.Error("Markdown export contains terminal color")
	}
	assertCLIUnchanged(t, h.path, before)
}

func TestCLIListFilters(t *testing.T) {
	h := newCLIHarness(t)
	h.mustRun(t, "add", "Both tags", "--tag=backend", "--tag=release")
	h.mustRun(t, "add", "Backend only", "--tag=backend")
	h.mustRun(t, "add", "Release only", "--tag=release")
	h.mustRun(t, "add", "Different case", "--tag=Backend", "--tag=release")
	h.mustRun(t, "add", "No tags")
	tasks := h.board(t).Tasks
	h.mustRun(t, "move", tasks[0].ID, "doing")
	h.mustRun(t, "done", tasks[2].ID)
	before := readCLIBytes(t, h.path)
	for _, tt := range []struct {
		name string
		args []string
		want []int
	}{
		{"all in creation order", nil, []int{0, 1, 2, 3, 4}},
		{"todo", []string{"--status=todo"}, []int{1, 3, 4}},
		{"doing", []string{"--status=doing"}, []int{0}},
		{"done", []string{"--status=done"}, []int{2}},
		{"one tag", []string{"--tag=backend"}, []int{0, 1}},
		{"all tags not any", []string{"--tag=backend", "--tag=release"}, []int{0}},
		{"normalized repeated tag", []string{"--tag", " backend ", "--tag=backend"}, []int{0, 1}},
		{"case sensitive", []string{"--tag=Backend"}, []int{3}},
		{"combined", []string{"--status=todo", "--tag=backend"}, []int{1}},
		{"no status tag match", []string{"--status=done", "--tag=backend"}, nil},
		{"unknown tag", []string{"--tag=missing"}, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			output := h.mustRun(t, append([]string{"list"}, tt.args...)...)
			last := -1
			for i, task := range tasks {
				pos := strings.Index(output, task.ID)
				if (pos >= 0) != slices.Contains(tt.want, i) {
					t.Errorf("task %s inclusion is wrong:\n%s", task.ID, output)
				}
				if pos >= 0 {
					if pos <= last {
						t.Error("list did not preserve creation order")
					}
					last = pos
				}
			}
			if len(tt.want) == 0 {
				assertCLIContains(t, output, "No tasks match", "kanban list")
			}
			assertCLIUnchanged(t, h.path, before)
		})
	}
}

func TestCLIHelpDoesNotAccessStorage(t *testing.T) {
	h := newCLIHarness(t)
	h.mustRun(t, "add", "Keep me")
	before := readCLIBytes(t, h.path)
	h.app.getenv = func(string) string { t.Fatal("help consulted environment"); return "" }
	h.app.now = func() time.Time { t.Fatal("help consulted clock"); return time.Time{} }
	for i, path := range []string{h.path, filepath.Join(t.TempDir(), "missing", "board.json")} {
		for _, command := range []string{"init", "add", "list", "board", "show", "move", "done", "edit", "delete", "export", "import", "tui"} {
			for _, args := range [][]string{{command, "--help"}, {"help", command}, {"-h", command}} {
				t.Run(fmt.Sprintf("storage%d/%s", i, strings.Join(args, " ")), func(t *testing.T) {
					output := h.mustRun(t, append([]string{"--db", path}, args...)...)
					assertCLIContains(t, output, "Usage: kanban "+command, "--db", "--help")
				})
			}
		}
		if path != h.path {
			if _, err := os.Stat(filepath.Dir(path)); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("help created storage directory: %v", err)
			}
		}
	}
	for _, args := range [][]string{nil, {"--help"}, {"help"}} {
		assertCLIContains(t, h.mustRun(t, args...), "Usage:", "low, medium", "high, urgent", "--db > KANBAN_DB > .kanban/board.json")
	}
	if output := h.mustRun(t, "--version"); output != "kanban "+version+"\n" {
		t.Fatalf("version output = %q", output)
	}
	assertCLIUnchanged(t, h.path, before)
}

func TestCLIInvalidCommandsPreserveBoard(t *testing.T) {
	h := newCLIHarness(t)
	h.mustRun(t, "add", "Keep me", "--tag=original", "--due=2028-02-29")
	id := h.board(t).Tasks[0].ID
	before := readCLIBytes(t, h.path)
	tests := []struct {
		args []string
		want string
	}{
		{[]string{"add", "   "}, "title"},
		{[]string{"add", ""}, "title"},
		{[]string{"add", "Bad", "--priority=critical"}, "invalid priority"},
		{[]string{"add", "Bad", "--priority="}, "invalid priority"},
		{[]string{"add", "Bad", "--due=2026-02-29"}, "invalid due date"},
		{[]string{"add", "Bad", "--due=2028-2-9"}, "invalid due date"},
		{[]string{"add", "Bad", "--tag="}, "tag"},
		{[]string{"edit", id, "--title= "}, "title"},
		{[]string{"edit", id, "--priority=HIGH"}, "invalid priority"},
		{[]string{"edit", id, "--priority="}, "invalid priority"},
		{[]string{"edit", id, "--due=2026-04-31"}, "invalid due date"},
		{[]string{"edit", id, "--due=not-a-date"}, "invalid due date"},
		{[]string{"edit", id, "--tag= "}, "tag"},
		{[]string{"edit", id, "--tag=new", "--clear-tags"}, "cannot be combined"},
		{[]string{"edit", id}, "at least one field"},
		{[]string{"edit", id, "--clear-tags=false"}, "at least one field"},
		{[]string{"move", id, "blocked"}, "invalid status"},
		{[]string{"list", "--status=TODO"}, "invalid status"},
		{[]string{"list", "--status="}, "invalid status"},
		{[]string{"list", "--tag="}, "tag"},
		{[]string{"export", "--format=csv"}, "invalid export format"},
		{[]string{"show", "not-an-id"}, "not found"},
		{[]string{"show", id[:4]}, "not found"},
		{[]string{"move", "not-an-id", "doing"}, "not found"},
		{[]string{"done", "not-an-id"}, "not found"},
		{[]string{"edit", "not-an-id", "--title=New"}, "not found"},
		{[]string{"delete", "not-an-id"}, "not found"},
		{[]string{"delete", "not-an-id", "--yes"}, "not found"},
		{[]string{"add", "Bad", "--unknown"}, "unknown option"},
		{[]string{"edit", id, "--title=A", "--title=B"}, "only be specified once"},
		{[]string{"add", "Bad", "--desc", "--priority=low"}, "requires a value"},
		{[]string{"help", "unknown"}, "unknown command"},
		{[]string{"help", "add", "extra"}, "usage:"},
	}
	for _, tt := range tests {
		t.Run(strings.Join(tt.args, " "), func(t *testing.T) {
			if err := h.invoke(tt.args...); err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v; want %q", err, tt.want)
			}
			if h.out.Len() != 0 || h.errOut.Len() != 0 {
				t.Fatalf("invalid command produced output or prompted: stdout=%q stderr=%q", &h.out, &h.errOut)
			}
			assertCLIUnchanged(t, h.path, before)
		})
	}
	for _, tt := range []struct {
		command string
		args    []string
	}{
		{"init", nil}, {"add", []string{"Title"}}, {"list", nil}, {"board", nil},
		{"show", []string{id}}, {"move", []string{id, "doing"}}, {"done", []string{id}},
		{"edit", []string{id}}, {"delete", []string{id}}, {"export", nil}, {"import", []string{"-"}},
	} {
		counts := []int{len(tt.args) + 1}
		if len(tt.args) > 0 {
			counts = append(counts, len(tt.args)-1)
		}
		for _, count := range counts {
			t.Run(fmt.Sprintf("%s/%d arguments", tt.command, count), func(t *testing.T) {
				args := append([]string{tt.command}, tt.args...)
				args = append(args, "extra")[:count+1]
				if err := h.invoke(args...); err == nil || !strings.Contains(err.Error(), "positional argument") {
					t.Fatalf("run %q error = %v; want argument count error", args, err)
				}
				assertCLIUnchanged(t, h.path, before)
			})
		}
	}
}

func TestCLIDeleteConfirmation(t *testing.T) {
	for _, tt := range []struct {
		name   string
		input  string
		flags  []string
		delete bool
		prompt bool
	}{
		{"default no", "\n", nil, false, true},
		{"EOF", "", nil, false, true},
		{"explicit no", "no\n", nil, false, true},
		{"unrecognized answer", "maybe\n", nil, false, true},
		{"only first line counts", "no\nyes\n", nil, false, true},
		{"false still prompts", "\n", []string{"--yes=false"}, false, true},
		{"false allows confirmation", "yes\n", []string{"--yes=false"}, true, true},
		{"yes", " yEs \n", nil, true, true},
		{"y at EOF", "y", nil, true, true},
		{"force", "", []string{"--yes"}, true, false},
		{"short force", "", []string{"-y"}, true, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			h := newCLIHarness(t)
			h.mustRun(t, "add", "Delete candidate")
			h.mustRun(t, "add", "Survivor")
			tasks := h.board(t).Tasks
			before := readCLIBytes(t, h.path)
			h.app.in = strings.NewReader(tt.input)
			if !tt.prompt {
				h.app.in = cliReadFunc(func([]byte) (int, error) { t.Fatal("--yes read stdin"); return 0, io.EOF })
			}
			if err := h.invoke(append([]string{"delete", tasks[0].ID}, tt.flags...)...); err != nil {
				t.Fatal(err)
			}
			if tt.prompt {
				assertCLIContains(t, h.errOut.String(), tasks[0].ID, "Delete candidate", "[y/N]")
			} else if h.errOut.Len() != 0 {
				t.Fatalf("--yes prompted: %s", &h.errOut)
			}
			if tt.delete {
				if got := h.board(t).Tasks; !reflect.DeepEqual(got, tasks[1:]) {
					t.Fatalf("wrong tasks after deletion: %#v", got)
				}
				assertCLIContains(t, h.out.String(), "Deleted "+tasks[0].ID)
			} else {
				assertCLIContains(t, h.out.String(), "cancelled")
				assertCLIUnchanged(t, h.path, before)
			}
		})
	}
}

type cliReadFunc func([]byte) (int, error)

func (f cliReadFunc) Read(p []byte) (int, error) { return f(p) }

func TestCLIDeleteConcurrentChange(t *testing.T) {
	for _, change := range []string{"same task edited", "same task deleted", "other task edited"} {
		t.Run(change, func(t *testing.T) {
			h := newCLIHarness(t)
			h.mustRun(t, "add", "Candidate")
			h.mustRun(t, "add", "Other")
			tasks := h.board(t).Tasks
			var afterConcurrent []byte
			read := false
			h.app.in = cliReadFunc(func(p []byte) (int, error) {
				if read {
					return 0, io.EOF
				}
				read = true
				assertCLIContains(t, h.errOut.String(), "[y/N]")
				if err := (&store.Store{Path: h.path}).Update(func(board *model.Board) error {
					switch change {
					case "same task edited":
						board.Tasks[0].Description = "Concurrent edit without timestamp change"
					case "same task deleted":
						board.Tasks = board.Tasks[1:]
					case "other task edited":
						board.Tasks[1].Title = "Concurrent title"
					}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
				afterConcurrent = readCLIBytes(t, h.path)
				return copy(p, "yes\n"), nil
			})
			err := h.invoke("delete", tasks[0].ID)
			if !read {
				t.Fatal("delete did not request confirmation")
			}
			if change == "other task edited" {
				if err != nil {
					t.Fatal(err)
				}
				want := decodeCLIBoard(t, afterConcurrent).Tasks[1:]
				if got := h.board(t).Tasks; !reflect.DeepEqual(got, want) {
					t.Fatalf("delete lost unrelated concurrent edit: %#v", got)
				}
				return
			}
			wantError := "changed while awaiting confirmation"
			if change == "same task deleted" {
				wantError = "not found"
			}
			if err == nil || !strings.Contains(err.Error(), wantError) {
				t.Fatalf("error = %v; want %q", err, wantError)
			}
			if h.out.Len() != 0 {
				t.Fatalf("failed deletion printed success: %s", &h.out)
			}
			assertCLIUnchanged(t, h.path, afterConcurrent)
		})
	}
}

func TestCLIImportAtomicity(t *testing.T) {
	h := newCLIHarness(t)
	h.mustRun(t, "add", "Original", "--priority=high", "--tag=keep")
	exported := h.mustRun(t, "export", "--format=json")
	alternate := filepath.Join(t.TempDir(), "nested", "alternate.json")
	h.app.in = strings.NewReader(exported)
	assertCLIContains(t, h.mustRun(t, "--db", alternate, "import", "-"), "Imported 1", "skipped 0")
	if got := decodeCLIBoard(t, readCLIBytes(t, alternate)); !reflect.DeepEqual(got, h.board(t)) {
		t.Fatalf("import did not preserve all fields: %#v", got)
	}
	before := readCLIBytes(t, h.path)
	h.app.in = strings.NewReader(exported)
	assertCLIContains(t, h.mustRun(t, "import", "-"), "Imported 0", "skipped 1")
	assertCLIUnchanged(t, h.path, before)

	source := h.board(t)
	conflict := source.Tasks[0]
	conflict.Title = "Conflicting title"
	newTask := source.Tasks[0]
	newTask.ID = "00000000"
	if newTask.ID == conflict.ID {
		newTask.ID = "00000001"
	}
	newTask.Title = "Must not be partially imported"
	source.Tasks = []model.Task{newTask, conflict}
	conflictingJSON, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name  string
		input string
	}{
		{"truncated JSON", "{"}, {"empty input", ""}, {"null board", "null"},
		{"unsupported version", `{"version":2,"tasks":[]}`},
		{"trailing document", exported + "{}"}, {"conflict after new task", string(conflictingJSON)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			h.app.in = strings.NewReader(tt.input)
			if err := h.invoke("import", "-"); err == nil {
				t.Fatal("invalid or conflicting import succeeded")
			}
			if h.out.Len() != 0 {
				t.Fatalf("failed import printed success: %s", &h.out)
			}
			assertCLIUnchanged(t, h.path, before)
		})
	}
}

func TestCLIImportMergesWithoutReplacingLocalTasks(t *testing.T) {
	source := newCLIHarness(t)
	source.mustRun(t, "add", "Imported first", "--priority=low")
	source.mustRun(t, "add", "Imported second", "--priority=urgent")
	exported := source.mustRun(t, "export")
	sourceBefore := readCLIBytes(t, source.path)
	dest := newCLIHarness(t)
	dest.mustRun(t, "add", "Local task", "--tag=local")
	want := append(dest.board(t).Tasks, source.board(t).Tasks...)
	dest.app.in = strings.NewReader(exported)
	assertCLIContains(t, dest.mustRun(t, "import", "-"), "Imported 2", "skipped 0")
	if got := dest.board(t).Tasks; !reflect.DeepEqual(got, want) {
		t.Fatalf("merge = %#v; want local task followed by imported tasks %#v", got, want)
	}
	assertCLIUnchanged(t, source.path, sourceBefore)
}

func TestCLIImportReadErrorsPreserveBoard(t *testing.T) {
	h := newCLIHarness(t)
	h.mustRun(t, "add", "Keep me")
	before := readCLIBytes(t, h.path)
	failure := errors.New("injected import read error")
	h.app.in = cliReadFunc(func([]byte) (int, error) { return 0, failure })
	for _, source := range []string{"-", filepath.Join(t.TempDir(), "missing.json"), t.TempDir()} {
		if err := h.invoke("import", source); err == nil {
			t.Fatalf("import %q succeeded", source)
		} else if source == "-" && !strings.Contains(err.Error(), failure.Error()) {
			t.Fatalf("import swallowed input error: %v", err)
		}
		if h.out.Len() != 0 {
			t.Fatalf("failed import printed success: %s", &h.out)
		}
		assertCLIUnchanged(t, h.path, before)
	}
}

type cliFailWriter struct{ err error }

func (w cliFailWriter) Write([]byte) (int, error) { return 0, w.err }

func TestCLIIOSafety(t *testing.T) {
	h := newCLIHarness(t)
	h.mustRun(t, "add", "Keep me")
	id := h.board(t).Tasks[0].ID
	before := readCLIBytes(t, h.path)
	failure := errors.New("injected I/O failure")
	for _, input := range []io.Reader{
		cliReadFunc(func([]byte) (int, error) { return 0, failure }),
		strings.NewReader(strings.Repeat("y", 5000) + "\n"),
	} {
		h.app.in = input
		if err := h.invoke("delete", id); err == nil || !strings.Contains(err.Error(), "read confirmation") {
			t.Fatalf("confirmation read error = %v", err)
		}
		assertCLIUnchanged(t, h.path, before)
	}
	h.app.errOut = cliFailWriter{failure}
	h.app.in = cliReadFunc(func([]byte) (int, error) { t.Fatal("read after failed prompt"); return 0, io.EOF })
	if err := h.invoke("delete", id); !errors.Is(err, failure) {
		t.Fatalf("prompt write error = %v; want injected failure", err)
	}
	assertCLIUnchanged(t, h.path, before)

	t.Setenv("KANBAN_DB", h.path)
	t.Setenv("NO_COLOR", "1")
	t.Setenv("TERM", "dumb")
	t.Setenv("COLUMNS", "120")
	for _, args := range [][]string{
		{"--help"}, {"--version"}, {"help", "add"}, {"init"}, {"list"}, {"board"}, {"show", id},
		{"export", "--format=json"}, {"export", "--format=markdown"}, {"delete", id},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			var errOut bytes.Buffer
			code := Run(args, strings.NewReader("\n"), cliFailWriter{failure}, &errOut)
			if code == 0 {
				t.Fatal("output failure returned success")
			}
			assertCLIContains(t, errOut.String(), "kanban:", failure.Error())
			assertCLIUnchanged(t, h.path, before)
		})
	}
}

func TestCLIMutationOutputErrorsReturnFailure(t *testing.T) {
	failure := errors.New("injected status output failure")
	for _, command := range []string{"init", "add", "move", "edit", "done", "delete", "import"} {
		t.Run(command, func(t *testing.T) {
			h := newCLIHarness(t)
			h.mustRun(t, "add", "Existing")
			id := h.board(t).Tasks[0].ID
			exported := h.mustRun(t, "export")
			args := []string{command}
			switch command {
			case "init", "import":
				h.path = filepath.Join(t.TempDir(), "new.json")
				if command == "import" {
					args = append(args, "-")
				}
			case "add":
				args = append(args, "New task")
			case "move":
				args = append(args, id, "doing")
			case "edit":
				args = append(args, id, "--title=New title")
			case "done":
				args = append(args, id)
			case "delete":
				args = append(args, id, "--yes")
			}
			t.Setenv("KANBAN_DB", h.path)
			t.Setenv("NO_COLOR", "1")
			t.Setenv("TERM", "dumb")
			t.Setenv("COLUMNS", "120")
			var errOut bytes.Buffer
			if code := Run(args, strings.NewReader(exported), cliFailWriter{failure}, &errOut); code == 0 {
				t.Fatal("failed status output returned success")
			}
			assertCLIContains(t, errOut.String(), "kanban:", failure.Error())
			// Status is written after commit; output errors must not corrupt storage.
			h.board(t)
		})
	}
}
