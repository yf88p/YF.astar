package tui

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

type handoffTestModel struct {
	*model
	command tea.Cmd
}

func (m handoffTestModel) Init() tea.Cmd { return m.command }

func TestBubbleTeaRestoresAlternateScreenAfterExternalFailure(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("requires sh")
	}
	m := testModel(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var output bytes.Buffer
	var externalErr error
	command := tea.ExecProcess(exec.CommandContext(ctx, "sh", "-c", "exit 7"), func(err error) tea.Msg {
		externalErr = err
		return tea.QuitMsg{}
	})
	p := tea.NewProgram(handoffTestModel{model: m, command: command}, tea.WithContext(ctx),
		tea.WithInput(strings.NewReader("")), tea.WithOutput(&output), tea.WithAltScreen(), tea.WithoutSignalHandler())
	if _, err := p.Run(); err != nil {
		t.Fatal(err)
	}
	if externalErr == nil {
		t.Fatal("external failure not delivered")
	}
	text := output.String()
	if strings.Count(text, "\x1b[?1049h") < 2 || strings.Count(text, "\x1b[?1049l") < 2 {
		t.Fatal("alternate screen not released for command, restored on return, and released on quit")
	}
	if !strings.Contains(text, "\x1b[?25h") {
		t.Fatal("cursor not restored")
	}
}

func TestBubbleTeaRestoresScreenOnCancellation(t *testing.T) {
	m := testModel(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var output bytes.Buffer
	command := func() tea.Msg { cancel(); return nil }
	p := tea.NewProgram(handoffTestModel{model: m, command: command}, tea.WithContext(ctx),
		tea.WithInput(strings.NewReader("")), tea.WithOutput(&output), tea.WithAltScreen(), tea.WithoutSignalHandler())
	if _, err := p.Run(); !errors.Is(err, tea.ErrProgramKilled) {
		t.Fatalf("cancellation error: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "\x1b[?1049l") || !strings.Contains(text, "\x1b[?25h") {
		t.Fatal("cancelled program did not restore screen/cursor")
	}
}
