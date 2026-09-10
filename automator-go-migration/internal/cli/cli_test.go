package cli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"automator/internal/config"
	"automator/internal/persistence"
)

func isolated(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("AUTOMATOR_HOME", filepath.Join(home, "automator"))
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, "data"))
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", filepath.Join(home, "pi"))
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(home, "claude"))
	t.Setenv("PATH", home)
	return home
}

func execute(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := Execute(context.Background(), args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestHelpVersionUsage(t *testing.T) {
	home := isolated(t)
	for _, args := range [][]string{{"--help"}, {"run", "--help"}, {"help", "validate"}, {"--version"}, {"-V"}} {
		if code, out, err := execute(t, args...); code != 0 || out == "" || err != "" {
			t.Errorf("%v: %d %q %q", args, code, out, err)
		}
	}
	_, help, _ := execute(t, "--help")
	for _, hidden := range []string{"worker", "report-refresh", "completion"} {
		if strings.Contains(help, hidden) {
			t.Errorf("hidden command %s appeared in help", hidden)
		}
	}
	for _, args := range [][]string{
		{"unknown"}, {"run"}, {"start", "run"}, {"worker", "--run", home},
		{"continue-worker", "--run", home, "--model", "test"}, {"models", "--model", "x"},
		{"run", "test", "--run-heavy", "--run-heavy"}, {"start", "run", "model", "--force", "--force"},
		{"run", "test", "--run-heavy=false"}, {"worker", "--run", home, "--run", home, "--model", "test"},
	} {
		if code, _, err := execute(t, args...); code != 2 || err == "" {
			t.Errorf("%v: expected usage error, got %d %q", args, code, err)
		}
	}
	if _, err := os.Stat(config.HomeDir()); !os.IsNotExist(err) {
		t.Fatalf("help and usage must not initialize home: %v", err)
	}
}

func TestListsAndSelection(t *testing.T) {
	home := isolated(t)
	if code, _, err := execute(t, "init"); code != 0 {
		t.Fatal(code, err)
	}
	models := config.ModelsFile{SchemaVersion: 1, Models: map[string]config.Model{
		"beta":  {DisplayName: "Beta", Tool: config.Opencode, Provider: "anthropic", Model: "test"},
		"alpha": {DisplayName: "Alpha", Tool: config.Pi, Provider: "anthropic", Model: "test"},
	}}
	if err := persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models); err != nil {
		t.Fatal(err)
	}
	presets := config.ModelPresetsFile{SchemaVersion: 1, Presets: map[string]config.ModelPreset{
		"all": {DisplayName: "All", Models: []string{"beta", "alpha"}},
	}}
	if err := persistence.SaveYAML(filepath.Join(config.HomeDir(), "model-presets.yaml"), presets); err != nil {
		t.Fatal(err)
	}
	draft := config.DraftRun{SchemaVersion: 1, Name: "CLI Run", Root: filepath.Join(home, "runs"), Concurrency: 6, Mode: config.Headless, Template: "empty", Prompt: "test"}
	if err := persistence.SaveYAML(filepath.Join(config.HomeDir(), "drafts", "example", "v1.yaml"), draft); err != nil {
		t.Fatal(err)
	}
	if code, out, err := execute(t, "models"); code != 0 || out != "alpha\tAlpha\tPi\tanthropic/test\nbeta\tBeta\tOpencode\tanthropic/test\n" {
		t.Fatal(code, out, err)
	}
	if code, out, err := execute(t, "presets"); code != 0 || out != "all\tAll\tbeta,alpha\n" {
		t.Fatal(code, out, err)
	}
	code, out, err := execute(t, "validate", "example", "-m", "beta,alpha", "--model", "alpha", "-p", "all,all")
	if code != 0 || strings.Count(out, "  - alpha (") != 1 || strings.Count(out, "  - beta (") != 1 {
		t.Fatal(code, out, err)
	}
	if code, _, err := execute(t, "validate", "example"); code != 1 || !strings.Contains(err, "no models selected") {
		t.Fatal(code, err)
	}
	if _, err := os.Stat(draft.Root); !os.IsNotExist(err) {
		t.Fatalf("validate wrote run root: %v", err)
	}
}

func TestCancellationExit(t *testing.T) {
	isolated(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var stdout, stderr bytes.Buffer
	if code := Execute(ctx, []string{"tui"}, &stdout, &stderr); code != 130 {
		t.Fatal(code, stderr.String())
	}
}

func TestCommaSplitNotCSV(t *testing.T) {
	var selection selectionValues
	_ = selection.Set("'a',b")
	_ = selection.Set("c,,d")
	if strings.Join(selection, "|") != "'a'|b|c||d" {
		t.Fatal(selection)
	}
}
