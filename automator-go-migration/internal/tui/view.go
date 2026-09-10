package tui

import (
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"automator/internal/config"
	"automator/internal/util"
	"automator/internal/worker"

	"github.com/charmbracelet/lipgloss"
)

var (
	background    = lipgloss.Color("#141929")
	foreground    = lipgloss.Color("#E0E4EC")
	muted         = lipgloss.Color("#C8CCD4")
	red           = lipgloss.Color("#FF4D63")
	orange        = lipgloss.Color("#FFAA44")
	yellow        = lipgloss.Color("#F9C846")
	cyan          = lipgloss.Color("#7ED4E0")
	magenta       = lipgloss.Color("#C43878")
	selectedStyle = lipgloss.NewStyle().Foreground(foreground).Background(lipgloss.Color("#3A2438")).Bold(true)
)

const runKeys = "Enter attach/resume   s start   k/Ctrl+C stop   u continue   R retry   c copy reopen   t Herdr   o report   d delete model   D delete run"
const helpKeys = "? all keys  Left/Right sections  Up/Down select  Tab pane  n new  x run  e edit  r refresh  q quit"

const dashboardHelp = "Left/Right, h/l   Switch Drafts / Runs / Stats / Models / Templates\nUp/Down, j       Select an entry\nTab/Shift+Tab    Switch Models / Presets / Providers pane\nPgUp/PgDn        Page list; Home/End go to first/last\nCtrl+U/Ctrl+D    Scroll details; Shift+Up/Down scroll one line\n\nn new draft   e/Enter edit YAML   x choose models/presets\nRun picker: type filter, Space toggle, Tab launch mode, Enter run\nEsc clears the filter first, then closes the picker\nSequential: FIFO, waits for queued/running models and launchers\n\n" + runKeys + "\n\nr refresh   q/Esc quit dashboard   ? this help\nActive runs survive quit. Waiting queue entries do not."

// User-controlled YAML, errors and logs must not inject terminal controls.
func safeText(text string) string {
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, util.RedactSecrets(text))
}

func painted(text string, color lipgloss.Color) string {
	return lipgloss.NewStyle().Foreground(color).Render(safeText(text))
}

func fit(text string, width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	return lipgloss.NewStyle().Width(width).Height(height).MaxWidth(width).MaxHeight(height).Render(text)
}

func panel(title, content string, width, height int, color lipgloss.Color) string {
	if width < 3 || height < 3 {
		return fit(content, width, height)
	}
	content = fit(painted(title, color), width-2, 1) + "\n" + content
	return lipgloss.NewStyle().Border(lipgloss.NormalBorder()).BorderForeground(color).
		Foreground(foreground).Background(background).
		Width(width - 2).Height(height - 2).MaxWidth(width).MaxHeight(height).Render(content)
}

type geometry struct{ body, listW, listH, detailW, detailH, actionH int }

func (m *model) geometry() geometry {
	g := geometry{body: max(1, m.height-9)}
	if m.section == models {
		g.listH = max(3, g.body*58/100)
		g.detailW, g.detailH = m.width, max(1, g.body-g.listH)
		return g
	}
	if m.width >= 72 {
		g.listW, g.listH = m.width/3, g.body
		g.detailW, g.detailH = m.width-g.listW, g.body
	} else {
		g.listW, g.listH = m.width, max(3, g.body/3)
		g.detailW, g.detailH = m.width, max(1, g.body-g.listH)
	}
	if m.section == runs && g.detailH >= 12 {
		g.actionH = min(7, g.detailH/3)
		g.detailH -= g.actionH
	}
	return g
}

func (m *model) syncDetail(reset bool) {
	g := m.geometry()
	m.detail.Width, m.detail.Height = max(1, g.detailW-2), max(1, g.detailH-3)
	m.detail.SetContent(lipgloss.NewStyle().Width(m.detail.Width).Render(safeText(m.detailText())))
	m.help.Width, m.help.Height = max(1, m.width-2), max(1, g.body-3)
	help := dashboardHelp
	if m.status != "" {
		help = "Status: " + safeText(m.status) + "\n\n" + help
	}
	m.help.SetContent(lipgloss.NewStyle().Width(m.help.Width).Render(help))
	if reset {
		m.detail.GotoTop()
	}
	if m.selection != nil {
		m.selection.filter.Width = max(1, min(m.width-16, 70))
	}
}

func (m *model) View() string {
	if m.width < 12 || m.height < 5 {
		return fit("Automator\nResize terminal\nq quit", m.width, m.height)
	}
	var tabs []string
	for i, name := range sectionNames {
		if section(i) == m.section {
			tabs = append(tabs, selectedStyle.Render(" "+name+" "))
		} else {
			tabs = append(tabs, painted(" "+name+" ", muted))
		}
	}
	tabLine := strings.Join(tabs, " ")
	if m.width < 58 {
		tabLine = painted(fmt.Sprintf("< %s >  %d/5", sectionNames[m.section], m.section+1), cyan)
	}
	header := panel("Automator", tabLine, m.width, 4, orange)
	body := m.bodyView()
	if m.selection != nil {
		body = m.selectionView()
	}
	if m.deletion != nil {
		body = m.deleteView()
	}
	if m.confirmQuit {
		body = panel("Quit dashboard?", fmt.Sprintf("Discard %d waiting sequential run(s)?\nAlready launched runs continue in the background.\n\ny quit and discard queue   n/Esc stay", len(m.queue)), m.width, m.geometry().body, red)
	}
	if m.showHelp {
		body = panel("Dashboard Help / Up/Down scroll / Esc closes", m.help.View(), m.width, m.geometry().body, cyan)
	}
	status := m.status
	if status == "" {
		status = m.idleStatus()
	}
	help := helpKeys
	if m.section == runs {
		help = "? all keys  " + runKeys
	}
	if m.section == models {
		help = "Tab/Shift+Tab pane  e/Enter edit YAML  " + helpKeys
	}
	if m.selection != nil {
		help = "Space toggle  Tab mode  Enter run  Esc clear/cancel"
	}
	if m.deletion != nil {
		help = "y delete  n/Esc cancel"
		if m.deletion.busy {
			help = "Deleting; checking locks and current state..."
		}
	}
	if m.confirmQuit {
		help = "y discard queue and quit  n/Esc stay"
	}
	footer := panel("Keys", fit(painted(status, yellow), max(1, m.width-2), 1)+"\n"+painted(help, muted), m.width, 5, yellow)
	if m.height < 12 {
		return fit(painted("Automator / "+sectionNames[m.section], orange)+"\n"+body+"\n"+painted(status, yellow), m.width, m.height)
	}
	return fit(lipgloss.JoinVertical(lipgloss.Left, header, body, footer), m.width, m.height)
}

func (m *model) idleStatus() string {
	var sequential, active int
	for _, process := range m.processes {
		active++
		if process.kind == sequentialProcess {
			sequential++
		}
	}
	if m.sequential || sequential > 0 || len(m.queue) > 0 {
		return fmt.Sprintf("Sequential: %d running, %d queued | %d launcher/action process(es)", sequential, len(m.queue), active)
	}
	return "Ready | " + fmt.Sprint(active) + " launcher/action process(es) | Ctrl+U/D scroll details"
}

func (m *model) bodyView() string {
	g := m.geometry()
	if m.section == stats {
		if m.width >= 72 {
			return lipgloss.JoinHorizontal(lipgloss.Top, m.statsView(false, m.width/2, g.body), m.statsView(true, m.width-m.width/2, g.body))
		}
		return lipgloss.JoinVertical(lipgloss.Left, m.statsView(false, m.width, g.body/2), m.statsView(true, m.width, g.body-g.body/2))
	}
	detailTitle := "Details"
	if m.detail.TotalLineCount() > m.detail.Height {
		detailTitle += fmt.Sprintf("  %.0f%%  Ctrl+U/D scroll", m.detail.ScrollPercent()*100)
	}
	detail := panel(detailTitle, m.detail.View(), g.detailW, g.detailH, magenta)
	if m.section == models {
		var registry string
		if m.width >= 90 {
			widths := [3]int{m.width * 42 / 100, m.width * 33 / 100, 0}
			widths[2] = m.width - widths[0] - widths[1]
			var panes []string
			for p, w := range widths {
				panes = append(panes, m.registryView(p, w, g.listH))
			}
			registry = lipgloss.JoinHorizontal(lipgloss.Top, panes...)
		} else {
			registry = m.registryView(m.pane, m.width, g.listH)
		}
		return lipgloss.JoinVertical(lipgloss.Left, registry, detail)
	}
	if g.actionH > 0 {
		detail = lipgloss.JoinVertical(lipgloss.Left, detail, panel("Actions", painted(runKeys, muted), g.detailW, g.actionH, red))
	}
	list := m.listView(g.listW, g.listH)
	if m.width >= 72 {
		return lipgloss.JoinHorizontal(lipgloss.Top, list, detail)
	}
	return lipgloss.JoinVertical(lipgloss.Left, list, detail)
}

func listLines(labels []string, selected, width, height int, colors []lipgloss.Color) string {
	if len(labels) == 0 {
		return painted("No entries.", muted)
	}
	visible := max(1, height-3)
	start := listWindowStart(selected, len(labels), visible)
	var lines []string
	for i := start; i < min(len(labels), start+visible); i++ {
		prefix, color := "  ", cyan
		if len(colors) > i {
			color = colors[i]
		}
		if i == selected {
			prefix = "> "
		} else if i == start && start > 0 {
			prefix = "^ "
		} else if i == start+visible-1 && i < len(labels)-1 {
			prefix = "v "
		}
		line := fit(prefix+safeText(strings.ReplaceAll(labels[i], "\n", " ")), max(1, width-2), 1)
		if i == selected {
			line = selectedStyle.Render(line)
		} else {
			line = painted(line, color)
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func (m *model) listView(width, height int) string {
	var labels []string
	var colors []lipgloss.Color
	switch m.section {
	case drafts:
		for _, draft := range m.data.drafts {
			labels = append(labels, draft.name+" ("+draft.version+")")
		}
	case runs:
		for _, row := range m.data.runRows() {
			if row.state == nil {
				labels = append(labels, row.run.name+" (no states)")
				colors = append(colors, yellow)
				continue
			}
			labels = append(labels, fmt.Sprintf("%s / %s (%s)", row.run.name, row.state.Model, row.state.Status))
			colors = append(colors, statusColor(row.state.Status))
		}
	case templates:
		for _, key := range config.SortedKeys(m.data.templates) {
			labels = append(labels, key+": "+m.data.templates[key].DisplayName)
		}
	}
	title := fmt.Sprintf("%s %d/%d", sectionNames[m.section], min(len(labels), m.currentSelection()+1), len(labels))
	return panel(title, listLines(labels, m.currentSelection(), width, height, colors), width, height, cyan)
}

func (m *model) registryView(pane, width, height int) string {
	var labels []string
	for _, key := range m.ids(models, pane) {
		name := ""
		switch pane {
		case 0:
			name = m.data.models[key].DisplayName
		case 1:
			name = m.data.presets[key].DisplayName
		case 2:
			name = m.data.providers[key].DisplayName
		}
		labels = append(labels, key+": "+name)
	}
	color, title := orange, paneNames[pane]
	if pane == m.pane {
		color, title = cyan, title+" / active"
	}
	title += fmt.Sprintf(" %d/%d", min(len(labels), m.registrySelected[pane]+1), len(labels))
	if m.width < 90 {
		title += " (Tab: Models/Presets/Providers)"
	}
	return panel(title, listLines(labels, m.registrySelected[pane], width, height, nil), width, height, color)
}

func (m *model) detailText() string {
	var out strings.Builder
	if m.section == drafts || m.section == runs {
		out.WriteString(m.queueText())
	}
	switch m.section {
	case drafts:
		if m.selected[drafts] >= len(m.data.drafts) {
			return out.String() + "No drafts. Press n to create one."
		}
		entry := m.data.drafts[m.selected[drafts]]
		fmt.Fprintf(&out, "path: %s\nversion: %s\n", entry.path, entry.version)
		if draft := entry.draft; draft != nil {
			fmt.Fprintf(&out, "name: %s\nroot: %s\nmode: %s\nconcurrency: %d\nheavy: %t\ntemplate: %s\n\nprompt:\n%s\n", draft.Name, draft.Root, draft.Mode, draft.Concurrency, draft.Heavy, draft.Template, draft.Prompt)
			for _, group := range []struct {
				name  string
				steps []config.ShellStep
			}{{"pre", draft.Pre}, {"post_each", draft.PostEach}, {"post_all", draft.PostAll}} {
				if len(group.steps) > 0 {
					fmt.Fprintf(&out, "\n%s:\n", group.name)
					for _, step := range group.steps {
						fmt.Fprintf(&out, "  - %s\n", step.Shell)
					}
				}
			}
		} else {
			fmt.Fprintf(&out, "warning: could not parse draft YAML: %v\n", entry.err)
		}
		out.WriteString("\nPress x to choose presets/models and run. Enter/e edits YAML.")
	case runs:
		row, err := m.selectedRun(false)
		if err != nil {
			return out.String() + "No model runs found."
		}
		fmt.Fprintf(&out, "run: %s\npath: %s\nmode: %s\nstarted: %s\n", row.run.name, row.run.path, row.run.mode, row.run.started)
		if row.run.err != nil {
			fmt.Fprintf(&out, "warning: %v\n", row.run.err)
		}
		state := row.state
		if state == nil {
			return out.String() + "No model states available. D deletes the indexed run; o opens report."
		}
		fmt.Fprintf(&out, "model: %s\nstatus: %s\nprovider: %s\ntool: %s\nproject: %s\n", state.Model, state.Status, state.Provider, state.Tool, state.ProjectPath)
		if state.NativeSessionID != nil {
			fmt.Fprintf(&out, "session: %s\n", *state.NativeSessionID)
		}
		if state.DurationSeconds != nil {
			fmt.Fprintf(&out, "duration: %s\n", formatTime(*state.DurationSeconds))
		}
		if state.Cost != nil {
			fmt.Fprintf(&out, "cost: $%.4f\n", *state.Cost)
		}
		inputLabel := "input_miss"
		if state.CacheReadTokens == nil && state.ReasoningTokens == nil {
			inputLabel = "legacy_input"
		}
		for _, token := range []struct {
			name  string
			value *uint64
		}{{inputLabel, state.InputTokens}, {"cache_hit", state.CacheReadTokens}, {"cache_write", state.CacheWriteTokens}, {"output", state.OutputTokens}, {"reasoning", state.ReasoningTokens}, {"total", state.TotalTokens}} {
			if token.value != nil {
				fmt.Fprintf(&out, "%s tokens: %d\n", token.name, *token.value)
			}
		}
		if state.Error != nil {
			fmt.Fprintf(&out, "error: %s\n", *state.Error)
		}
		fmt.Fprintf(&out, "\nnative reopen:\n%s\n\n%s", state.NativeReopen, runKeys)
	case models:
		key := at(m.ids(models, m.pane), m.registrySelected[m.pane])
		file := []string{"models.yaml", "model-presets.yaml", "providers.yaml"}[m.pane]
		if key == "" {
			fmt.Fprintf(&out, "No %s configured. Press e to edit %s.", strings.ToLower(paneNames[m.pane]), file)
			break
		}
		fmt.Fprintf(&out, "key: %s\n", key)
		switch m.pane {
		case 0:
			model := m.data.models[key]
			fmt.Fprintf(&out, "display_name: %s\ntool: %s\nprovider: %s\nmodel: %s\nargs:\n", model.DisplayName, model.Tool, model.Provider, model.Model)
			for _, key := range config.SortedKeys(model.Args) {
				fmt.Fprintf(&out, "  %s: %v\n", key, model.Args[key])
			}
			if model.Pricing != nil {
				fmt.Fprintf(&out, "pricing: %+v\n", *model.Pricing)
			}
		case 1:
			preset := m.data.presets[key]
			fmt.Fprintf(&out, "display_name: %s\nmodels:\n  - %s\n", preset.DisplayName, strings.Join(preset.Models, "\n  - "))
		case 2:
			provider := m.data.providers[key]
			fmt.Fprintf(&out, "display_name: %s\nauth: %s\n", provider.DisplayName, provider.Auth)
		}
		fmt.Fprintf(&out, "\nEdit: %s\nTab switches Models / Presets / Providers", filepath.Join(config.HomeDir(), file))
	case templates:
		key := at(m.ids(templates, 0), m.selected[templates])
		if key == "" {
			return "No templates configured. Press e to edit templates.yaml."
		}
		template := m.data.templates[key]
		fmt.Fprintf(&out, "key: %s\ndisplay_name: %s\nsteps:\n", key, template.DisplayName)
		for _, step := range template.Steps {
			fmt.Fprintf(&out, "  - %s\n", step.Shell)
		}
		fmt.Fprintf(&out, "\nEdit: %s", filepath.Join(config.HomeDir(), "templates.yaml"))
	case stats:
		return "Cumulative cost and elapsed time across runs-index.yaml. Up/Down scroll statistics."
	}
	return out.String()
}

func (m *model) queueText() string {
	if !m.sequential && len(m.queue) == 0 {
		active := false
		for _, process := range m.processes {
			active = active || process.kind == sequentialProcess
		}
		if !active {
			return ""
		}
	}
	var out strings.Builder
	fmt.Fprintf(&out, "Sequential queue / %d waiting\n", len(m.queue))
	active := false
	for _, id := range sortedProcessIDs(m.processes) {
		process := m.processes[id]
		if process.kind == sequentialProcess {
			fmt.Fprintf(&out, "running: %s\n", process.label)
			active = true
		}
	}
	if !active && len(m.queue) > 0 {
		out.WriteString("waiting for active runs to finish / fresh state\n")
		for _, run := range m.data.runs {
			if run.err != nil {
				fmt.Fprintf(&out, "blocked: cannot read states for %s: %v\n", run.name, run.err)
			}
		}
	}
	if !active && len(m.queue) == 0 {
		out.WriteString("queue empty\n")
	}
	for i, run := range m.queue {
		fmt.Fprintf(&out, "%d waiting: %s\n", i+1, run.label)
	}
	return out.String() + "\n"
}

func sortedProcessIDs(processes map[int]request) []int {
	ids := make([]int, 0, len(processes))
	for id := range processes {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

func (m *model) selectionIntro() string {
	modal := m.selection
	intro := modal.filter.View() + "\n" + painted(fmt.Sprintf("%d models + %d presets selected", len(modal.models), len(modal.presets)), orange) + "\n" +
		painted("Type filter | Space toggle | Tab mode | Enter launch | Esc clear/cancel", muted)
	return fit(intro, max(1, m.width-2), max(0, m.geometry().body-4))
}

func (m *model) selectionPageSize() int {
	intro := m.selectionIntro()
	height := 0
	if intro != "" {
		height = lipgloss.Height(intro)
	}
	return max(1, m.geometry().body-3-height)
}

func (m *model) selectionView() string {
	modal := m.selection
	mode := "IMMEDIATE"
	if m.sequential {
		mode = "SEQUENTIAL"
	}
	title := mode + " / Run " + modal.draftName
	intro := m.selectionIntro()
	var labels []string
	for _, row := range m.selectionRows() {
		checked := modal.models[row.key]
		if row.preset {
			checked = modal.presets[row.key]
		}
		mark := "[ ] "
		if checked {
			mark = "[x] "
		}
		labels = append(labels, mark+row.label)
	}
	list := listLines(labels, modal.cursor, m.width, m.selectionPageSize()+3, nil)
	if len(labels) == 0 {
		list = "No matching models or presets. Esc clears the filter."
	}
	if intro != "" {
		list = intro + "\n" + list
	}
	return panel(title, list, m.width, m.geometry().body, orange)
}

func (m *model) deleteView() string {
	target := m.deletion
	subject, title := "run '"+target.name+"'", "Delete entire run?"
	if target.model != "" {
		subject, title = "model '"+target.model+"' from "+subject, "Delete model run?"
	}
	text := fmt.Sprintf("Permanently delete %s and its files under:\n\n%s\n\ny delete   n/Esc cancel", subject, target.path)
	if target.busy {
		text += "\n\nDeleting; checking locks and current state..."
	}
	return panel(title, safeText(text), m.width, m.geometry().body, red)
}

func (m *model) statsView(elapsed bool, width, height int) string {
	rows := m.data.stats()
	title, color := "Cost stats", orange
	value := func(row statsRow) float64 { return row.cost }
	if elapsed {
		title, color = "Time stats", cyan
		value = func(row statsRow) float64 { return float64(row.seconds) }
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if value(rows[i]) == value(rows[j]) {
			return rows[i].model < rows[j].model
		}
		return value(rows[i]) > value(rows[j])
	})
	if len(rows) == 0 {
		return panel(title, "No completed model stats yet.", width, height, color)
	}
	maxValue := value(rows[0])
	barWidth := max(0, min(48, width-33))
	start := listWindowStart(m.selected[stats], len(rows), max(1, height-3))
	var lines []string
	for _, row := range rows[start:min(len(rows), start+max(1, height-3))] {
		label := formatCost(row.cost)
		if elapsed {
			label = formatTime(row.seconds)
		}
		filled := 0
		if maxValue > 0 && barWidth > 0 {
			filled = min(barWidth, int(math.Round(value(row)/maxValue*float64(barWidth))))
			if value(row) > 0 {
				filled = max(1, filled)
			}
		}
		bar := painted(strings.Repeat("#", filled), color) + painted(strings.Repeat(".", barWidth-filled), muted)
		name := fit(safeText(row.model), min(18, max(1, width-15)), 1)
		lines = append(lines, name+" "+bar+" "+painted(label, yellow))
	}
	return panel(title+fmt.Sprintf(" %d-%d/%d", start+1, start+len(lines), len(rows)), strings.Join(lines, "\n"), width, height, color)
}

func formatCost(cost float64) string {
	if cost >= 100 {
		return fmt.Sprintf("$%.0f", cost)
	}
	if cost >= 10 {
		return fmt.Sprintf("$%.2f", cost)
	}
	return fmt.Sprintf("$%.4f", cost)
}

func formatTime(seconds uint64) string {
	if seconds >= 3600 {
		return fmt.Sprintf("%dh %02dm", seconds/3600, seconds%3600/60)
	}
	return fmt.Sprintf("%dm %02ds", seconds/60, seconds%60)
}

func statusColor(status worker.Status) lipgloss.Color {
	switch status {
	case worker.Running:
		return orange
	case worker.Done:
		return cyan
	case worker.Failed:
		return red
	case worker.Paused, worker.Cancelled:
		return yellow
	default:
		return muted
	}
}
