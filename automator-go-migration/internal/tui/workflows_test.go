package tui

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/worker"
)

func TestRealCLIWorkflowWithPrivateCodingTool(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("isolated shell/worker lifecycle test uses Linux")
	}
	root := t.TempDir()
	binary := filepath.Join(root, "automator")
	build := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-mod=readonly", "-o", binary, "automator/cmd/automator")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build private CLI: %v\n%s", err, output)
	}
	home, tools := filepath.Join(root, "home"), filepath.Join(root, "tools")
	if err := os.MkdirAll(tools, 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("AUTOMATOR_HOME", filepath.Join(home, "automator"))
	t.Setenv("PATH", tools)
	t.Setenv("SHELL", "/bin/sh")
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	mode, calls := filepath.Join(root, "mode"), filepath.Join(root, "calls")
	t.Setenv("TUI_FAKE_MODE", mode)
	t.Setenv("TUI_FAKE_CALLS", calls)
	// These are private fixtures, not wrappers around installed coding tools.
	tool := "#!/bin/sh\nif [ \"$1\" = --version ]; then printf 'fixture\\n'; exit 0; fi\nprintf '%s\\n' \"$*\" >> \"$TUI_FAKE_CALLS\"\nIFS= read -r mode < \"$TUI_FAKE_MODE\"\nif [ \"$mode\" = slow ]; then i=0; while [ \"$i\" -lt 100 ]; do /bin/sleep 0.05; i=$((i+1)); done; fi\nprintf 'fixture output\\n'\n"
	for name, script := range map[string]string{"opencode": tool, "git": "#!/bin/sh\nexit 0\n"} {
		if err := os.WriteFile(filepath.Join(tools, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	setMode := func(value string) {
		t.Helper()
		if err := os.WriteFile(mode, []byte(value+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	setMode("slow")
	if err := config.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	save := func(name string, value any) {
		t.Helper()
		if err := persistence.SaveYAML(filepath.Join(config.HomeDir(), name), value); err != nil {
			t.Fatal(err)
		}
	}
	save("providers.yaml", config.ProvidersFile{SchemaVersion: 1, Providers: map[string]config.Provider{"fixture": {DisplayName: "Fixture", Auth: "external"}}})
	save("models.yaml", config.ModelsFile{SchemaVersion: 1, Models: map[string]config.Model{"a": {DisplayName: "Fixture", Tool: config.Opencode, Provider: "fixture", Model: "fake"}}})
	save("drafts/task/v1.yaml", config.DraftRun{SchemaVersion: 1, Name: "task", Root: filepath.Join(root, "runs"), Concurrency: 1, Mode: config.Headless, Template: "empty", Heavy: true, Prompt: "isolated fixture"})
	data, err := loadDashboard()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	services := defaultServices()
	services.run = func(_ context.Context, request request) processResult {
		return runLogged(binary, filepath.Join(config.HomeDir(), "logs"), request)
	}
	m := newModel(ctx, data, services)
	press(m, "x")
	m.selection.models["a"] = true
	consume(t, m, consume(t, m, press(m, "enter")))
	if len(m.data.runs) != 1 || m.data.runs[0].states[0].Status != worker.Paused {
		t.Fatalf("immediate heavy launch should create paused states: %s", m.status)
	}
	run := m.data.runs[0].path
	waitState := func(want worker.Status) worker.State {
		t.Helper()
		for ctx.Err() == nil {
			state, err := worker.LoadState(run, "a")
			if err == nil && state.Status == want {
				if want == worker.Running {
					return state
				}
				if unlock, err := persistence.TryLock(worker.LifetimeLockPath(run, "a")); err == nil {
					unlock()
					return state
				}
			}
			time.Sleep(10 * time.Millisecond)
		}
		state, _ := worker.LoadState(run, "a")
		t.Fatalf("waiting for %s, got %+v; status %s", want, state, m.status)
		return state
	}
	refresh := func() { t.Helper(); consume(t, m, m.reload(false)) }
	m.section = runs
	consume(t, m, consume(t, m, press(m, "s")))
	waitState(worker.Running)
	for ctx.Err() == nil {
		if data, _ := os.ReadFile(calls); strings.Contains(string(data), "run --model") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	refresh()
	consume(t, m, consume(t, m, press(m, "ctrl+c")))
	waitState(worker.Cancelled)
	setMode("fast")
	refresh()
	consume(t, m, consume(t, m, press(m, "R")))
	state := waitState(worker.Done)
	backups, _ := os.ReadDir(filepath.Join(run, ".automator", "retry-backups"))
	if len(backups) == 0 {
		t.Fatal("retry did not preserve old project")
	}
	id := "fixture-session"
	state.Status, state.NativeSessionID = worker.Failed, &id
	if err := worker.SaveState(run, "a", state); err != nil {
		t.Fatal(err)
	}
	refresh()
	consume(t, m, consume(t, m, press(m, "u")))
	waitState(worker.Done)
	arguments, _ := os.ReadFile(calls)
	if !strings.Contains(string(arguments), "--session fixture-session") {
		t.Fatalf("continue did not resume captured session: %s", arguments)
	}
	refresh()
	m.section = drafts
	press(m, "x")
	m.selection.models["a"] = true
	press(m, "tab")
	cmd := consume(t, m, press(m, "enter")) // fresh state read starts FIFO head
	consume(t, m, consume(t, m, cmd))
	if len(m.data.runs) != 2 || m.data.runs[0].path == run || m.data.runs[0].states[0].Status != worker.Done {
		t.Fatalf("sequential heavy run did not execute: %s", m.status)
	}
}
