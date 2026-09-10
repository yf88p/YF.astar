package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"kanban/internal/model"
)

type cliE2E struct {
	binary string
	dir    string
	envDB  string
}

func (e cliE2E) run(t *testing.T, input string, wantCode int, args ...string) (string, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, e.binary, args...)
	cmd.Dir = e.dir
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "KANBAN_DB", "NO_COLOR", "TERM", "COLUMNS", "HOME", "XDG_CONFIG_HOME":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "NO_COLOR=1", "TERM=dumb", "COLUMNS=120", "HOME="+e.dir, "XDG_CONFIG_HOME="+e.dir)
	if e.envDB != "" {
		cmd.Env = append(cmd.Env, "KANBAN_DB="+e.envDB)
	}
	cmd.Stdin = strings.NewReader(input)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	if ctx.Err() != nil {
		t.Fatalf("command %q timed out: %v\nstdout: %s\nstderr: %s", args, ctx.Err(), &out, &errOut)
	}
	code := 0
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			t.Fatalf("execute %q: %v", args, err)
		}
		code = exit.ExitCode()
	}
	if code != wantCode {
		t.Fatalf("command %q exit = %d, want %d\nstdout: %s\nstderr: %s", args, code, wantCode, &out, &errOut)
	}
	if wantCode != 0 && (out.Len() != 0 || !strings.Contains(errOut.String(), "kanban:")) {
		t.Fatalf("failed command %q must diagnose on stderr only: stdout=%q stderr=%q", args, &out, &errOut)
	}
	return out.String(), errOut.String()
}

func (e cliE2E) mustRun(t *testing.T, args ...string) string {
	t.Helper()
	out, errOut := e.run(t, "", 0, args...)
	if errOut != "" {
		t.Fatalf("command %q wrote unexpected stderr: %s", args, errOut)
	}
	return out
}

func TestCLIEndToEnd(t *testing.T) {
	// Build main, not the test executable, once for all subprocess scenarios.
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "kanban")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	build := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-o", binary, ".")
	build.Dir = root
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build root binary: %v\n%s", err, output)
	}

	t.Run("database precedence", func(t *testing.T) {
		for _, mode := range []string{"default", "environment", "flag before", "flag after"} {
			t.Run(mode, func(t *testing.T) {
				e := cliE2E{binary: binary, dir: t.TempDir()}
				defaultPath := filepath.Join(e.dir, ".kanban", "board.json")
				envPath := filepath.Join(e.dir, "env board", "board.json")
				flagPath := filepath.Join(e.dir, "flag board", "board.json")
				wantPath := defaultPath
				args := []string{"init"}
				if mode != "default" {
					e.envDB, wantPath = envPath, envPath
				}
				switch mode {
				case "flag before":
					args, wantPath = []string{"--db", flagPath, "init"}, flagPath
				case "flag after":
					args, wantPath = []string{"init", "--db=" + flagPath}, flagPath
				}
				assertCLIContains(t, e.mustRun(t, args...), "Initialized")
				board := decodeCLIBoard(t, readCLIBytes(t, wantPath))
				if board.Version != 1 || len(board.Tasks) != 0 {
					t.Fatalf("init board = %#v", board)
				}
				for _, path := range []string{defaultPath, envPath, flagPath} {
					if path == wantPath {
						continue
					}
					if _, err := os.Stat(filepath.Dir(path)); !errors.Is(err, os.ErrNotExist) {
						t.Fatalf("unselected database parent %q was touched: %v", filepath.Dir(path), err)
					}
				}
			})
		}
		t.Run("invalid paths do not fall back", func(t *testing.T) {
			e := cliE2E{binary: binary, dir: t.TempDir(), envDB: "   "}
			_, errOut := e.run(t, "", 1, "init")
			assertCLIContains(t, errOut, "nonempty file path")
			e.envDB = filepath.Join(e.dir, "environment.json")
			_, errOut = e.run(t, "", 1, "init", "--db=")
			assertCLIContains(t, errOut, "nonempty file path")
			entries, err := os.ReadDir(e.dir)
			if err != nil || len(entries) != 0 {
				t.Fatalf("invalid path created files: %v, %v", entries, err)
			}
		})
	})

	t.Run("literal arguments and implicit creation", func(t *testing.T) {
		e := cliE2E{binary: binary, dir: t.TempDir()}
		e.mustRun(t, "add", "--desc=--db=elsewhere.json", "--tag=--help", "--", "--priority=not-a-flag")
		path := filepath.Join(e.dir, ".kanban", "board.json")
		board := decodeCLIBoard(t, readCLIBytes(t, path))
		if len(board.Tasks) != 1 {
			t.Fatalf("got %d tasks", len(board.Tasks))
		}
		task := board.Tasks[0]
		if task.Title != "--priority=not-a-flag" || task.Description != "--db=elsewhere.json" || task.Priority != "medium" || !reflect.DeepEqual(task.Tags, []string{"--help"}) {
			t.Fatalf("literal flag text interpreted as options: %#v", task)
		}
		if _, err := os.Stat(filepath.Join(e.dir, "elsewhere.json")); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("description changed database path: %v", err)
		}
	})

	t.Run("workflow", func(t *testing.T) {
		e := cliE2E{binary: binary, dir: t.TempDir()}
		path := filepath.Join(e.dir, ".kanban", "board.json")
		e.mustRun(t, "init")
		started := time.Now()
		added := e.mustRun(t, "add", "Ship API", "--desc=First line\nSecond line", "--priority", "urgent", "--tag=backend", "--tag", "release", "--due=2028-02-29")
		board := decodeCLIBoard(t, readCLIBytes(t, path))
		if len(board.Tasks) != 1 {
			t.Fatalf("add created %d tasks", len(board.Tasks))
		}
		original := board.Tasks[0]
		id := original.ID
		assertCLIContains(t, added, "Added "+id)
		if original.CreatedAt.Before(started) || original.CreatedAt.After(time.Now()) || !original.UpdatedAt.Equal(original.CreatedAt) {
			t.Fatalf("unexpected creation timestamps: %#v", original)
		}
		if original.Title != "Ship API" || original.Description != "First line\nSecond line" || original.Status != "todo" || original.Priority != "urgent" || original.Due != "2028-02-29" || !reflect.DeepEqual(original.Tags, []string{"backend", "release"}) {
			t.Fatalf("add lost fields: %#v", original)
		}
		for _, priority := range []string{"low", "medium", "high"} {
			e.mustRun(t, "add", priority+" task", "--priority="+priority, "--tag=backend")
		}
		e.mustRun(t, "add", "Default task")
		board = decodeCLIBoard(t, readCLIBytes(t, path))
		if len(board.Tasks) != 5 {
			t.Fatalf("got %d tasks, want 5", len(board.Tasks))
		}
		for i, priority := range []string{"urgent", "low", "medium", "high", "medium"} {
			if board.Tasks[i].Priority != priority {
				t.Errorf("task %d priority = %q, want %q", i, board.Tasks[i].Priority, priority)
			}
		}
		allTasks := board.Tasks
		before := readCLIBytes(t, path)
		e.mustRun(t, "init")
		filtered := e.mustRun(t, "list", "--tag=backend", "--status=todo", "--tag=release")
		assertCLIContains(t, filtered, id, "Ship API", "urgent", "2028-02-29")
		for _, task := range allTasks[1:] {
			if strings.Contains(filtered, task.ID) {
				t.Errorf("AND filters included %s: %s", task.ID, filtered)
			}
		}
		assertCLIContains(t, e.mustRun(t, "list", "--status=doing"), "No tasks match")
		assertCLIContains(t, e.mustRun(t, "show", id), id, "First line", "Second line", "Created:", "Updated:")
		assertCLIContains(t, e.mustRun(t, "board"), "Todo (5)", "Doing (0)", "Done (0)")
		assertCLIUnchanged(t, path, before)

		want := original
		checkUpdate := func() {
			t.Helper()
			got := decodeCLIBoard(t, readCLIBytes(t, path)).Tasks
			if len(got) != len(allTasks) || !reflect.DeepEqual(got[1:], allTasks[1:]) {
				t.Fatalf("update changed unrelated tasks: %#v", got)
			}
			if !got[0].UpdatedAt.After(want.UpdatedAt) || got[0].UpdatedAt.After(time.Now()) {
				t.Fatalf("updated_at did not advance correctly: got %s, previous %s", got[0].UpdatedAt, want.UpdatedAt)
			}
			want.UpdatedAt = got[0].UpdatedAt
			if !reflect.DeepEqual(got[0], want) {
				t.Fatalf("updated task = %#v; want %#v", got[0], want)
			}
		}
		e.mustRun(t, "move", id, "--db", path, "doing")
		want.Status = "doing"
		checkUpdate()
		assertCLIContains(t, e.mustRun(t, "board"), "Todo (4)", "Doing (1)", "Done (0)")
		e.mustRun(t, "edit", id, "--title=Ship v2", "--desc=Revised description", "--priority=high", "--tag=frontend", "--tag=review", "--due=2029-01-15")
		want.Title, want.Description, want.Priority, want.Due = "Ship v2", "Revised description", "high", "2029-01-15"
		want.Tags = []string{"frontend", "review"}
		checkUpdate()
		e.mustRun(t, "done", id)
		want.Status = "done"
		checkUpdate()

		before = readCLIBytes(t, path)
		exported := e.mustRun(t, "export", "--format=json")
		exportedBoard := decodeCLIBoard(t, []byte(exported))
		if !reflect.DeepEqual(exportedBoard, decodeCLIBoard(t, before)) {
			t.Fatal("exported JSON differs from stored board")
		}
		markdown := e.mustRun(t, "export", "--format=markdown")
		assertCLIContains(t, markdown, "# Kanban Board", "## Todo", "## Doing", "## Done", "- [x] Ship v2", id, "Priority: high", "Tags: frontend, review", "Due: 2029-01-15", "Revised description")
		if strings.Contains(markdown, "\x1b") {
			t.Error("Markdown export contains terminal escapes")
		}
		assertCLIUnchanged(t, path, before)

		backup := filepath.Join(e.dir, "backup with spaces.json")
		if err := os.WriteFile(backup, []byte(exported), 0600); err != nil {
			t.Fatal(err)
		}
		alternate := filepath.Join(e.dir, "archive", "board.json")
		assertCLIContains(t, e.mustRun(t, "--db", alternate, "import", backup), "Imported 5", "skipped 0")
		if got := decodeCLIBoard(t, readCLIBytes(t, alternate)); !reflect.DeepEqual(got, exportedBoard) {
			t.Fatalf("file import changed IDs, timestamps, or fields: %#v", got)
		}
		alternateBefore := readCLIBytes(t, alternate)
		out, errOut := e.run(t, exported, 0, "import", "-", "--db="+alternate)
		assertCLIContains(t, out, "Imported 0", "skipped 5")
		if errOut != "" {
			t.Fatalf("stdin import stderr = %q", errOut)
		}
		assertCLIUnchanged(t, alternate, alternateBefore)
		assertCLIUnchanged(t, path, before)

		e.mustRun(t, "edit", id, "--due=", "--desc=", "--clear-tags")
		want.Due, want.Description, want.Tags = "", "", []string{}
		checkUpdate()
		assertCLIUnchanged(t, alternate, alternateBefore)
		before = readCLIBytes(t, path)
		for _, args := range [][]string{
			{"add", " "}, {"add", "Bad", "--priority=critical"}, {"add", "Bad", "--due=2027-02-29"},
			{"edit", id, "--title="}, {"edit", id, "--priority=invalid"}, {"edit", id, "--due=2026-13-01"},
			{"move", id, "blocked"}, {"list", "--status=invalid"}, {"done", "not-an-id"},
			{"edit", "not-an-id", "--title=Bad"}, {"delete", "not-an-id", "--yes"},
			{"add"}, {"move", id}, {"done", id, "extra"}, {"list", "extra"},
			{"add", "Bad", "--unknown"}, {"add", "Bad", "--due"},
		} {
			e.run(t, "", 1, args...)
			assertCLIUnchanged(t, path, before)
		}
		corruptFile := filepath.Join(e.dir, "corrupt.json")
		if err := os.WriteFile(corruptFile, []byte(`{"version":1,"tasks":[`), 0600); err != nil {
			t.Fatal(err)
		}
		e.run(t, "", 1, "import", corruptFile)
		assertCLIUnchanged(t, path, before)
		e.run(t, exported+"{}", 1, "import", "-")
		assertCLIUnchanged(t, path, before)

		// A valid export with a conflicting ID must not partially merge new tasks.
		conflict := exportedBoard
		newTask := original
		for i := 0; ; i++ {
			newTask.ID = fmt.Sprintf("%08x", i)
			if !slices.ContainsFunc(allTasks, func(task model.Task) bool { return task.ID == newTask.ID }) {
				break
			}
		}
		conflict.Tasks = append([]model.Task{newTask}, exportedBoard.Tasks...)
		conflictJSON, err := json.Marshal(conflict)
		if err != nil {
			t.Fatal(err)
		}
		_, errOut = e.run(t, string(conflictJSON), 1, "import", "-")
		assertCLIContains(t, errOut, "conflicting data")
		assertCLIUnchanged(t, path, before)

		for _, tt := range []struct {
			input string
			flags []string
		}{{"", nil}, {"\n", nil}, {"no\n", nil}, {"", []string{"--yes=false"}}} {
			out, errOut := e.run(t, tt.input, 0, append([]string{"delete", id}, tt.flags...)...)
			assertCLIContains(t, out, "cancelled")
			assertCLIContains(t, errOut, id, "Ship v2", "[y/N]")
			assertCLIUnchanged(t, path, before)
		}
		assertCLIContains(t, e.mustRun(t, "delete", id, "--yes"), "Deleted "+id)
		if got := decodeCLIBoard(t, readCLIBytes(t, path)).Tasks; !reflect.DeepEqual(got, allTasks[1:]) {
			t.Fatalf("delete removed or changed wrong tasks: %#v", got)
		}
		assertCLIUnchanged(t, alternate, alternateBefore)
	})

	t.Run("help and missing board are read only", func(t *testing.T) {
		e := cliE2E{binary: binary, dir: t.TempDir()}
		for _, args := range [][]string{nil, {"--help"}, {"add", "--help"}, {"delete", "-h"}, {"help", "import"}, {"--version"}} {
			if output := e.mustRun(t, args...); output == "" {
				t.Fatalf("%q produced empty help", args)
			}
		}
		for _, args := range [][]string{{"list"}, {"board"}, {"show", "12345678"}, {"export"}} {
			_, errOut := e.run(t, "", 1, args...)
			assertCLIContains(t, errOut, "not initialized", "kanban init")
		}
		entries, err := os.ReadDir(e.dir)
		if err != nil || len(entries) != 0 {
			t.Fatalf("read-only commands created files: %v, %v", entries, err)
		}
	})
}
