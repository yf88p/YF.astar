package tui

import (
	"os"
	"path/filepath"
	"testing"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/worker"
)

func TestLoadDashboardIsolatedFixtures(t *testing.T) {
	home := t.TempDir()
	t.Setenv("AUTOMATOR_HOME", home)
	if err := config.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	save := func(path string, value any) {
		t.Helper()
		if err := persistence.SaveYAML(path, value); err != nil {
			t.Fatal(err)
		}
	}
	draft := config.DraftRun{SchemaVersion: 1, Name: "draft", Root: "/fixture", Mode: config.Headless, Concurrency: 2, Template: "empty", Prompt: "test"}
	save(filepath.Join(home, "drafts", "draft", "v2.yaml"), draft)
	draft.Prompt = "latest"
	save(filepath.Join(home, "drafts", "draft", "v10.yaml"), draft)
	broken := filepath.Join(home, "drafts", "broken")
	if err := os.MkdirAll(broken, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(broken, "v1.yaml"), []byte("name: [bad YAML"), 0600); err != nil {
		t.Fatal(err)
	}
	oldPath, newPath := filepath.Join(home, "old-run"), filepath.Join(home, "new-run")
	for _, path := range []string{oldPath, newPath} {
		save(filepath.Join(path, "run.yaml"), config.RunSnapshot{SchemaVersion: 1, Name: "run", RunDir: path, Mode: config.Headless, Models: map[string]config.Model{}})
		save(worker.StatePath(path, "opus"), worker.State{Model: "opus", Status: worker.Done})
	}
	if err := config.SaveRunsIndex(config.RunsIndex{SchemaVersion: 1, Runs: []config.RunIndexEntry{
		{Name: "old", Path: oldPath, StartedAt: "2026-01-01", Mode: config.Headless},
		{Name: "new", Path: newPath, StartedAt: "2026-02-01", Mode: config.Headless},
		{Name: "new-duplicate", Path: newPath, StartedAt: "2026-02-01", Mode: config.Headless},
	}}); err != nil {
		t.Fatal(err)
	}
	data, err := loadDashboard()
	if err != nil {
		t.Fatal(err)
	}
	if len(data.drafts) != 2 || data.drafts[0].name != "broken" || data.drafts[0].draft != nil || data.drafts[0].err == nil {
		t.Fatalf("broken draft must remain editable: %+v", data.drafts)
	}
	if data.drafts[1].version != "v10" || data.drafts[1].draft.Prompt != "latest" {
		t.Fatal("versions sorted lexicographically instead of numerically")
	}
	if len(data.runs) != 2 || data.runs[0].path != newPath || data.runs[0].name != "new-duplicate" {
		t.Fatalf("runs not deduplicated newest first: %+v", data.runs)
	}
	if len(data.runRows()) != 2 || data.runRows()[0].state.Model != "opus" {
		t.Fatal("state rows not loaded")
	}
}

func TestUnknownDraftSchemaRemainsEditableButNotRunnable(t *testing.T) {
	t.Setenv("AUTOMATOR_HOME", t.TempDir())
	if err := config.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(config.HomeDir(), "drafts", "future", "v1.yaml")
	if err := persistence.SaveYAML(path, config.DraftRun{SchemaVersion: 99, Mode: config.Headless}); err != nil {
		t.Fatal(err)
	}
	data, err := loadDashboard()
	if err != nil {
		t.Fatal(err)
	}
	if len(data.drafts) != 1 || data.drafts[0].draft != nil || data.drafts[0].path != path {
		t.Fatal("future schema draft not retained safely")
	}
}
