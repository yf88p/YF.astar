package tui

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"automator/internal/config"
	"automator/internal/persistence"

	tea "github.com/charmbracelet/bubbletea"
)

func TestCreateDraftReservesUniqueDirectory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("AUTOMATOR_HOME", home)
	if err := config.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	// Even an existing directory without v1.yaml belongs to somebody else.
	if err := os.Mkdir(filepath.Join(home, "drafts", "new-run"), 0700); err != nil {
		t.Fatal(err)
	}
	first, err := createDraft("chosen")
	if err != nil {
		t.Fatal(err)
	}
	second, err := createDraft("other")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(filepath.Dir(first)) != "new-run-2" || filepath.Base(filepath.Dir(second)) != "new-run-3" {
		t.Fatalf("paths %s %s", first, second)
	}
	var draft config.DraftRun
	if err := persistence.LoadYAML(first, &draft); err != nil {
		t.Fatal(err)
	}
	if draft.Template != "chosen" || draft.Concurrency != 6 || draft.Mode != config.Headful || draft.SchemaVersion != 1 || draft.Heavy {
		t.Fatalf("defaults: %+v", draft)
	}
}

func TestEditorCommandPreservesArgumentsAndQuotesPath(t *testing.T) {
	t.Setenv("EDITOR", "editor --wait --line 7")
	t.Setenv("SHELL", "/bin/sh")
	path := "/fixture/space and 'quotes'; $(not-executed).yaml"
	cmd, err := editorCommand(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"/bin/sh", "-c", "exec editor --wait --line 7 \"$1\"", "automator-editor", path}
	if !reflect.DeepEqual(cmd.Args, want) {
		t.Fatalf("got %q want %q", cmd.Args, want)
	}
}

func TestEditorHandoffAndFailedReturn(t *testing.T) {
	m := testModel(t)
	var command *exec.Cmd
	m.services.external = func(cmd *exec.Cmd, callback tea.ExecCallback) tea.Cmd {
		command = cmd
		return func() tea.Msg { return callback(errors.New("editor failed")) }
	}
	cmd := press(m, "e")
	if command == nil || command.Args[len(command.Args)-1] != "/fixture/drafts/alpha/v2.yaml" || !m.externalBusy {
		t.Fatal("editor not handed off")
	}
	consume(t, m, cmd)
	if m.externalBusy || !strings.Contains(m.status, "editor failed") {
		t.Fatal("editor failure not recovered")
	}
	m.section, m.pane = models, 1
	press(m, "enter")
	if !strings.HasSuffix(command.Args[len(command.Args)-1], "model-presets.yaml") {
		t.Fatal("preset editor path")
	}
}

func TestNewDraftOpensEditorThenSelectsCreatedDraft(t *testing.T) {
	m := testModel(t)
	path := "/fixture/new-run/v1.yaml"
	m.services.external = func(cmd *exec.Cmd, callback tea.ExecCallback) tea.Cmd {
		if cmd.Args[len(cmd.Args)-1] != path {
			t.Fatal("new editor target")
		}
		return func() tea.Msg { return callback(nil) }
	}
	m.services.load = func() (dashboardData, error) {
		data := fixtureData()
		data.drafts = append(data.drafts, draftEntry{name: "new-run", path: path})
		return data, nil
	}
	m.section = templates
	cmd := press(m, "n")
	cmd = consume(t, m, cmd)
	cmd = consume(t, m, cmd)
	consume(t, m, cmd)
	if m.section != drafts || m.selected[drafts] != 2 {
		t.Fatal("new draft not selected after editor return")
	}
}

func TestAttachAndReportAreForegroundHandoffs(t *testing.T) {
	for _, key := range []string{"enter", "t", "o"} {
		t.Run(key, func(t *testing.T) {
			m := testModel(t)
			m.section = runs
			m.data.runs[0].snapshot = &config.RunSnapshot{HerdrSession: "test session"}
			var command *exec.Cmd
			m.services.external = func(cmd *exec.Cmd, callback tea.ExecCallback) tea.Cmd {
				command = cmd
				return func() tea.Msg { return callback(nil) }
			}
			if key == "o" {
				m.data.runs[0].path = t.TempDir()
				if err := os.WriteFile(filepath.Join(m.data.runs[0].path, "report.md"), []byte("existing report, keep unchanged"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			cmd := press(m, key)
			if key != "enter" {
				cmd = consume(t, m, cmd)
			}
			if command == nil || cmd == nil {
				t.Fatal("foreground handoff missing")
			}
			if key == "enter" && !reflect.DeepEqual(command.Args[1:], []string{"attach", "/fixture/run-2026", "opus"}) {
				t.Fatalf("attach args %v", command.Args)
			}
			if key == "o" {
				path := filepath.Join(m.data.runs[0].path, "report.md")
				contents, err := os.ReadFile(path)
				if err != nil || string(contents) != "existing report, keep unchanged" || command.Args[len(command.Args)-1] != path {
					t.Fatal("open report regenerated or selected a different file")
				}
			}
			consume(t, m, cmd)
			if m.externalBusy {
				t.Fatal("terminal handoff did not complete")
			}
		})
	}
}

func TestNativeReopenAndCopyGuards(t *testing.T) {
	m := testModel(t)
	m.section = runs
	var command *exec.Cmd
	m.services.external = func(cmd *exec.Cmd, callback tea.ExecCallback) tea.Cmd {
		command = cmd
		return func() tea.Msg { return callback(nil) }
	}
	press(m, "enter")
	if command == nil || command.Args[len(command.Args)-1] != "opencode --session known" {
		t.Fatal("native fallback missing")
	}
	m.externalBusy = false
	var copied string
	m.services.copy = func(_ context.Context, text string) error { copied = text; return nil }
	m.externalBusy = true
	consume(t, m, press(m, "c"))
	if copied != "opencode --session known" {
		t.Fatal("copy did not receive reopen command")
	}
	if !m.externalBusy {
		t.Fatal("clipboard completion cleared an unrelated terminal handoff")
	}
	m.externalBusy = false
	m.data.runs[0].states[0].NativeReopen = "opencode --session <session-id>"
	if press(m, "c") != nil || press(m, "enter") != nil {
		t.Fatal("placeholder session was copied or opened")
	}
}

func TestLoggedProcessFailureAndUniqueLogs(t *testing.T) {
	// This uses only a tiny local shell helper, never the Automator binary.
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("requires sh")
	}
	dir := t.TempDir()
	request := request{kind: actionProcess, label: "test", args: []string{"-c", "printf 'specific failure\\n'; exit 7"}}
	first := runLogged("sh", dir, request)
	if first.err == nil || !strings.Contains(first.err.Error(), "specific failure") || first.logPath == "" {
		t.Fatalf("missing failure detail: %+v", first)
	}
	second := runLogged("sh", dir, request)
	if first.logPath == second.logPath {
		t.Fatal("concurrent action logs may overwrite each other")
	}
	info, err := os.Stat(first.logPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("log mode %v", info.Mode())
	}
	missing := runLogged(filepath.Join(dir, "missing"), dir, request)
	if missing.err == nil || missing.logPath == "" {
		t.Fatal("spawn failure not reported with log")
	}
}

func TestRunHonorsAlreadyCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(Run(ctx), context.Canceled) {
		t.Fatal("cancelled Run did not return before terminal setup")
	}
	if result := runAutomator(ctx, request{}); !errors.Is(result.err, context.Canceled) {
		t.Fatal("cancelled action was launched")
	}
}
