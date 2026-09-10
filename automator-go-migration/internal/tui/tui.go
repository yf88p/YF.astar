// Package tui implements the dashboard-first terminal interface.
package tui

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"automator/internal/config"
	"automator/internal/util"
	"automator/internal/worker"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
)

type section int

const (
	drafts section = iota
	runs
	stats
	models
	templates
	sectionCount
)

var sectionNames = [...]string{"Drafts", "Runs", "Stats", "Models", "Templates"}
var paneNames = [...]string{"Models", "Presets", "Providers"}

type selectionModal struct {
	draftName       string
	cursor          int
	filter          textinput.Model
	models, presets map[string]bool
}

type deleteModal struct {
	name, path, model string
	busy              bool
}

type model struct {
	ctx              context.Context
	services         services
	data             dashboardData
	section          section
	selected         [sectionCount]int
	pane             int
	registrySelected [3]int
	width, height    int
	detail           viewport.Model
	help             viewport.Model
	selection        *selectionModal
	deletion         *deleteModal
	confirmQuit      bool
	showHelp         bool
	sequential       bool
	queue            []request
	processes        map[int]request
	nextID           int
	epoch            uint64
	loading          bool
	status           string
	statusUntil      time.Time
	newDraftPath     string
	externalBusy     bool
}

type tickMsg time.Time
type loadedMsg struct {
	data   dashboardData
	err    error
	epoch  uint64
	manual bool
}
type processMsg struct {
	id     int
	result processResult
}
type actionMsg struct {
	label, createdPath string
	err                error
}
type copiedMsg struct{ err error }
type deletedMsg struct {
	target deleteModal
	err    error
}

// Run gives Bubble Tea ownership of terminal and panic cleanup. The caller owns
// OS signals through ctx, as cmd/automator's signal.NotifyContext does.
func Run(ctx context.Context) error {
	if os.Getenv(logHelperEnv) == "1" {
		return runLogHelper(ctx)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := config.EnsureHome(); err != nil {
		return err
	}
	data, err := loadDashboard()
	if err != nil {
		return err
	}
	m := newModel(ctx, data, defaultServices())
	// Bubble Tea's killed/context-cancel path closes the cancel-reader without
	// waiting for its input goroutine. Graceful Quit waits, avoiding that race.
	// Commands still use the original ctx so an editor also exits on a signal.
	program := tea.NewProgram(m, tea.WithContext(context.WithoutCancel(ctx)), tea.WithAltScreen(), tea.WithoutSignalHandler())
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-ctx.Done():
			program.Quit()
		case <-finished:
		}
	}()
	_, err = program.Run()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}

func newModel(ctx context.Context, data dashboardData, services services) *model {
	m := &model{ctx: ctx, services: services, data: data, width: 100, height: 30,
		detail: viewport.New(60, 20), help: viewport.New(98, 18), processes: make(map[int]request)}
	m.syncDetail(false)
	return m
}

func tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (m *model) Init() tea.Cmd { return tick() }

func (m *model) feedback(text string, err error) {
	ttl := 4 * time.Second
	if err != nil {
		text = "error: " + err.Error()
		ttl = 12 * time.Second
	}
	m.status, m.statusUntil = util.RedactSecrets(text), time.Now().Add(ttl)
}

func (m *model) reload(manual bool) tea.Cmd {
	if m.loading {
		return nil
	}
	m.loading = true
	epoch, load := m.epoch, m.services.load
	return func() tea.Msg {
		data, err := load()
		return loadedMsg{data: data, err: err, epoch: epoch, manual: manual}
	}
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if m.ctx.Err() != nil {
		return m, tea.Quit
	}
	var cmd tea.Cmd
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = max(1, msg.Width), max(1, msg.Height)
	case tickMsg:
		if !m.statusUntil.IsZero() && !time.Time(msg).Before(m.statusUntil) {
			m.status, m.statusUntil = "", time.Time{}
		}
		cmd = tea.Batch(tick(), m.reload(false))
	case loadedMsg:
		m.loading = false
		if msg.epoch != m.epoch {
			cmd = m.reload(msg.manual)
		} else if msg.err != nil {
			m.feedback("", fmt.Errorf("refresh: %w", msg.err))
		} else {
			m.replaceData(msg.data)
			if msg.manual {
				m.feedback("refreshed", nil)
			}
			cmd = m.startNextQueued()
		}
	case processMsg:
		if request, ok := m.processes[msg.id]; ok {
			delete(m.processes, msg.id)
			m.epoch++
			if msg.result.err != nil {
				detail := msg.result.err.Error()
				if msg.result.logPath != "" {
					detail += " (log: " + msg.result.logPath + ")"
				}
				m.feedback("", fmt.Errorf("%s failed: %s", request.label, detail))
			} else if !strings.HasPrefix(m.status, "error:") || time.Now().After(m.statusUntil) {
				m.feedback(request.label+" finished", nil)
			}
			cmd = m.reload(false)
		}
	case actionMsg:
		m.externalBusy = false
		m.epoch++
		if msg.createdPath != "" {
			m.newDraftPath = msg.createdPath
			cmd = m.editPath(msg.createdPath, "created draft")
		} else {
			m.feedback(msg.label, msg.err)
			cmd = m.reload(false)
		}
	case copiedMsg:
		m.feedback("copied native reopen", msg.err)
	case preparedMsg:
		m.externalBusy = false
		if msg.err != nil {
			m.feedback("", msg.err)
		} else {
			cmd = m.external(msg.cmd, msg.label)
		}
	case deletedMsg:
		m.epoch++
		if msg.err != nil {
			if m.deletion != nil {
				m.deletion.busy = false
			}
			m.feedback("", fmt.Errorf("delete failed: %w", msg.err))
		} else {
			m.deletion = nil
			label := "deleted entire run and its files"
			if msg.target.model != "" {
				label = "deleted model " + msg.target.model + " and its files"
			}
			m.feedback(label, nil)
		}
		cmd = m.reload(false)
	case tea.KeyMsg:
		switch {
		case m.showHelp:
			if msg.String() == "?" || msg.String() == "esc" || msg.String() == "q" || msg.String() == "enter" {
				m.showHelp = false
			} else {
				m.help, cmd = m.help.Update(msg)
			}
		case m.confirmQuit:
			switch msg.String() {
			case "y", "Y":
				return m, tea.Quit
			case "n", "N", "esc", "q":
				m.confirmQuit = false
			}
		case m.selection != nil:
			cmd = m.selectionKey(msg)
		case m.deletion != nil:
			cmd = m.deleteKey(msg)
		default:
			cmd = m.key(msg)
		}
	default:
		if m.selection != nil {
			before := m.selection.filter.Value()
			m.selection.filter, cmd = m.selection.filter.Update(msg)
			if before != m.selection.filter.Value() {
				m.selection.cursor = 0
			}
		}
	}
	m.syncDetail(false)
	return m, cmd
}

func (m *model) key(msg tea.KeyMsg) tea.Cmd {
	oldSection, oldPane, oldSelection := m.section, m.pane, m.currentSelection()
	var cmd tea.Cmd
	switch msg.String() {
	case "?":
		m.showHelp = true
		m.help.GotoTop()
	case "q", "esc":
		if len(m.queue) > 0 {
			m.confirmQuit = true
		} else {
			return tea.Quit
		}
	case "left", "h":
		m.section = max(0, m.section-1)
	case "right", "l":
		m.section = min(sectionCount-1, m.section+1)
	case "tab":
		if m.section == models {
			m.pane = (m.pane + 1) % 3
		} else {
			m.section = min(sectionCount-1, m.section+1)
		}
	case "shift+tab":
		if m.section == models {
			m.pane = (m.pane + 2) % 3
		} else {
			m.section = max(0, m.section-1)
		}
	case "up":
		m.moveSelection(-1)
	case "down", "j":
		m.moveSelection(1)
	case "pgup":
		m.moveSelection(-m.listPageSize())
	case "pgdown":
		m.moveSelection(m.listPageSize())
	case "home", "g":
		m.moveSelection(-m.currentSelection())
	case "end", "G":
		m.moveSelection(m.currentLen())
	case "ctrl+u":
		m.detail.HalfViewUp()
	case "ctrl+d":
		m.detail.HalfViewDown()
	case "shift+up":
		m.detail.ScrollUp(1)
	case "shift+down":
		m.detail.ScrollDown(1)
	case "r":
		cmd = m.reload(true)
	case "x":
		cmd = m.openSelection()
	case "d":
		m.openDelete(false)
	case "D":
		m.openDelete(true)
	case "s":
		cmd = m.modelAction("start")
	case "k", "ctrl+c":
		cmd = m.modelAction("stop")
	case "u":
		cmd = m.modelAction("continue")
	case "R":
		cmd = m.modelAction("retry")
	case "c":
		cmd = m.copyReopen()
	case "n":
		cmd = m.createDraft()
	case "e":
		cmd = m.editCurrent()
	case "o":
		cmd = m.openReport()
	case "t":
		cmd = m.attachRun()
	case "enter":
		if m.section == runs {
			cmd = m.attachModel()
		} else {
			cmd = m.editCurrent()
		}
	}
	if oldSection != m.section || oldPane != m.pane || oldSelection != m.currentSelection() {
		m.detail.GotoTop()
	}
	return cmd
}

func (m *model) currentSelection() int {
	if m.section == models {
		return m.registrySelected[m.pane]
	}
	return m.selected[m.section]
}

func (m *model) currentLen() int { return len(m.ids(m.section, m.pane)) }

func (m *model) listPageSize() int {
	g := m.geometry()
	if m.section == stats {
		height := g.body
		if m.width < 72 {
			height /= 2
		}
		return max(1, height-3)
	}
	return max(1, g.listH-3)
}

func (m *model) moveSelection(delta int) {
	next := min(max(0, m.currentSelection()+delta), max(0, m.currentLen()-1))
	if m.section == models {
		m.registrySelected[m.pane] = next
	} else {
		m.selected[m.section] = next
	}
}

func (m *model) ids(section section, pane int) []string {
	var ids []string
	switch section {
	case drafts:
		for _, draft := range m.data.drafts {
			ids = append(ids, draft.name)
		}
	case runs:
		for _, row := range m.data.runRows() {
			ids = append(ids, row.id())
		}
	case stats:
		for _, row := range m.data.stats() {
			ids = append(ids, row.model)
		}
	case models:
		switch pane {
		case 0:
			ids = config.SortedKeys(m.data.models)
		case 1:
			ids = config.SortedKeys(m.data.presets)
		case 2:
			ids = config.SortedKeys(m.data.providers)
		}
	case templates:
		ids = config.SortedKeys(m.data.templates)
	}
	return ids
}

func (m *model) replaceData(data dashboardData) {
	var selectedIDs [sectionCount]string
	var registryIDs [3]string
	for s := section(0); s < sectionCount; s++ {
		selectedIDs[s] = at(m.ids(s, 0), m.selected[s])
	}
	for p := range registryIDs {
		registryIDs[p] = at(m.ids(models, p), m.registrySelected[p])
	}
	m.data = data
	for s := section(0); s < sectionCount; s++ {
		m.selected[s] = retainSelection(m.ids(s, 0), selectedIDs[s], m.selected[s])
	}
	for p := range registryIDs {
		m.registrySelected[p] = retainSelection(m.ids(models, p), registryIDs[p], m.registrySelected[p])
	}
	if m.newDraftPath != "" {
		m.section = drafts
		m.selected[drafts] = retainSelection(m.ids(drafts, 0), filepath.Base(filepath.Dir(m.newDraftPath)), 0)
		m.newDraftPath = ""
		m.detail.GotoTop()
	}
	if m.selection != nil {
		m.selection.cursor = min(m.selection.cursor, max(0, len(m.selectionRows())-1))
	}
}

func at(values []string, index int) string {
	if index < 0 || index >= len(values) {
		return ""
	}
	return values[index]
}

func retainSelection(ids []string, id string, previous int) int {
	for i, candidate := range ids {
		if candidate == id {
			return i
		}
	}
	return min(max(0, previous), max(0, len(ids)-1))
}

func (m *model) selectedRun(requireModel bool) (runRow, error) {
	rows := m.data.runRows()
	if m.section != runs || m.selected[runs] >= len(rows) {
		return runRow{}, fmt.Errorf("select a model under Runs first")
	}
	row := rows[m.selected[runs]]
	if requireModel && row.state == nil {
		return runRow{}, fmt.Errorf("no model state available for this run")
	}
	return row, nil
}

func (m *model) modelAction(action string) tea.Cmd {
	row, err := m.selectedRun(true)
	if err == nil && action == "stop" && row.state.Status != worker.Running {
		err = fmt.Errorf("selected model is %s, not running", row.state.Status)
	}
	if err != nil {
		m.feedback("", err)
		return nil
	}
	// Use the indexed path, not the potentially ambiguous human run name.
	return m.dispatch(request{kind: actionProcess, args: []string{action, row.run.path, row.state.Model}, label: action + " " + row.run.name + "/" + row.state.Model})
}

func (m *model) dispatch(request request) tea.Cmd {
	m.nextID++
	id, run, ctx := m.nextID, m.services.run, m.ctx
	m.processes[id] = request
	m.epoch++
	m.feedback(request.label+" requested", nil)
	return func() tea.Msg { return processMsg{id: id, result: run(ctx, request)} }
}

func (m *model) startNextQueued() tea.Cmd {
	if len(m.queue) == 0 || m.deletion != nil || m.confirmQuit {
		return nil
	}
	for _, process := range m.processes {
		if process.kind != actionProcess {
			return nil
		}
	}
	for _, run := range m.data.runs {
		// Missing or unreadable states must not let another heavy run overlap.
		if run.err != nil {
			return nil
		}
		for _, state := range run.states {
			if blocksQueue(state.Status) {
				return nil
			}
		}
	}
	request := m.queue[0]
	m.queue = m.queue[1:]
	status, expires := m.status, m.statusUntil
	cmd := m.dispatch(request)
	if strings.HasPrefix(status, "error:") && time.Now().Before(expires) {
		m.status, m.statusUntil = status, expires
	}
	return cmd
}

func (m *model) external(cmd *exec.Cmd, label string) tea.Cmd {
	if m.externalBusy {
		return nil
	}
	m.externalBusy = true
	return m.services.external(cmd, func(err error) tea.Msg { return actionMsg{label: label, err: err} })
}

func (m *model) editPath(path, label string) tea.Cmd {
	cmd, err := editorCommand(m.ctx, path)
	if err != nil {
		m.feedback("", err)
		return m.reload(false)
	}
	return m.external(cmd, label)
}

func (m *model) editCurrent() tea.Cmd {
	var path string
	switch m.section {
	case drafts:
		if m.selected[drafts] < len(m.data.drafts) {
			path = m.data.drafts[m.selected[drafts]].path
		}
	case models:
		path = filepath.Join(config.HomeDir(), []string{"models.yaml", "model-presets.yaml", "providers.yaml"}[m.pane])
	case templates:
		path = filepath.Join(config.HomeDir(), "templates.yaml")
	default:
		return nil
	}
	if path == "" {
		m.feedback("", fmt.Errorf("no draft selected"))
		return nil
	}
	return m.editPath(path, "edited")
}

func (m *model) createDraft() tea.Cmd {
	if m.externalBusy {
		return nil
	}
	m.externalBusy = true
	template := at(config.SortedKeys(m.data.templates), 0)
	if template == "" {
		template = "empty"
	}
	create := m.services.createDraft
	return func() tea.Msg {
		path, err := create(template)
		return actionMsg{label: "created draft", createdPath: path, err: err}
	}
}

func (m *model) copyReopen() tea.Cmd {
	row, err := m.selectedRun(true)
	if err == nil && (strings.TrimSpace(row.state.NativeReopen) == "" || strings.Contains(row.state.NativeReopen, "<session-id>")) {
		err = fmt.Errorf("native session id not captured yet for %s", row.state.Model)
	}
	if err != nil {
		m.feedback("", err)
		return nil
	}
	copy, text, ctx := m.services.copy, row.state.NativeReopen, m.ctx
	return func() tea.Msg { return copiedMsg{err: copy(ctx, text)} }
}
