package report

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/worker"
)

func fixture(t *testing.T) (string, config.RunSnapshot) {
	t.Helper()
	root := t.TempDir()
	for _, name := range []string{"HOME", "USERPROFILE", "AUTOMATOR_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"} {
		t.Setenv(name, filepath.Join(root, name))
	}
	runDir := filepath.Join(root, "run")
	snapshot := config.RunSnapshot{
		SchemaVersion: 1, Name: "Benchmark | raw", Root: root, RunDir: runDir,
		Concurrency: 2, Mode: config.Headless, HerdrSession: "team's run; $(ignored)",
		Template: config.Template{DisplayName: "Empty", Steps: []config.ShellStep{}},
		Models:   map[string]config.Model{},
	}
	saveYAML(t, filepath.Join(runDir, "run.yaml"), snapshot)
	return runDir, snapshot
}

func saveYAML(t *testing.T, path string, value any) {
	t.Helper()
	if err := persistence.SaveYAML(path, value); err != nil {
		t.Fatal(err)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := persistence.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func pointer[T any](value T) *T { return &value }

func TestWriteMarkdown(t *testing.T) {
	runDir, _ := fixture(t)
	outside := filepath.Join(filepath.Dir(runDir), "run-other", "project")
	saveYAML(t, worker.StatePath(runDir, "z-file"), worker.State{
		Model: "Alpha", Provider: "open|router", Tool: "opencode", Status: worker.Done,
		DurationSeconds: pointer(uint64(125)), InputTokens: pointer(uint64(123)),
		CacheReadTokens: pointer(uint64(0)), CacheWriteTokens: pointer(uint64(7)),
		OutputTokens: pointer(uint64(5)), ReasoningTokens: pointer(uint64(2)),
		TotalTokens: pointer(uint64(999)), Cost: pointer(1.23456),
		ProjectPath: filepath.Join(runDir, "Alpha"), NativeSessionID: pointer("ses'one"),
		NativeReopen: "cd 'a path' && opencode --session 'ses'\\''one'",
		HerdrAttach:  pointer("herdr custom 'saved command'"),
	})
	saveYAML(t, worker.StatePath(runDir, "a-file"), worker.State{
		Model: "zulu", Provider: "anthropic", Tool: "claude", Status: worker.Queued,
		ProjectPath: outside, NativeReopen: "claude --resume '<session-id>'",
		TmuxAttach: pointer("must not appear"),
	})
	if err := Write(runDir); err != nil {
		t.Fatal(err)
	}
	want := strings.ReplaceAll(readFile(t, filepath.Join("testdata", "modern.md")), "<outside>", outside)
	if got := readFile(t, filepath.Join(runDir, "report.md")); got != want {
		t.Fatalf("report mismatch\ngot:\n%s\nwant:\n%s", got, want)
	}
}

func TestWriteLegacyMarkdown(t *testing.T) {
	runDir, snapshot := fixture(t)
	snapshot.Name, snapshot.HerdrSession = "Legacy", ""
	saveYAML(t, filepath.Join(runDir, "run.yaml"), snapshot)
	saveYAML(t, worker.StatePath(runDir, "legacy"), worker.State{
		Model: "legacy", Provider: "provider", Tool: "pi", Status: worker.Failed,
		DurationSeconds: pointer(uint64(0)), InputTokens: pointer(uint64(0)),
		CacheWriteTokens: pointer(uint64(8)), OutputTokens: pointer(uint64(0)), Cost: pointer(0.0),
		ProjectPath: runDir, HerdrAttach: pointer(""),
	})
	if err := Write(runDir); err != nil {
		t.Fatal(err)
	}
	want := readFile(t, filepath.Join("testdata", "legacy.md"))
	if got := readFile(t, filepath.Join(runDir, "report.md")); got != want {
		t.Fatalf("report mismatch\ngot:\n%s\nwant:\n%s", got, want)
	}
}

func TestWriteEmptyReport(t *testing.T) {
	runDir, snapshot := fixture(t)
	snapshot.Name, snapshot.HerdrSession = "Empty", "Automator"
	saveYAML(t, filepath.Join(runDir, "run.yaml"), snapshot)
	if err := Write(runDir); err != nil {
		t.Fatal(err)
	}
	want := "# Empty\n\n" +
		"| Model | Provider | Tool | Status | Duration | Input (cache miss) | Cache hit | Cache write | Output | Reasoning | Total Tokens | Cost | Project | Session |\n" +
		"|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|\n" +
		"\n## Reopen\n\n- herdr: `herdr session attach 'Automator'`\n"
	if got := readFile(t, filepath.Join(runDir, "report.md")); got != want {
		t.Fatalf("report = %q; want %q", got, want)
	}
	if _, err := os.Stat(filepath.Join(runDir, ".automator")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("report created state directories: %v", err)
	}
}

func TestLoadStates(t *testing.T) {
	runDir, _ := fixture(t)
	alpha := worker.State{Model: "Alpha", Status: worker.Paused, Cost: pointer(0.0), InputTokens: pointer(uint64(0))}
	zulu := worker.State{Model: "zulu", Status: worker.Running, NativeSessionID: pointer("session")}
	saveYAML(t, worker.StatePath(runDir, "first"), zulu)
	saveYAML(t, worker.StatePath(runDir, "last"), alpha)
	stateDir := filepath.Join(runDir, ".automator", "state")
	for _, name := range []string{"ignore.yml", "ignore.YAML", "ignore.yaml.tmp", ".yaml", "README"} {
		writeFile(t, filepath.Join(stateDir, name), "not: [valid YAML")
	}
	writeFile(t, filepath.Join(stateDir, "nested", "ignored.yaml"), "not: [valid YAML")
	// LoadStates remains safe for callers that already hold the run lock.
	unlock, err := persistence.Lock(context.Background(), worker.RunLockPath(runDir))
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	states, err := LoadStates(runDir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []worker.State{alpha, zulu}; !reflect.DeepEqual(states, want) {
		t.Fatalf("states = %+v; want %+v", states, want)
	}
}

func TestLoadStatesMissing(t *testing.T) {
	runDir, _ := fixture(t)
	for _, path := range []string{runDir, filepath.Join(runDir, "missing")} {
		states, err := LoadStates(path)
		if err != nil || len(states) != 0 {
			t.Fatalf("LoadStates(%q) = %+v, %v", path, states, err)
		}
	}
	if _, err := os.Stat(filepath.Join(runDir, ".automator")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("LoadStates created directories: %v", err)
	}
}

func TestLoadStatesErrors(t *testing.T) {
	for _, content := range []string{"broken: [", "model: x\nstatus: unknown\n", "input_tokens: -1\n", "model: x\n---\nmodel: y\n"} {
		t.Run(content, func(t *testing.T) {
			runDir, _ := fixture(t)
			path := worker.StatePath(runDir, "bad")
			writeFile(t, path, content)
			if _, err := LoadStates(runDir); err == nil || !strings.Contains(err.Error(), path) {
				t.Fatalf("LoadStates error = %v; want error naming %s", err, path)
			}
		})
	}
	for _, name := range []string{"state is a file", "yaml entry is a directory", "yaml entry is a broken symlink"} {
		t.Run(name, func(t *testing.T) {
			runDir, _ := fixture(t)
			path := worker.StatePath(runDir, "bad")
			switch name {
			case "state is a file":
				writeFile(t, filepath.Dir(path), "not a directory")
			case "yaml entry is a directory":
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
			case "yaml entry is a broken symlink":
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(runDir, "missing"), path); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := LoadStates(runDir); err == nil {
				t.Fatal("expected a state read error")
			}
		})
	}
}

func TestWriteRejectsMissingOrInvalidRun(t *testing.T) {
	runDir, _ := fixture(t)
	missing := filepath.Join(runDir, "absent", "run")
	if err := Write(missing); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing run error = %v", err)
	}
	if _, err := os.Stat(filepath.Dir(missing)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing run parent was created: %v", err)
	}
	if err := Write(filepath.Join(runDir, "run.yaml")); err == nil {
		t.Fatal("accepted a file as the run directory")
	}
	if err := os.Remove(filepath.Join(runDir, "run.yaml")); err != nil {
		t.Fatal(err)
	}
	if err := Write(runDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing snapshot error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(runDir, "report.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("report was created without snapshot: %v", err)
	}
}

func TestWritePreservesReportOnLoadError(t *testing.T) {
	for _, name := range []string{"run.yaml", ".automator/state/bad.yaml"} {
		t.Run(name, func(t *testing.T) {
			runDir, _ := fixture(t)
			path := filepath.Join(runDir, "report.md")
			writeFile(t, path, "old report\n")
			writeFile(t, filepath.Join(runDir, name), "broken: [")
			if err := Write(runDir); err == nil {
				t.Fatal("expected YAML error")
			}
			if got := readFile(t, path); got != "old report\n" {
				t.Fatalf("report changed on error: %q", got)
			}
		})
	}
}

func TestWriteAtomicReplacement(t *testing.T) {
	runDir, _ := fixture(t)
	path := filepath.Join(runDir, "report.md")
	writeFile(t, path, "old report\n")
	if err := os.Chmod(path, 0640); err != nil {
		t.Fatal(err)
	}
	old, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	if err := Write(runDir); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(old)
	if err != nil || string(data) != "old report\n" {
		t.Fatalf("old open report was modified: %q, %v", data, err)
	}
	if got := readFile(t, path); !strings.HasPrefix(got, "# Benchmark | raw\n") {
		t.Fatalf("new report was not installed: %q", got)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0640 {
		t.Fatalf("permissions = %o; want 640", info.Mode().Perm())
	}
	assertNoTemps(t, runDir)
}

func TestWritePersistenceError(t *testing.T) {
	runDir, _ := fixture(t)
	if err := os.Mkdir(filepath.Join(runDir, "report.md"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := Write(runDir); err == nil {
		t.Fatal("expected atomic rename failure")
	}
	assertNoTemps(t, runDir)
}

func assertNoTemps(t *testing.T, runDir string) {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(runDir, ".report.md-*.tmp"))
	if err != nil || len(paths) != 0 {
		t.Fatalf("temporary reports remain: %v, %v", paths, err)
	}
}

func TestWriteWaitsForRunLock(t *testing.T) {
	for _, deleted := range []bool{false, true} {
		name := "reads latest snapshot and states after unlock"
		if deleted {
			name = "deleted while waiting is not resurrected"
		}
		t.Run(name, func(t *testing.T) {
			runDir, snapshot := fixture(t)
			unlock, err := persistence.Lock(context.Background(), worker.RunLockPath(runDir))
			if err != nil {
				t.Fatal(err)
			}
			defer unlock()
			started, result := make(chan struct{}), make(chan error, 1)
			go func() {
				close(started)
				result <- Write(runDir)
			}()
			<-started
			select {
			case err := <-result:
				t.Fatalf("Write returned while run lock was held: %v", err)
			case <-time.After(100 * time.Millisecond):
			}
			if deleted {
				if err := os.RemoveAll(runDir); err != nil {
					t.Fatal(err)
				}
			} else {
				snapshot.Name = "Updated under lock"
				saveYAML(t, filepath.Join(runDir, "run.yaml"), snapshot)
				saveYAML(t, worker.StatePath(runDir, "new"), worker.State{Model: "new", Status: worker.Done})
			}
			unlock()
			select {
			case err := <-result:
				if deleted {
					if !errors.Is(err, os.ErrNotExist) {
						t.Fatalf("deleted run error = %v", err)
					}
					if _, err := os.Stat(runDir); !errors.Is(err, os.ErrNotExist) {
						t.Fatalf("run was resurrected: %v", err)
					}
				} else {
					if err != nil {
						t.Fatal(err)
					}
					md := readFile(t, filepath.Join(runDir, "report.md"))
					if !strings.HasPrefix(md, "# Updated under lock\n") || !strings.Contains(md, "| new |  |  | Done |") {
						t.Fatalf("report used stale data: %s", md)
					}
				}
			case <-time.After(5 * time.Second):
				t.Fatal("Write did not return after releasing the run lock")
			}
		})
	}
}

func capturePrint(t *testing.T, run string) (string, error) {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	original := os.Stdout
	os.Stdout = file
	defer func() { os.Stdout = original }()
	printErr := Print(run)
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(file)
	if err != nil {
		t.Fatal(err)
	}
	return string(data), printErr
}

func TestPrint(t *testing.T) {
	for _, content := range []string{"", "saved report", "saved report\n"} {
		t.Run(content, func(t *testing.T) {
			runDir, _ := fixture(t)
			path := filepath.Join(runDir, "report.md")
			writeFile(t, path, content)
			got, err := capturePrint(t, runDir)
			if want := path + "\n" + content + "\n"; err != nil || got != want {
				t.Fatalf("Print = %q, %v; want %q", got, err, want)
			}
			if _, err := os.Stat(config.HomeDir()); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("path lookup touched Automator home: %v", err)
			}
		})
	}
}

func TestPrintNameAndMissingReport(t *testing.T) {
	runDir, snapshot := fixture(t)
	saveYAML(t, filepath.Join(config.HomeDir(), "runs-index.yaml"), config.RunsIndex{
		SchemaVersion: 1,
		Runs: []config.RunIndexEntry{
			{Name: snapshot.Name, Path: filepath.Join(runDir, "old"), Mode: config.Headless},
			{Name: snapshot.Name, Path: runDir, Mode: config.Headless},
		},
	})
	for _, run := range []string{runDir, snapshot.Name, filepath.Base(runDir)} {
		got, err := capturePrint(t, run)
		if want := filepath.Join(runDir, "report.md") + "\n"; err != nil || got != want {
			t.Fatalf("Print(%q) = %q, %v; want %q", run, got, err, want)
		}
	}
	if _, err := os.Stat(filepath.Join(runDir, "report.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Print generated a report: %v", err)
	}
	if got, err := capturePrint(t, "unknown run"); err == nil || got != "" {
		t.Fatalf("unknown run Print = %q, %v", got, err)
	}
}

func TestPrintReadErrors(t *testing.T) {
	for _, directory := range []bool{false, true} {
		runDir, _ := fixture(t)
		path := filepath.Join(runDir, "report.md")
		if directory {
			if err := os.Mkdir(path, 0700); err != nil {
				t.Fatal(err)
			}
		} else {
			writeFile(t, path, "\xff")
		}
		if got, err := capturePrint(t, runDir); err == nil || got != path+"\n" {
			t.Fatalf("Print = %q, %v; want path followed by read error", got, err)
		}
	}
}
