package tui

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
	"automator/internal/executor"
	"automator/internal/persistence"
	"automator/internal/report"
	"automator/internal/worker"

	tea "github.com/charmbracelet/bubbletea"
)

func boundaryFixture(t *testing.T) (*model, string) {
	t.Helper()
	home, root := t.TempDir(), t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("AUTOMATOR_HOME", filepath.Join(home, "automator"))
	t.Setenv("PATH", home) // No installed Herdr or coding tools can be invoked.
	if err := config.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	run := filepath.Join(root, "run")
	snapshot := config.RunSnapshot{SchemaVersion: 1, Name: "run", Root: root, RunDir: run, Mode: config.Headless,
		Concurrency: 1, Template: config.Template{DisplayName: "Empty"}, Models: map[string]config.Model{
			"a": {Tool: config.Opencode, Provider: "fixture", Model: "a"}, "b": {Tool: config.Opencode, Provider: "fixture", Model: "b"},
		}}
	if err := persistence.SaveYAML(filepath.Join(run, "run.yaml"), snapshot); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"a", "b"} {
		if err := os.MkdirAll(filepath.Join(run, key), 0700); err != nil {
			t.Fatal(err)
		}
		if err := worker.SaveState(run, key, worker.State{Model: key, Status: worker.Paused, ProjectPath: filepath.Join(run, key)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := config.SaveRunsIndex(config.RunsIndex{SchemaVersion: 1, Runs: []config.RunIndexEntry{{Name: "run", Path: run, Mode: config.Headless}}}); err != nil {
		t.Fatal(err)
	}
	data, err := loadDashboard()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	m := newModel(ctx, data, defaultServices())
	m.section = runs
	return m, run
}

func TestRealDeleteBoundaryRechecksThenDeletesModelAndRun(t *testing.T) {
	m, run := boundaryFixture(t)
	press(m, "d")
	state, err := worker.LoadState(run, "a")
	if err != nil {
		t.Fatal(err)
	}
	state.Status = worker.Running
	if err := worker.SaveState(run, "a", state); err != nil {
		t.Fatal(err)
	}
	reload := consume(t, m, press(m, "y"))
	if m.deletion == nil || !strings.Contains(m.status, "running") {
		t.Fatal("executor's confirm-time running guard not surfaced")
	}
	if _, err := os.Stat(filepath.Join(run, "a")); err != nil {
		t.Fatal("guard removed files")
	}
	state.Status = worker.Paused
	if err := worker.SaveState(run, "a", state); err != nil {
		t.Fatal(err)
	}
	consume(t, m, reload)
	reload = consume(t, m, press(m, "y"))
	consume(t, m, reload)
	if m.deletion != nil || len(m.data.runRows()) != 1 || m.data.runRows()[0].state.Model != "b" {
		t.Fatal("model deletion not reflected in dashboard")
	}
	if _, err := os.Stat(filepath.Join(run, "report.md")); err != nil {
		t.Fatal("model deletion did not refresh report")
	}
	press(m, "D")
	consume(t, m, consume(t, m, press(m, "y")))
	if _, err := os.Stat(run); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("run files not deleted")
	}
	index, err := config.LoadRunsIndex()
	if err != nil || len(index.Runs) != 0 || len(m.data.runs) != 0 {
		t.Fatal("run deletion not reflected in index/dashboard")
	}
}

func TestRealDeleteBoundaryRejectsSymlinkAndUnindexedRun(t *testing.T) {
	for _, kind := range []string{"unindexed", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			m, run := boundaryFixture(t)
			if kind == "symlink" {
				link := filepath.Join(filepath.Dir(run), "link")
				if err := os.Symlink(run, link); err != nil {
					t.Skip(err)
				}
				m.data.runs[0].path = link
			} else if err := config.SaveRunsIndex(config.RunsIndex{SchemaVersion: 1}); err != nil {
				t.Fatal(err)
			}
			press(m, "D")
			consume(t, m, press(m, "y"))
			if m.deletion == nil || !strings.Contains(m.status, "delete failed") {
				t.Fatal("unsafe deletion not rejected")
			}
			if _, err := os.Stat(filepath.Join(run, "a")); err != nil {
				t.Fatal("unsafe deletion changed run files")
			}
		})
	}
}

func TestRealActionBoundaryGuardsAndStopRequest(t *testing.T) {
	for _, tc := range []struct {
		key    string
		status worker.Status
		want   string
	}{
		{"s", worker.Done, "use retry"}, {"R", worker.Running, "already running"}, {"u", worker.Queued, "in progress"}, {"k", worker.Running, ""}, {"ctrl+c", worker.Running, ""},
	} {
		t.Run(tc.key, func(t *testing.T) {
			m, run := boundaryFixture(t)
			state, _ := worker.LoadState(run, "a")
			state.Status = tc.status
			if err := worker.SaveState(run, "a", state); err != nil {
				t.Fatal(err)
			}
			consume(t, m, m.reload(false))
			m.services.run = func(ctx context.Context, r request) processResult {
				var err error
				switch r.args[0] {
				case "start":
					err = executor.StartModel(ctx, r.args[1], r.args[2], false)
				case "retry":
					err = executor.RetryModel(ctx, r.args[1], r.args[2], false)
				case "continue":
					err = executor.ContinueModel(ctx, r.args[1], r.args[2], "", false)
				case "stop":
					err = executor.StopModel(ctx, r.args[1], r.args[2])
				}
				return processResult{err: err}
			}
			consume(t, m, press(m, tc.key))
			if tc.want != "" && !strings.Contains(m.status, tc.want) {
				t.Fatalf("missing executor guard: %s", m.status)
			}
			if tc.want == "" {
				if _, err := os.Stat(worker.CancelPath(run, "a")); err != nil {
					t.Fatal("stop did not persist cancellation request")
				}
				if _, err := os.Stat(worker.CancelPath(run, "b")); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("stop affected sibling")
				}
			}
		})
	}
}

func TestRealReportIsOpenedWithoutRewriting(t *testing.T) {
	m, run := boundaryFixture(t)
	if err := report.Write(run); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(run, "report.md")
	before, _ := os.ReadFile(path)
	opened := ""
	m.services.external = func(cmd *exec.Cmd, callback tea.ExecCallback) tea.Cmd {
		opened = cmd.Args[len(cmd.Args)-1]
		return func() tea.Msg { return callback(nil) }
	}
	consume(t, m, consume(t, m, press(m, "o")))
	after, _ := os.ReadFile(path)
	if opened != path || string(before) != string(after) {
		t.Fatal("report open mutated or selected wrong report")
	}
}
