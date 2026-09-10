package tui

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"automator/internal/config"

	tea "github.com/charmbracelet/bubbletea"
)

func TestLaunchPickerSurvivesNewLatestDraftVersion(t *testing.T) {
	m := testModel(t)
	press(m, "x")
	m.selection.models["opus"] = true
	data := fixtureData()
	data.drafts[0].path, data.drafts[0].version = "/fixture/drafts/alpha/v3.yaml", "v3"
	data.drafts = append([]draftEntry{{name: "aaa", path: "/fixture/aaa/v1.yaml"}}, data.drafts...)
	m.replaceData(data)
	if m.selected[drafts] != 1 {
		t.Fatal("new version and concurrent insertion changed draft identity")
	}
	cmd := press(m, "enter")
	if cmd == nil || m.selection != nil || len(m.processes) != 1 {
		t.Fatalf("latest version could not launch: %s", m.status)
	}
}

func TestAllRegistryAndTemplateEditorKeys(t *testing.T) {
	for _, key := range []string{"e", "enter"} {
		m := testModel(t)
		for pane, file := range []string{"models.yaml", "model-presets.yaml", "providers.yaml", "templates.yaml"} {
			m.section, m.pane = models, pane%3
			if pane == 3 {
				m.section = templates
			}
			m.services.external = func(cmd *exec.Cmd, callback tea.ExecCallback) tea.Cmd {
				if filepath.Base(cmd.Args[len(cmd.Args)-1]) != file {
					t.Fatal("wrong registry editor")
				}
				return func() tea.Msg { return callback(nil) }
			}
			consume(t, m, press(m, key))
		}
	}
}

func TestNarrowListsKeepSelectedLastRowVisible(t *testing.T) {
	m := testModel(t)
	for _, size := range [][2]int{{40, 24}, {32, 18}, {26, 14}} {
		m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
		m.section, m.pane = models, 0
		m.registrySelected[0] = 1
		m.syncDetail(false)
		if size[1] >= 18 && !strings.Contains(m.registryView(0, size[0], m.geometry().listH), "> qwen") {
			t.Fatalf("registry selection hidden at %v", size)
		}
		m.section = drafts
		press(m, "x")
		m.selection.draftName = strings.Repeat("long-draft-name", 10)
		press(m, "end")
		if !strings.Contains(m.selectionView(), "IMMEDIATE") {
			t.Fatal("long draft name hid the launch mode")
		}
		if !strings.Contains(m.selectionView(), "> [ ] MODEL   qwen") {
			t.Fatalf("picker selection hidden at %v: %s", size, m.selectionView())
		}
		press(m, "esc")
	}
}

func TestPageNavigationUsesActualNarrowPaneHeight(t *testing.T) {
	m := testModel(t)
	m.data.drafts = nil
	for i := 0; i < 30; i++ {
		m.data.drafts = append(m.data.drafts, draftEntry{})
	}
	m.Update(tea.WindowSizeMsg{Width: 40, Height: 24})
	press(m, "pgdown")
	if m.selected[drafts] != m.geometry().listH-3 {
		t.Fatal("page skipped more rows than fit on screen")
	}
}

func TestPickerBlinkMessagesAndFilteredToggle(t *testing.T) {
	m := testModel(t)
	cmd := press(m, "x")
	if cmd == nil {
		t.Fatal("text input focus command not dispatched")
	}
	m.Update(cmd())
	press(m, "ANTHROPIC")
	press(m, " ")
	if !m.selection.models["opus"] {
		t.Fatal("provider filter/toggle failed")
	}
	press(m, "backspace")
	if m.selection.filter.Value() != "ANTHROPI" {
		t.Fatal("backspace not passed to native text input")
	}
	press(m, "delete")
	if m.selection.filter.Value() != "" {
		t.Fatal("Delete should clear entire filter")
	}
	m.data.presets["broken"] = config.ModelPreset{Models: []string{"absent"}}
	m.selection.presets["broken"] = true
	if press(m, "enter") != nil || !strings.Contains(m.status, "unknown model") {
		t.Fatal("broken preset launched")
	}
}
