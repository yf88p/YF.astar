package tui

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"automator/internal/config"
	"automator/internal/executor"
	"automator/internal/persistence"
	"automator/internal/process"
	"automator/internal/util"

	tea "github.com/charmbracelet/bubbletea"
)

type processKind int

const (
	actionProcess processKind = iota
	parallelProcess
	sequentialProcess
)

type request struct {
	kind  processKind
	label string
	args  []string
}

type processResult struct {
	logPath string
	err     error
}

// Side effects are injected at the command boundary, keeping reducer tests
// independent of terminals, credentials, sessions and subprocess timing.
type services struct {
	load             func() (dashboardData, error)
	run              func(context.Context, request) processResult
	delete           func(context.Context, string, string) error
	copy             func(context.Context, string) error
	createDraft      func(string) (string, error)
	lookup           func(string) (string, error)
	external         func(*exec.Cmd, tea.ExecCallback) tea.Cmd
	prepareRunAttach func(context.Context, runEntry) (*exec.Cmd, error)
}

func defaultServices() services {
	return services{
		load: loadDashboard, run: runAutomator, copy: copyClipboard, createDraft: createDraft,
		lookup: exec.LookPath, external: tea.ExecProcess,
		prepareRunAttach: prepareRunAttach,
		delete: func(ctx context.Context, path, model string) error {
			if model == "" {
				return executor.DeleteRun(ctx, path)
			}
			return executor.DeleteModel(ctx, path, model)
		},
	}
}

func runAutomator(ctx context.Context, request request) processResult {
	if err := ctx.Err(); err != nil {
		return processResult{err: err}
	}
	exe, err := os.Executable()
	if err != nil {
		return processResult{err: err}
	}
	return runLogged(exe, filepath.Join(config.HomeDir(), "logs"), request)
}

func createDraft(template string) (string, error) {
	root := filepath.Join(config.HomeDir(), "drafts")
	if err := os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	for n := 1; ; n++ {
		name := "new-run"
		if n > 1 {
			name = fmt.Sprintf("new-run-%d", n)
		}
		dir := filepath.Join(root, name)
		// Reserve the directory atomically. Never overwrite an existing draft.
		if err := os.Mkdir(dir, 0700); os.IsExist(err) {
			continue
		} else if err != nil {
			return "", err
		}
		path := filepath.Join(dir, "v1.yaml")
		draft := config.DraftRun{SchemaVersion: 1, Name: name, Root: "~/automator-runs", Concurrency: 6,
			Mode: config.Headful, Template: template, Prompt: "Describe the task here.",
			Pre: []config.ShellStep{}, PostEach: []config.ShellStep{}, PostAll: []config.ShellStep{}}
		if err := persistence.SaveYAML(path, draft); err != nil {
			return "", err
		}
		return path, nil
	}
}

// EDITOR and PAGER are shell command strings. The filename is a positional
// argument, never interpolated into their shell source.
func commandForFile(ctx context.Context, setting, fallback, path string) (*exec.Cmd, error) {
	program := strings.TrimSpace(os.Getenv(setting))
	if program == "" {
		program = fallback
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	if strings.ContainsRune(program, '\x00') {
		return nil, fmt.Errorf("invalid %s", setting)
	}
	return exec.CommandContext(ctx, shell, "-c", "exec "+program+" \"$1\"", "automator-"+strings.ToLower(setting), path), nil
}

func editorCommand(ctx context.Context, path string) (*exec.Cmd, error) {
	return commandForFile(ctx, "EDITOR", "vi", path)
}

type preparedMsg struct {
	cmd   *exec.Cmd
	label string
	err   error
}

func (m *model) openReport() tea.Cmd {
	row, err := m.selectedRun(false)
	if err != nil {
		m.feedback("", err)
		return nil
	}
	if m.externalBusy {
		return nil
	}
	m.externalBusy = true
	path, ctx := filepath.Join(row.run.path, "report.md"), m.ctx
	return func() tea.Msg {
		if _, err := os.Stat(path); err != nil {
			return preparedMsg{err: fmt.Errorf("open report: %w", err)}
		}
		cmd, err := commandForFile(ctx, "PAGER", "less", path)
		return preparedMsg{cmd: cmd, label: "opened report", err: err}
	}
}

func (m *model) attachModel() tea.Cmd {
	row, err := m.selectedRun(true)
	if err != nil {
		m.feedback("", err)
		return nil
	}
	if row.run.snapshot != nil {
		exe, err := os.Executable()
		if err != nil {
			m.feedback("", err)
			return nil
		}
		return m.external(exec.CommandContext(m.ctx, exe, "attach", row.run.path, row.state.Model), "opened model session")
	}
	if strings.TrimSpace(row.state.NativeReopen) == "" || strings.Contains(row.state.NativeReopen, "<session-id>") {
		m.feedback("", fmt.Errorf("Herdr target unavailable and no native session id captured for %s", row.state.Model))
		return nil
	}
	return m.external(exec.CommandContext(m.ctx, util.PreferredShell(), "-lc", row.state.NativeReopen), "opened native session")
}

func (m *model) attachRun() tea.Cmd {
	row, err := m.selectedRun(false)
	if err != nil {
		m.feedback("", err)
		return nil
	}
	if m.externalBusy {
		return nil
	}
	m.externalBusy = true
	prepare, ctx, run := m.services.prepareRunAttach, m.ctx, *row.run
	return func() tea.Msg {
		cmd, err := prepare(ctx, run)
		return preparedMsg{cmd: cmd, label: "opened Herdr", err: err}
	}
}

func prepareRunAttach(ctx context.Context, run runEntry) (*exec.Cmd, error) {
	if run.snapshot == nil {
		return nil, fmt.Errorf("run has no snapshot/run.yaml")
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	// An empty model requests run-level attachment through the same Herdr
	// boundary as Enter, including isolated routing and stale-target checks.
	return exec.CommandContext(ctx, exe, "attach", run.path, ""), nil
}

func copyClipboard(ctx context.Context, text string) error {
	commands := [][]string{{"wl-copy"}, {"xclip", "-selection", "clipboard"}, {"xsel", "--clipboard", "--input"}, {"pbcopy"}}
	for _, args := range commands {
		if _, err := exec.LookPath(args[0]); err != nil {
			continue
		}
		cmd := process.CommandContext(ctx, args[0], args[1:]...)
		cmd.Stdin = strings.NewReader(text)
		err := cmd.Run()
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return fmt.Errorf("no working clipboard command; install wl-copy, xclip, xsel, or pbcopy")
}
