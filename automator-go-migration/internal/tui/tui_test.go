package tui

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
	"automator/internal/worker"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

func fixtureData() dashboardData {
	return dashboardData{
		drafts: []draftEntry{
			{name: "alpha", version: "v2", path: "/fixture/drafts/alpha/v2.yaml", draft: &config.DraftRun{Name: "alpha", Mode: config.Headless, SchemaVersion: 1, Prompt: "test prompt"}},
			{name: "beta", version: "v1", path: "/fixture/drafts/beta/v1.yaml", draft: &config.DraftRun{Name: "beta", Mode: config.Headless, SchemaVersion: 1}},
		},
		models: map[string]config.Model{
			"opus": {DisplayName: "Claude Opus", Provider: "anthropic", Tool: config.Claude, Model: "claude-opus-5"},
			"qwen": {DisplayName: "Qwen Max", Provider: "ollama-cloud", Tool: config.Opencode, Model: "qwen3.7-max"},
		},
		presets:   map[string]config.ModelPreset{"all": {DisplayName: "Both models", Models: []string{"opus", "qwen"}}, "empty": {DisplayName: "Empty", Models: []string{}}},
		providers: map[string]config.Provider{"anthropic": {DisplayName: "Anthropic", Auth: "external"}, "ollama-cloud": {DisplayName: "Ollama", Auth: "external"}},
		templates: map[string]config.Template{"empty": {DisplayName: "Empty directory"}},
		runs: []runEntry{{name: "same-name", path: "/fixture/run-2026", mode: config.Headless, states: []worker.State{
			{Model: "opus", Status: worker.Paused, NativeReopen: "opencode --session known"},
			{Model: "qwen", Status: worker.Done},
		}}},
	}
}

func testModel(t *testing.T) *model {
	t.Helper()
	data := fixtureData()
	s := services{
		load:             func() (dashboardData, error) { return data, nil },
		lookup:           func(name string) (string, error) { return "/fake/" + name, nil },
		run:              func(context.Context, request) processResult { return processResult{} },
		delete:           func(context.Context, string, string) error { return nil },
		copy:             func(context.Context, string) error { return nil },
		createDraft:      func(string) (string, error) { return "/fixture/new-run/v1.yaml", nil },
		external:         func(*exec.Cmd, tea.ExecCallback) tea.Cmd { t.Fatal("unexpected external command"); return nil },
		prepareRunAttach: func(context.Context, runEntry) (*exec.Cmd, error) { return exec.Command("fake-herdr"), nil },
	}
	return newModel(context.Background(), data, s)
}

func press(m *model, value string) tea.Cmd {
	keys := map[string]tea.KeyType{"left": tea.KeyLeft, "right": tea.KeyRight, "up": tea.KeyUp, "down": tea.KeyDown,
		"tab": tea.KeyTab, "shift+tab": tea.KeyShiftTab, "esc": tea.KeyEsc, "enter": tea.KeyEnter,
		"pgup": tea.KeyPgUp, "pgdown": tea.KeyPgDown, "home": tea.KeyHome, "end": tea.KeyEnd,
		"backspace": tea.KeyBackspace, "delete": tea.KeyDelete, "ctrl+c": tea.KeyCtrlC, "ctrl+d": tea.KeyCtrlD, "ctrl+u": tea.KeyCtrlU}
	msg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(value)}
	if key, ok := keys[value]; ok {
		msg = tea.KeyMsg{Type: key}
	}
	_, cmd := m.Update(msg)
	return cmd
}

func consume(t *testing.T, m *model, cmd tea.Cmd) tea.Cmd {
	t.Helper()
	if cmd == nil {
		t.Fatal("expected command")
	}
	_, next := m.Update(cmd())
	return next
}

func TestNavigationAndSelectionIdentity(t *testing.T) {
	m := testModel(t)
	press(m, "left")
	if m.section != drafts {
		t.Fatal("left must clamp")
	}
	press(m, "down")
	press(m, "right")
	if m.section != runs || m.currentSelection() != 0 {
		t.Fatal("section selection leaked")
	}
	press(m, "left")
	if m.currentSelection() != 1 {
		t.Fatal("draft selection not retained")
	}
	m.section = models
	press(m, "down")
	press(m, "tab")
	if m.pane != 1 || m.currentSelection() != 0 {
		t.Fatal("registry pane selection leaked")
	}
	press(m, "shift+tab")
	if m.pane != 0 || m.currentSelection() != 1 {
		t.Fatal("registry selection not retained")
	}
	press(m, "shift+tab")
	if m.pane != 2 {
		t.Fatal("registry panes must wrap")
	}
	m.section = templates
	press(m, "right")
	if m.section != templates {
		t.Fatal("sections must clamp")
	}
	data := fixtureData()
	data.drafts = append([]draftEntry{{name: "aaa", path: "/new"}}, data.drafts...)
	m.replaceData(data)
	if m.selected[drafts] != 2 {
		t.Fatal("refresh moved selection to a different draft")
	}
	m.replaceData(dashboardData{})
	for _, index := range m.selected {
		if index != 0 {
			t.Fatal("empty section selection not clamped")
		}
	}
	for _, index := range m.registrySelected {
		if index != 0 {
			t.Fatal("empty registry selection not clamped")
		}
	}
	press(m, "down")
	press(m, "end")
}

func TestRunRefreshRetainsPathAndModelNotName(t *testing.T) {
	m := testModel(t)
	m.section, m.selected[runs] = runs, 1
	data := fixtureData()
	data.runs = append([]runEntry{{name: "same-name", path: "/another", states: []worker.State{{Model: "qwen"}}}}, data.runs...)
	m.replaceData(data)
	row, _ := m.selectedRun(true)
	if row.run.path != "/fixture/run-2026" || row.state.Model != "qwen" {
		t.Fatal("run identity changed on refresh")
	}
}

func TestListWindowAndPageNavigation(t *testing.T) {
	for _, tc := range []struct{ selected, length, visible, want int }{{0, 50, 10, 0}, {25, 50, 10, 20}, {49, 50, 10, 40}, {2, 3, 10, 0}, {0, 0, 0, 0}} {
		if got := listWindowStart(tc.selected, tc.length, tc.visible); got != tc.want {
			t.Fatalf("%+v: %d", tc, got)
		}
	}
	m := testModel(t)
	m.data.drafts = nil
	for i := 0; i < 100; i++ {
		m.data.drafts = append(m.data.drafts, draftEntry{name: fmt.Sprintf("draft-%03d", i), path: fmt.Sprint(i)})
	}
	press(m, "pgdown")
	if m.currentSelection() <= 1 {
		t.Fatal("page down did not page")
	}
	press(m, "end")
	if m.currentSelection() != 99 || !strings.Contains(m.View(), "draft-099") {
		t.Fatal("last item not visible")
	}
	press(m, "home")
	if m.currentSelection() != 0 {
		t.Fatal("home failed")
	}
}

func TestModalFilteringSelectionAndEscape(t *testing.T) {
	m := testModel(t)
	press(m, "x")
	for _, filter := range []string{"OPUS", "Claude", "ANTHROPIC", "claude-opus-5"} {
		m.selection.filter.SetValue(filter)
		rows := m.selectionRows()
		found := false
		for _, row := range rows {
			if !row.preset && row.key == "opus" {
				found = true
			}
		}
		if !found {
			t.Fatalf("filter %s missed model", filter)
		}
	}
	m.selection.filter.SetValue("Both")
	press(m, " ")
	if !m.selection.presets["all"] {
		t.Fatal("preset not selected")
	}
	press(m, "esc")
	if m.selection == nil || m.selection.filter.Value() != "" {
		t.Fatal("first Escape should clear filter")
	}
	press(m, "qwen3.7")
	press(m, " ")
	if !m.selection.models["qwen"] || !m.selection.presets["all"] {
		t.Fatal("selection lost across filter")
	}
	press(m, "delete")
	press(m, "tab")
	if !m.sequential {
		t.Fatal("Tab did not change launch mode")
	}
	press(m, "esc")
	if m.selection != nil {
		t.Fatal("Escape did not close modal")
	}
	press(m, "x")
	if !m.sequential {
		t.Fatal("launch mode should persist between drafts")
	}
	press(m, "q")
	if m.selection == nil || m.selection.filter.Value() != "q" {
		t.Fatal("modal q should filter, not quit")
	}
}

func TestModalDispatchArgumentsAndValidation(t *testing.T) {
	for _, sequential := range []bool{false, true} {
		t.Run(fmt.Sprint(sequential), func(t *testing.T) {
			m := testModel(t)
			press(m, "x")
			if cmd := press(m, "enter"); cmd != nil || m.selection == nil {
				t.Fatal("empty selection launched")
			}
			m.selection.presets["empty"] = true
			if cmd := press(m, "enter"); cmd != nil {
				t.Fatal("empty preset launched")
			}
			delete(m.selection.presets, "empty")
			m.selection.presets["all"], m.selection.models["qwen"], m.selection.models["opus"] = true, true, true
			m.sequential = sequential
			var got request
			m.services.run = func(_ context.Context, r request) processResult { got = r; return processResult{} }
			cmd := press(m, "enter")
			if sequential {
				if len(m.queue) != 1 || len(m.processes) != 0 {
					t.Fatal("queue bypassed fresh load")
				}
				cmd = consume(t, m, cmd)
			}
			if m.selection != nil || len(m.processes) != 1 {
				t.Fatal("launch did not close modal/register process")
			}
			cmd()
			want := []string{"run", "alpha"}
			if sequential {
				want = append(want, "--run-heavy")
			}
			want = append(want, "--preset", "all", "--model", "opus", "--model", "qwen")
			if !reflect.DeepEqual(got.args, want) {
				t.Fatalf("args %v want %v", got.args, want)
			}
		})
	}
	m := testModel(t)
	press(m, "x")
	m.selection.models["opus"] = true
	m.data.drafts[0].draft.Mode = config.Headful
	m.services.lookup = func(string) (string, error) { return "", errors.New("missing") }
	if press(m, "enter") != nil || !strings.Contains(m.status, "herdr not found") {
		t.Fatal("missing herdr not rejected")
	}
	m.data.drafts = nil
	if press(m, "enter") != nil || !strings.Contains(m.status, "no longer exists") {
		t.Fatal("removed draft not rejected")
	}
}

func TestSequentialFIFOAfterSuccessAndFailure(t *testing.T) {
	m := testModel(t)
	m.data.runs = nil
	m.services.load = func() (dashboardData, error) { return m.data, nil }
	var order []string
	m.services.run = func(_ context.Context, r request) processResult {
		order = append(order, r.label)
		if r.label == "first" {
			return processResult{err: errors.New("deliberate failure"), logPath: "/fake/first.log"}
		}
		return processResult{}
	}
	for _, label := range []string{"first", "second", "third"} {
		m.queue = append(m.queue, request{kind: sequentialProcess, label: label})
	}
	cmd := m.startNextQueued()
	for i := 0; i < 3; i++ {
		if len(m.processes) != 1 || m.startNextQueued() != nil {
			t.Fatal("overlapping sequential dispatch")
		}
		cmd = consume(t, m, cmd)
		if len(m.processes) != 0 {
			t.Fatal("process not reaped")
		}
		if i == 0 && !strings.Contains(m.status, "/fake/first.log") {
			t.Fatal("failure log not shown")
		}
		cmd = consume(t, m, cmd)
		if i == 0 && !strings.Contains(m.status, "/fake/first.log") {
			t.Fatal("starting next queued run hid prior failure")
		}
	}
	if cmd != nil || len(m.queue) != 0 || !reflect.DeepEqual(order, []string{"first", "second", "third"}) {
		t.Fatalf("FIFO did not drain: %v", order)
	}
}

func TestQueueBlocksDiscoveredWorkAndParallelLaunchers(t *testing.T) {
	for _, status := range []worker.Status{worker.Queued, worker.Running, worker.Paused, worker.Done, worker.Failed, worker.Cancelled} {
		m := testModel(t)
		m.data.runs[0].states[0].Status = status
		m.queue = []request{{kind: sequentialProcess}}
		cmd := m.startNextQueued()
		if (cmd == nil) != blocksQueue(status) {
			t.Fatalf("status %s: wrong blocking", status)
		}
	}
	m := testModel(t)
	m.queue = []request{{kind: sequentialProcess}}
	m.processes[42] = request{kind: parallelProcess}
	if m.startNextQueued() != nil {
		t.Fatal("parallel launcher did not block queue")
	}
	delete(m.processes, 42)
	m.data.runs[0].err = errors.New("cannot read state")
	if m.startNextQueued() != nil {
		t.Fatal("unreadable states did not block queue")
	}
}

func TestStaleRefreshCannotReleaseQueue(t *testing.T) {
	m := testModel(t)
	m.queue = []request{{kind: sequentialProcess, label: "waiting"}}
	load := m.reload(false)
	m.epoch++
	cmd := consume(t, m, load)
	if len(m.processes) != 0 || cmd == nil {
		t.Fatal("stale refresh dispatched queue or failed to retry")
	}
	m.services.load = func() (dashboardData, error) { return dashboardData{}, errors.New("offline") }
	m.loading = false
	consume(t, m, m.reload(false))
	if len(m.queue) != 1 || len(m.processes) != 0 {
		t.Fatal("failed refresh released queue")
	}
}

func TestEnqueueInvalidatesRefreshAlreadyInFlight(t *testing.T) {
	m := testModel(t)
	load := m.reload(false)
	press(m, "x")
	m.selection.models["opus"] = true
	m.sequential = true
	press(m, "enter")
	next := consume(t, m, load)
	if len(m.processes) != 0 || next == nil {
		t.Fatal("queue dispatched from a read started before enqueue")
	}
}

func TestModelActionsUsePathsAndStopGuard(t *testing.T) {
	for _, tc := range []struct{ key, action string }{{"s", "start"}, {"k", "stop"}, {"ctrl+c", "stop"}, {"u", "continue"}, {"R", "retry"}} {
		t.Run(tc.key, func(t *testing.T) {
			m := testModel(t)
			m.section = runs
			m.data.runs[0].states[0].Status = worker.Running
			var args []string
			m.services.run = func(_ context.Context, r request) processResult { args = r.args; return processResult{} }
			cmd := press(m, tc.key)
			if cmd == nil {
				t.Fatal("no action command")
			}
			cmd()
			want := []string{tc.action, "/fixture/run-2026", "opus"}
			if !reflect.DeepEqual(args, want) {
				t.Fatalf("got %v want %v", args, want)
			}
		})
	}
	m := testModel(t)
	m.section = runs
	if press(m, "ctrl+c") != nil || !strings.Contains(m.status, "not running") {
		t.Fatal("Ctrl+C must guard stop, not quit")
	}
	m.section = drafts
	if press(m, "s") != nil {
		t.Fatal("start outside Runs")
	}
}

func TestDeletionConfirmationGuardsAndFailure(t *testing.T) {
	m := testModel(t)
	m.section = runs
	m.data.runs[0].states[0].Status = worker.Running
	press(m, "d")
	if m.deletion != nil {
		t.Fatal("running model deletion allowed")
	}
	m.selected[runs] = 1
	press(m, "D")
	if m.deletion != nil {
		t.Fatal("run with running sibling deletion allowed")
	}
	press(m, "d")
	if m.deletion == nil || m.deletion.model != "qwen" {
		t.Fatal("finished sibling deletion disallowed")
	}
	press(m, "n")
	if m.deletion != nil {
		t.Fatal("cancel did not close confirmation")
	}
	press(m, "d")
	calls := 0
	m.services.delete = func(_ context.Context, path, key string) error {
		calls++
		if path != "/fixture/run-2026" || key != "qwen" {
			t.Fatal("deletion target changed")
		}
		return errors.New("model became running")
	}
	press(m, "enter")
	if calls != 0 {
		t.Fatal("Enter must not confirm deletion")
	}
	cmd := press(m, "y")
	if !m.deletion.busy || calls != 0 {
		t.Fatal("side effect ran inside reducer")
	}
	if press(m, "y") != nil {
		t.Fatal("duplicate deletion allowed")
	}
	consume(t, m, cmd)
	if calls != 1 || m.deletion == nil || m.deletion.busy || !strings.Contains(m.status, "became running") {
		t.Fatal("deletion failure not recoverable")
	}
	m.services.delete = func(context.Context, string, string) error { return nil }
	consume(t, m, press(m, "y"))
	if m.deletion != nil {
		t.Fatal("successful deletion did not close modal")
	}
}

func TestQuitQueueConfirmationAndStatusExpiry(t *testing.T) {
	m := testModel(t)
	m.queue = []request{{kind: sequentialProcess}}
	if press(m, "q") != nil || !m.confirmQuit {
		t.Fatal("queued work discarded silently")
	}
	if m.startNextQueued() != nil {
		t.Fatal("queue dispatched while confirming its disposal")
	}
	press(m, "n")
	if m.confirmQuit {
		t.Fatal("quit not cancelled")
	}
	press(m, "q")
	cmd := press(m, "y")
	if _, ok := cmd().(tea.QuitMsg); !ok {
		t.Fatal("quit confirmation did not quit")
	}
	m.feedback("temporary", nil)
	m.Update(tickMsg(time.Now().Add(time.Minute)))
	if m.status != "" || !strings.Contains(m.idleStatus(), "queued") {
		t.Fatal("status did not expire to queue feedback")
	}
}

func TestViewsResponsiveAndDetailsScroll(t *testing.T) {
	m := testModel(t)
	m.data.drafts[0].draft.Prompt = strings.Repeat("A long prompt with wide text for wrapping and scrolling.\n", 40)
	for _, size := range [][2]int{{160, 50}, {100, 30}, {72, 24}, {40, 24}, {20, 12}, {8, 3}, {1, 1}} {
		for s := section(0); s < sectionCount; s++ {
			m.section = s
			m.Update(tea.WindowSizeMsg{Width: size[0], Height: size[1]})
			view := m.View()
			if lipgloss.Width(view) > size[0] || lipgloss.Height(view) > size[1] {
				t.Fatalf("section %s size %v rendered %dx%d", sectionNames[s], size, lipgloss.Width(view), lipgloss.Height(view))
			}
		}
	}
	m.section = drafts
	m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
	press(m, "ctrl+d")
	if m.detail.YOffset == 0 {
		t.Fatal("detail did not scroll")
	}
	press(m, "down")
	if m.detail.YOffset != 0 {
		t.Fatal("new selection should reset detail scroll")
	}
	press(m, "x")
	if !strings.Contains(m.View(), "IMMEDIATE") {
		t.Fatal("launch mode not shown")
	}
}

func TestHelpModalScrollsWithoutDispatchingActions(t *testing.T) {
	m := testModel(t)
	m.Update(tea.WindowSizeMsg{Width: 40, Height: 24})
	press(m, "?")
	press(m, "pgdown")
	if !m.showHelp || m.help.YOffset == 0 {
		t.Fatal("help cannot be scrolled on a narrow terminal")
	}
	if press(m, "s") != nil || len(m.processes) != 0 {
		t.Fatal("help dispatched an action")
	}
	press(m, "esc")
	if m.showHelp {
		t.Fatal("help did not close")
	}
}

func TestStatsAggregateAndFormat(t *testing.T) {
	m := testModel(t)
	cost, seconds, nan := 2.5, uint64(90), math.NaN()
	m.data.runs[0].states = []worker.State{{Model: "opus", Cost: &cost, DurationSeconds: &seconds}, {Model: "opus", Cost: &nan, DurationSeconds: &seconds}, {Model: "unused"}}
	rows := m.data.stats()
	if len(rows) != 1 || rows[0].cost != cost || rows[0].seconds != 180 {
		t.Fatalf("wrong aggregation: %+v", rows)
	}
	for _, tc := range []struct {
		cost float64
		want string
	}{{0.1234, "$0.1234"}, {12.34, "$12.34"}, {123.4, "$123"}} {
		if formatCost(tc.cost) != tc.want {
			t.Fatal("cost format")
		}
	}
	if formatTime(61) != "1m 01s" || formatTime(3601) != "1h 00m" {
		t.Fatal("time format")
	}
	if strings.ContainsRune(safeText("test\x1b[2J\x07\r"), '\x1b') {
		t.Fatal("terminal escape injection")
	}
	maximumCost, maximumTime := math.MaxFloat64, uint64(math.MaxUint64)
	m.data.runs[0].states = []worker.State{{Model: "large", Cost: &maximumCost, DurationSeconds: &maximumTime}, {Model: "large", Cost: &maximumCost, DurationSeconds: &maximumTime}}
	rows = m.data.stats()
	if math.IsInf(rows[0].cost, 0) || rows[0].seconds != math.MaxUint64 {
		t.Fatal("stats should saturate rather than overflow")
	}
	m.section = stats
	_ = m.View()
}
