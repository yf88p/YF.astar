package tui

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/report"
	"automator/internal/worker"
)

type draftEntry struct {
	name, version, path string
	draft               *config.DraftRun
	err                 error
}

type runEntry struct {
	name, path, started string
	mode                config.RunMode
	snapshot            *config.RunSnapshot
	states              []worker.State
	err                 error
}

type dashboardData struct {
	drafts    []draftEntry
	runs      []runEntry
	models    map[string]config.Model
	presets   map[string]config.ModelPreset
	providers map[string]config.Provider
	templates map[string]config.Template
}

// Invalid draft YAML stays visible so it can be repaired with the editor.
func loadDashboard() (dashboardData, error) {
	var data dashboardData
	models, err := config.Models()
	if err != nil {
		return data, err
	}
	data.models = models.Models
	presets, err := config.ModelPresets()
	if err != nil {
		return data, err
	}
	data.presets = presets.Presets
	providers, err := config.Providers()
	if err != nil {
		return data, err
	}
	data.providers = providers.Providers
	templates, err := config.Templates()
	if err != nil {
		return data, err
	}
	data.templates = templates.Templates
	root := filepath.Join(config.HomeDir(), "drafts")
	entries, err := os.ReadDir(root)
	if err != nil {
		return data, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		versions, err := os.ReadDir(filepath.Join(root, entry.Name()))
		if err != nil {
			return data, err
		}
		latest, path := int64(-1), ""
		for _, version := range versions {
			if version.IsDir() {
				continue
			}
			stem := strings.TrimSuffix(version.Name(), filepath.Ext(version.Name()))
			if !strings.HasPrefix(stem, "v") {
				continue
			}
			n, err := strconv.ParseUint(strings.TrimPrefix(strings.TrimPrefix(stem, "v"), "+"), 10, 32)
			if err == nil && int64(n) > latest {
				latest, path = int64(n), filepath.Join(root, entry.Name(), version.Name())
			}
		}
		if path == "" {
			continue
		}
		draft := draftEntry{name: entry.Name(), version: fmt.Sprintf("v%d", latest), path: path}
		var value config.DraftRun
		draft.err = persistence.LoadYAML(path, &value)
		if draft.err == nil && value.SchemaVersion != 1 {
			draft.err = fmt.Errorf("unsupported schema_version %d; expected 1", value.SchemaVersion)
		}
		if draft.err == nil {
			draft.draft = &value
		}
		data.drafts = append(data.drafts, draft)
	}
	index, err := config.LoadRunsIndex()
	if err != nil {
		return data, err
	}
	seen := make(map[string]bool)
	for i := len(index.Runs) - 1; i >= 0; i-- {
		entry := index.Runs[i]
		path := filepath.Clean(entry.Path)
		if seen[path] {
			continue
		}
		seen[path] = true
		run := runEntry{name: entry.Name, path: path, started: entry.StartedAt, mode: entry.Mode}
		var snapshot config.RunSnapshot
		if err := persistence.LoadYAML(filepath.Join(path, "run.yaml"), &snapshot); err == nil {
			run.snapshot = &snapshot
		}
		run.states, run.err = report.LoadStates(path)
		sort.Slice(run.states, func(i, j int) bool { return run.states[i].Model < run.states[j].Model })
		data.runs = append(data.runs, run)
	}
	sort.SliceStable(data.runs, func(i, j int) bool { return data.runs[i].started > data.runs[j].started })
	return data, nil
}

type runRow struct {
	run   *runEntry
	state *worker.State
}

func (d dashboardData) runRows() []runRow {
	var rows []runRow
	for i := range d.runs {
		run := &d.runs[i]
		if len(run.states) == 0 {
			rows = append(rows, runRow{run: run})
		}
		for j := range run.states {
			rows = append(rows, runRow{run: run, state: &run.states[j]})
		}
	}
	return rows
}

func (r runRow) id() string {
	if r.state == nil {
		return r.run.path
	}
	return r.run.path + "\x00" + r.state.Model
}

func blocksQueue(status worker.Status) bool {
	return status == worker.Queued || status == worker.Running
}

type statsRow struct {
	model   string
	cost    float64
	seconds uint64
}

func (d dashboardData) stats() []statsRow {
	byModel := make(map[string]statsRow)
	for _, run := range d.runs {
		for _, state := range run.states {
			row := byModel[state.Model]
			row.model = state.Model
			if state.Cost != nil && !math.IsNaN(*state.Cost) && !math.IsInf(*state.Cost, 0) && *state.Cost > 0 {
				if math.MaxFloat64-row.cost < *state.Cost {
					row.cost = math.MaxFloat64
				} else {
					row.cost += *state.Cost
				}
			}
			if state.DurationSeconds != nil {
				if math.MaxUint64-row.seconds < *state.DurationSeconds {
					row.seconds = math.MaxUint64
				} else {
					row.seconds += *state.DurationSeconds
				}
			}
			byModel[state.Model] = row
		}
	}
	var rows []statsRow
	for _, key := range config.SortedKeys(byModel) {
		row := byModel[key]
		if row.cost > 0 || row.seconds > 0 {
			rows = append(rows, row)
		}
	}
	return rows
}

func listWindowStart(selected, length, visible int) int {
	if visible <= 0 || length <= visible {
		return 0
	}
	return min(max(0, selected-visible/2), length-visible)
}
