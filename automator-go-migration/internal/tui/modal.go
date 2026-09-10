package tui

import (
	"fmt"
	"strings"

	"automator/internal/config"
	"automator/internal/worker"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
)

type selectionRow struct {
	key, label string
	preset     bool
}

func (m *model) openSelection() tea.Cmd {
	if m.section != drafts || m.selected[drafts] >= len(m.data.drafts) {
		m.feedback("", fmt.Errorf("select a draft first"))
		return nil
	}
	if len(m.data.models) == 0 {
		m.feedback("", fmt.Errorf("no models configured; edit models.yaml first"))
		return nil
	}
	draft := m.data.drafts[m.selected[drafts]]
	input := textinput.New()
	input.Prompt, input.Placeholder, input.CharLimit = "Filter: ", "all presets and models", 200
	cmd := input.Focus()
	m.selection = &selectionModal{draftName: draft.name, filter: input,
		models: make(map[string]bool), presets: make(map[string]bool)}
	return cmd
}

func (m *model) selectionRows() []selectionRow {
	if m.selection == nil {
		return nil
	}
	filter := strings.ToLower(m.selection.filter.Value())
	var rows []selectionRow
	for _, key := range config.SortedKeys(m.data.presets) {
		preset := m.data.presets[key]
		if strings.Contains(strings.ToLower(key+" "+preset.DisplayName+" "+strings.Join(preset.Models, " ")), filter) {
			rows = append(rows, selectionRow{key: key, preset: true,
				label: "PRESET  " + key + ": " + preset.DisplayName + " (" + strings.Join(preset.Models, ", ") + ")"})
		}
	}
	for _, key := range config.SortedKeys(m.data.models) {
		model := m.data.models[key]
		if strings.Contains(strings.ToLower(key+" "+model.DisplayName+" "+model.Provider+" "+model.Model), filter) {
			rows = append(rows, selectionRow{key: key, label: "MODEL   " + key + ": " + model.DisplayName})
		}
	}
	return rows
}

func (m *model) selectionKey(key tea.KeyMsg) tea.Cmd {
	modal := m.selection
	rows := m.selectionRows()
	switch key.String() {
	case "esc":
		if modal.filter.Value() == "" {
			m.selection = nil
		} else {
			modal.filter.SetValue("")
			modal.cursor = 0
		}
	case "tab", "shift+tab":
		m.sequential = !m.sequential
	case "up":
		modal.cursor = max(0, modal.cursor-1)
	case "down":
		modal.cursor = min(max(0, len(rows)-1), modal.cursor+1)
	case "pgup":
		modal.cursor = max(0, modal.cursor-m.selectionPageSize())
	case "pgdown":
		modal.cursor = min(max(0, len(rows)-1), modal.cursor+m.selectionPageSize())
	case "home":
		modal.cursor = 0
	case "end":
		modal.cursor = max(0, len(rows)-1)
	case " ", "space":
		if modal.cursor < len(rows) {
			row := rows[modal.cursor]
			selected := modal.models
			if row.preset {
				selected = modal.presets
			}
			if selected[row.key] {
				delete(selected, row.key)
			} else {
				selected[row.key] = true
			}
		}
	case "delete", "ctrl+u":
		modal.filter.SetValue("")
		modal.cursor = 0
	case "enter":
		return m.launchSelection()
	case "ctrl+c":
		m.selection = nil
	default:
		var cmd tea.Cmd
		modal.filter, cmd = modal.filter.Update(key)
		modal.cursor = 0
		return cmd
	}
	return nil
}

func (m *model) launchSelection() tea.Cmd {
	modal := m.selection
	var draft *draftEntry
	for i := range m.data.drafts {
		if m.data.drafts[i].name == modal.draftName {
			draft = &m.data.drafts[i]
			break
		}
	}
	var err error
	switch {
	case draft == nil:
		err = fmt.Errorf("selected draft no longer exists")
	case draft.draft == nil:
		err = fmt.Errorf("draft YAML is invalid; edit it before running")
	case draft.draft.Mode == config.Headful:
		if _, lookupErr := m.services.lookup("herdr"); lookupErr != nil {
			err = fmt.Errorf("herdr not found in PATH; install herdr or set this draft to mode: headless")
		}
	}
	if err != nil {
		m.feedback("", err)
		return nil
	}
	args := []string{"run", draft.name}
	if m.sequential {
		args = append(args, "--run-heavy")
	}
	count := 0
	for _, key := range config.SortedKeys(modal.presets) {
		preset, ok := m.data.presets[key]
		if !ok {
			m.feedback("", fmt.Errorf("preset %q no longer exists", key))
			return nil
		}
		for _, model := range preset.Models {
			if _, ok := m.data.models[model]; !ok {
				m.feedback("", fmt.Errorf("preset %q contains unknown model %q", key, model))
				return nil
			}
		}
		count += len(preset.Models)
		args = append(args, "--preset", key)
	}
	for _, key := range config.SortedKeys(modal.models) {
		if _, ok := m.data.models[key]; !ok {
			m.feedback("", fmt.Errorf("model %q no longer exists", key))
			return nil
		}
		count++
		args = append(args, "--model", key)
	}
	if count == 0 {
		m.feedback("", fmt.Errorf("select at least one model or non-empty preset"))
		return nil
	}
	m.selection = nil
	request := request{kind: parallelProcess, args: args, label: "run " + draft.name}
	if !m.sequential {
		return m.dispatch(request)
	}
	request.kind = sequentialProcess
	m.queue = append(m.queue, request)
	m.epoch++
	m.feedback(fmt.Sprintf("run queued sequentially (%d waiting)", len(m.queue)), nil)
	// Dispatch only after a fresh disk read, including runs started elsewhere.
	return m.reload(false)
}

func (m *model) openDelete(entireRun bool) {
	row, err := m.selectedRun(!entireRun)
	if err == nil {
		for _, state := range row.run.states {
			if state.Status == worker.Running && (entireRun || state.Model == row.state.Model) {
				err = fmt.Errorf("a running model or a run containing one cannot be deleted")
				break
			}
		}
	}
	if err != nil {
		m.feedback("", err)
		return
	}
	target := &deleteModal{name: row.run.name, path: row.run.path}
	if !entireRun {
		target.model = row.state.Model
	}
	m.deletion = target
}

func (m *model) deleteKey(key tea.KeyMsg) tea.Cmd {
	if m.deletion.busy {
		return nil
	}
	switch key.String() {
	case "n", "N", "esc", "q", "ctrl+c":
		m.deletion = nil
	case "y", "Y":
		m.deletion.busy = true
		target, remove, ctx := *m.deletion, m.services.delete, m.ctx
		return func() tea.Msg {
			// The executor re-reads under run/model locks and validates index,
			// snapshot identity, symlinks and running states before deleting.
			return deletedMsg{target: target, err: remove(ctx, target.path, target.model)}
		}
	}
	return nil
}
