package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"automator/internal/adapter"
	"automator/internal/config"
	"automator/internal/persistence"
)

func fixture(t *testing.T) (string, config.RunSnapshot) {
	t.Helper()
	runDir := filepath.Join(t.TempDir(), "run")
	if err := os.Mkdir(runDir, 0o700); err != nil {
		t.Fatal(err)
	}
	snapshot := config.RunSnapshot{
		SchemaVersion: 1, Name: "test", RunDir: runDir, Mode: config.Headless,
		HerdrSession: "Automator", Concurrency: 1,
		Models:   map[string]config.Model{"model": {Tool: config.Opencode, Provider: "provider", Model: "native"}},
		Template: config.Template{Steps: []config.ShellStep{{Shell: "template"}}},
		Pre:      []config.ShellStep{{Shell: "pre"}}, PostEach: []config.ShellStep{{Shell: "post"}},
		PostAll: []config.ShellStep{{Shell: "must not run"}},
	}
	writeSnapshot(t, runDir, snapshot)
	return runDir, snapshot
}

func writeSnapshot(t *testing.T, runDir string, snapshot config.RunSnapshot) {
	t.Helper()
	if err := persistence.SaveYAML(filepath.Join(runDir, "run.yaml"), snapshot); err != nil {
		t.Fatal(err)
	}
}

// All external boundaries are replaced. These tests never inspect native tool
// session directories, run real agents, or communicate with Herdr.
func isolatedDependencies() dependencies {
	return dependencies{
		build: func(config.Model, string, string, string) (adapter.Command, error) {
			return adapter.Command{Program: "fake-agent"}, nil
		},
		resume: func(config.Model, string, string, string) (adapter.Command, error) {
			return adapter.Command{Program: "fake-agent"}, nil
		},
		collect: func(context.Context, config.Model, string, string, time.Time) (adapter.Metrics, error) {
			return adapter.Metrics{}, nil
		},
		recover: func(context.Context, config.Model, string, string, time.Time, string) (adapter.Metrics, error) {
			return adapter.Metrics{}, nil
		},
		shell:   func(context.Context, string, string) (int, error) { return 0, nil },
		agent:   func(context.Context, string, adapter.Command) error { return nil },
		cleanup: func(context.Context, string) {},
	}
}

func TestRunLifecycle(t *testing.T) {
	for _, test := range []struct {
		name, fail string
		want       Status
		events     []string
	}{
		{"success", "", Done, []string{"template", "pre", "git init", "git add -A", "commit", "build", "agent", "cleanup", "metrics", "post"}},
		{"template failure", "template", Failed, []string{"template", "post"}},
		{"pre failure", "pre", Failed, []string{"template", "pre", "post"}},
		{"git init failure", "git init", Failed, []string{"template", "pre", "git init", "post"}},
		{"git add failure", "git add -A", Failed, []string{"template", "pre", "git init", "git add -A", "post"}},
		{"git commit exit is ignored", "commit", Done, []string{"template", "pre", "git init", "git add -A", "commit", "build", "agent", "cleanup", "metrics", "post"}},
		{"build failure", "build", Failed, []string{"template", "pre", "git init", "git add -A", "commit", "build", "post"}},
		{"agent failure", "agent", Failed, []string{"template", "pre", "git init", "git add -A", "commit", "build", "agent", "cleanup", "metrics", "post"}},
		{"post failure runs only once", "post", Failed, []string{"template", "pre", "git init", "git add -A", "commit", "build", "agent", "cleanup", "metrics", "post"}},
		{"cancelled agent skips post", "cancel", Cancelled, []string{"template", "pre", "git init", "git add -A", "commit", "build", "agent", "cleanup", "metrics"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			runDir, _ := fixture(t)
			deps := isolatedDependencies()
			var events []string
			deps.shell = func(ctx context.Context, project, shell string) (int, error) {
				if project != filepath.Join(runDir, "model") {
					return 0, fmt.Errorf("wrong project: %s", project)
				}
				if strings.Contains(shell, "Automator baseline") {
					shell = "commit"
				}
				events = append(events, shell)
				if shell == test.fail {
					return 17, nil
				}
				return 0, nil
			}
			deps.build = func(model config.Model, project, prompt, title string) (adapter.Command, error) {
				events = append(events, "build")
				if model.Model != "native" || prompt != filepath.Join(runDir, "prompt.md") || title != "test:model" {
					return adapter.Command{}, fmt.Errorf("wrong command arguments")
				}
				if test.fail == "build" {
					return adapter.Command{}, errors.New("build failure")
				}
				return adapter.Command{Program: "fake-agent"}, nil
			}
			deps.agent = func(context.Context, string, adapter.Command) error {
				events = append(events, "agent")
				if test.fail == "agent" {
					return errors.New("agent failure")
				}
				if test.fail == "cancel" {
					return context.Canceled
				}
				return nil
			}
			deps.cleanup = func(context.Context, string) { events = append(events, "cleanup") }
			deps.collect = func(ctx context.Context, model config.Model, project, title string, started time.Time) (adapter.Metrics, error) {
				events = append(events, "metrics")
				return adapter.Metrics{NativeSessionID: pointer("session"), ToolVersion: pointer("1.2.3")}, nil
			}
			err := execute(context.Background(), runDir, "model", nil, deps)
			if (err == nil) != (test.want == Done) {
				t.Fatalf("error = %v; want status %s", err, test.want)
			}
			if errors.Is(err, context.Canceled) != (test.want == Cancelled) {
				t.Fatalf("cancellation error = %v", err)
			}
			if !reflect.DeepEqual(events, test.events) {
				t.Fatalf("events = %v; want %v", events, test.events)
			}
			state, err := LoadState(runDir, "model")
			if err != nil {
				t.Fatal(err)
			}
			if state.Status != test.want || state.StartedAt == nil || state.FinishedAt == nil || state.DurationSeconds == nil {
				t.Fatalf("bad final state: %+v", state)
			}
			if state.Status != Done && state.Error == nil {
				t.Fatal("missing failure description")
			}
			if state.HerdrSession != nil || state.TmuxAttach != nil {
				t.Fatal("headless state contains attach metadata")
			}
			if contains(events, "metrics") && (state.NativeSessionID == nil || state.ToolVersion == nil) {
				t.Fatal("agent metadata not preserved")
			}
		})
	}
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func TestFailureCombinesPostError(t *testing.T) {
	runDir, _ := fixture(t)
	deps := isolatedDependencies()
	deps.shell = func(context.Context, string, string) (int, error) { return 7, nil }
	err := execute(context.Background(), runDir, "model", nil, deps)
	if err == nil || !strings.Contains(err.Error(), "template") || !strings.Contains(err.Error(), "post_each failed") {
		t.Fatalf("error = %v", err)
	}
}

func TestMetricsAndPricing(t *testing.T) {
	runDir, snapshot := fixture(t)
	model := snapshot.Models["model"]
	model.Pricing = &config.ModelPricing{InputPerMillion: 2, OutputPerMillion: 3, CacheReadPerMillion: 4, CacheWritePerMillion: 5}
	snapshot.Models["model"] = model
	writeSnapshot(t, runDir, snapshot)
	deps := isolatedDependencies()
	deps.collect = func(context.Context, config.Model, string, string, time.Time) (adapter.Metrics, error) {
		return adapter.Metrics{
			InputTokens: pointer(uint64(10)), OutputTokens: pointer(uint64(20)), ReasoningTokens: pointer(uint64(2)),
			CacheReadTokens: pointer(uint64(3)), CacheWriteTokens: pointer(uint64(4)), TotalTokens: pointer(uint64(999)),
			NativeSessionID: pointer("ses'quoted"), ToolVersion: pointer("1.0"),
		}, nil
	}
	if err := execute(context.Background(), runDir, "model", nil, deps); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if state.TotalTokens == nil || *state.TotalTokens != 999 {
		t.Fatal("lost native total")
	}
	if state.Cost == nil || math.Abs(*state.Cost-0.000118) > 1e-12 {
		t.Fatalf("cost = %v", state.Cost)
	}
	if !strings.Contains(state.NativeReopen, "'ses'\\''quoted'") {
		t.Fatalf("reopen = %s", state.NativeReopen)
	}
}

func TestMetricsFailureRecoversAndKeepsPartialData(t *testing.T) {
	runDir, _ := fixture(t)
	deps := isolatedDependencies()
	deps.collect = func(context.Context, config.Model, string, string, time.Time) (adapter.Metrics, error) {
		return adapter.Metrics{ToolVersion: pointer("partial")}, errors.New("read failed")
	}
	deps.recover = func(context.Context, config.Model, string, string, time.Time, string) (adapter.Metrics, error) {
		return adapter.Metrics{NativeSessionID: pointer("recovered")}, nil
	}
	if err := execute(context.Background(), runDir, "model", nil, deps); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if state.NativeSessionID == nil || *state.NativeSessionID != "recovered" || state.ToolVersion == nil || *state.ToolVersion != "partial" {
		t.Fatalf("state = %+v", state)
	}
}

func TestContinuePreservesMissingMetricsAndSkipsHooks(t *testing.T) {
	runDir, snapshot := fixture(t)
	state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
	state.Status, state.NativeSessionID, state.ToolVersion = Done, pointer("existing"), pointer("old-version")
	state.InputTokens, state.OutputTokens, state.TotalTokens = pointer(uint64(8)), pointer(uint64(9)), pointer(uint64(17))
	state.Cost, state.Error = pointer(2.0), pointer("old error")
	if err := SaveState(runDir, "model", state); err != nil {
		t.Fatal(err)
	}
	deps := isolatedDependencies()
	deps.shell = func(context.Context, string, string) (int, error) { return 0, errors.New("unexpected hook") }
	deps.collect = func(context.Context, config.Model, string, string, time.Time) (adapter.Metrics, error) {
		return adapter.Metrics{}, errors.New("unexpected collect")
	}
	message := "literal 'message'\nwith a newline"
	deps.resume = func(model config.Model, project, session, gotMessage string) (adapter.Command, error) {
		if session != "existing" || gotMessage != message {
			return adapter.Command{}, fmt.Errorf("wrong continuation arguments")
		}
		return adapter.Command{Program: "fake-agent"}, nil
	}
	deps.recover = func(ctx context.Context, model config.Model, project, title string, started time.Time, known string) (adapter.Metrics, error) {
		if known != "existing" {
			return adapter.Metrics{}, fmt.Errorf("wrong known session")
		}
		return adapter.Metrics{InputTokens: pointer(uint64(0)), CostUSD: pointer(0.0)}, nil
	}
	if err := execute(context.Background(), runDir, "model", &message, deps); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != Done || state.Error != nil || *state.InputTokens != 0 || *state.OutputTokens != 9 || *state.TotalTokens != 17 || *state.Cost != 0 || *state.NativeSessionID != "existing" || *state.ToolVersion != "old-version" {
		t.Fatalf("continuation state = %+v", state)
	}
}

func TestContinueRequiresSessionWithoutMutatingState(t *testing.T) {
	runDir, snapshot := fixture(t)
	state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
	state.Status = Done
	if err := SaveState(runDir, "model", state); err != nil {
		t.Fatal(err)
	}
	message := "continue"
	if err := execute(context.Background(), runDir, "model", &message, isolatedDependencies()); err == nil || !strings.Contains(err.Error(), "no native session id") {
		t.Fatalf("error = %v", err)
	}
	got, err := LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, state) {
		t.Fatal("state changed on rejected continuation")
	}
}

func TestCancellationAndLifetimeLock(t *testing.T) {
	for _, via := range []string{"marker", "context", "setup", "post", "metadata"} {
		t.Run(via, func(t *testing.T) {
			runDir, _ := fixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			deps := isolatedDependencies()
			started := make(chan struct{})
			postCount := 0
			deps.shell = func(ctx context.Context, project, shell string) (int, error) {
				if shell == "post" {
					postCount++
				}
				if via == "setup" && shell == "template" || via == "post" && shell == "post" {
					close(started)
					<-ctx.Done()
					return 0, ctx.Err()
				}
				return 0, nil
			}
			deps.agent = func(ctx context.Context, _ string, _ adapter.Command) error {
				if via != "setup" && via != "post" && via != "metadata" {
					close(started)
					<-ctx.Done()
					return ctx.Err()
				}
				return nil
			}
			if via == "metadata" {
				deps.collect = func(ctx context.Context, _ config.Model, _, _ string, _ time.Time) (adapter.Metrics, error) {
					close(started)
					<-ctx.Done()
					return adapter.Metrics{}, ctx.Err()
				}
			}
			result := make(chan error, 1)
			go func() { result <- execute(ctx, runDir, "model", nil, deps) }()
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("worker did not start")
			}
			before, err := LoadState(runDir, "model")
			if err != nil {
				t.Fatal(err)
			}
			if err := execute(context.Background(), runDir, "model", nil, isolatedDependencies()); !errors.Is(err, ErrAlreadyRunning) {
				t.Fatalf("duplicate = %v", err)
			}
			message := "duplicate continuation"
			if err := execute(context.Background(), runDir, "model", &message, isolatedDependencies()); !errors.Is(err, ErrAlreadyRunning) {
				t.Fatalf("duplicate continue = %v", err)
			}
			if err := MarkFailed(runDir, "model", "duplicate launch failed"); err != nil {
				t.Fatal(err)
			}
			after, err := LoadState(runDir, "model")
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("duplicate worker overwrote state")
			}
			for _, path := range []string{ModelLockPath(runDir, "model"), RunLockPath(runDir)} {
				unlock, err := persistence.TryLock(path)
				if err != nil {
					t.Fatalf("transition lock blocked by worker: %v", err)
				}
				unlock()
			}
			if via == "marker" {
				if err := persistence.WriteFile(CancelPath(runDir, "model"), []byte("stop"), 0o600); err != nil {
					t.Fatal(err)
				}
			} else {
				cancel()
			}
			select {
			case err := <-result:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancellation = %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("cancellation did not finish")
			}
			state, err := LoadState(runDir, "model")
			if err != nil {
				t.Fatal(err)
			}
			if state.Status != Cancelled {
				t.Fatalf("status = %s", state.Status)
			}
			wantPost := 0
			if via == "post" {
				wantPost = 1
			}
			if postCount != wantPost {
				t.Fatalf("post count = %d", postCount)
			}
			if _, err := os.Stat(CancelPath(runDir, "model")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("cancel marker remains: %v", err)
			}
			unlock, err := persistence.TryLock(LifetimeLockPath(runDir, "model"))
			if err != nil {
				t.Fatal("lifetime lock leaked")
			}
			unlock()
		})
	}
}

func TestCancelMarkerDistinguishesStaleFromPrelaunch(t *testing.T) {
	for _, status := range []Status{Queued, Paused, Done, Failed, Cancelled, Running} {
		t.Run(string(status), func(t *testing.T) {
			runDir, snapshot := fixture(t)
			state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
			state.Status = status
			if err := SaveState(runDir, "model", state); err != nil {
				t.Fatal(err)
			}
			if err := persistence.WriteFile(CancelPath(runDir, "model"), []byte("stop"), 0o600); err != nil {
				t.Fatal(err)
			}
			deps := isolatedDependencies()
			steps := 0
			deps.shell = func(context.Context, string, string) (int, error) { steps++; return 0, nil }
			err := execute(context.Background(), runDir, "model", nil, deps)
			if status == Running {
				if !errors.Is(err, context.Canceled) || steps != 0 {
					t.Fatalf("prelaunch cancellation: steps=%d err=%v", steps, err)
				}
			} else if err != nil || steps == 0 {
				t.Fatalf("stale marker: steps=%d err=%v", steps, err)
			}
		})
	}
}

func TestDeletedStateIsNotResurrected(t *testing.T) {
	for _, deletion := range []string{"state", "model", "run", "replace run"} {
		t.Run(deletion, func(t *testing.T) {
			runDir, _ := fixture(t)
			deps := isolatedDependencies()
			deps.agent = func(context.Context, string, adapter.Command) error {
				unlock, err := transitionLock(context.Background(), runDir, "model")
				if err != nil {
					return err
				}
				defer unlock()
				switch deletion {
				case "state":
					return os.Remove(StatePath(runDir, "model"))
				case "model":
					if err := persistence.WriteFile(filepath.Join(runDir, ".automator", "deleted", "model"), []byte("deleted"), 0o600); err != nil {
						return err
					}
					return os.Remove(StatePath(runDir, "model"))
				case "run":
					return os.RemoveAll(runDir)
				case "replace run":
					if err := os.Rename(runDir, runDir+"-old"); err != nil {
						return err
					}
					if err := os.Mkdir(runDir, 0o700); err != nil {
						return err
					}
					return persistence.SaveYAML(StatePath(runDir, "model"), State{Model: "model", Status: Paused})
				}
				return nil
			}
			_ = execute(context.Background(), runDir, "model", nil, deps)
			if deletion == "replace run" {
				state, err := LoadState(runDir, "model")
				if err != nil || state.Status != Paused {
					t.Fatalf("replaced run modified: %+v %v", state, err)
				}
			} else if _, err := os.Stat(StatePath(runDir, "model")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("state resurrected: %v", err)
			}
			if deletion == "run" {
				if _, err := os.Stat(runDir); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("run recreated")
				}
			}
		})
	}
}

func TestStateSchemaAndMarkFailed(t *testing.T) {
	runDir, snapshot := fixture(t)
	state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
	state.Status, state.NativeSessionID, state.HerdrPaneID = Running, pointer("keep"), pointer("pane")
	state.InputTokens, state.TotalTokens = pointer(uint64(0)), pointer(uint64(3))
	if err := SaveState(runDir, "model", state); err != nil {
		t.Fatal(err)
	}
	if err := MarkFailed(runDir, "model", "launch failed"); err != nil {
		t.Fatal(err)
	}
	got, err := LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != Failed || *got.NativeSessionID != "keep" || *got.HerdrPaneID != "pane" || *got.TotalTokens != 3 || *got.InputTokens != 0 {
		t.Fatalf("failure lost metadata: %+v", got)
	}
	encoded, err := os.ReadFile(StatePath(runDir, "model"))
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"started_at: null", "cost: null", "reasoning_tokens: null", "tmux_attach: null", "input_tokens: 0"} {
		if !strings.Contains(string(encoded), field) {
			t.Errorf("YAML missing %q: %s", field, encoded)
		}
	}
	jsonData, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(jsonData, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 25 {
		t.Fatalf("state has %d schema fields: %s", len(fields), jsonData)
	}
	for _, terminal := range []Status{Done, Failed, Cancelled} {
		got.Status = terminal
		if err := SaveState(runDir, "model", got); err != nil {
			t.Fatal(err)
		}
		if err := MarkFailed(runDir, "model", "do not overwrite"); err != nil {
			t.Fatal(err)
		}
		after, err := LoadState(runDir, "model")
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, after) {
			t.Fatalf("terminal state %s changed", terminal)
		}
	}
	if err := os.Remove(StatePath(runDir, "model")); err != nil {
		t.Fatal(err)
	}
	if err := MarkFailed(runDir, "model", "synthesized"); err != nil {
		t.Fatal(err)
	}
	got, err = LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != Failed || got.StartedAt != nil || got.Provider != "provider" || *got.Error != "synthesized" {
		t.Fatalf("bad synthesized state: %+v", got)
	}
}

func TestHeadfulMetadata(t *testing.T) {
	runDir, snapshot := fixture(t)
	snapshot.Mode = config.Headful
	snapshot.HerdrSession = "session's name"
	snapshot.HerdrWorkspaceID = pointer("snapshot-workspace")
	writeSnapshot(t, runDir, snapshot)
	t.Setenv("HERDR_WORKSPACE_ID", "current-workspace")
	t.Setenv("HERDR_TAB_ID", "current-tab")
	t.Setenv("HERDR_PANE_ID", "current-pane")
	if err := execute(context.Background(), runDir, "model", nil, isolatedDependencies()); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if *state.HerdrWorkspaceID != "current-workspace" || *state.HerdrTabID != "current-tab" || *state.HerdrPaneID != "current-pane" || *state.HerdrAttach != "herdr session attach 'session'\\''s name'" {
		t.Fatalf("metadata = %+v", state)
	}
	t.Setenv("HERDR_WORKSPACE_ID", "")
	state = initialState(runDir, "model", snapshot.Models["model"], snapshot, true)
	if *state.HerdrWorkspaceID != "snapshot-workspace" {
		t.Fatal("missing workspace fallback")
	}
}

func TestPathsAndDeletedStarts(t *testing.T) {
	runDir, _ := fixture(t)
	for _, key := range []string{"", ".", "..", "../model", "a/b", "a\\b", "a\x00b"} {
		if err := Run(context.Background(), runDir, key); err == nil {
			t.Errorf("Run accepted %q", key)
		}
		if err := Continue(context.Background(), runDir, key, "message"); err == nil {
			t.Errorf("Continue accepted %q", key)
		}
		if _, err := LoadState(runDir, key); err == nil {
			t.Errorf("LoadState accepted %q", key)
		}
		if err := SaveState(runDir, key, State{Model: key}); err == nil {
			t.Errorf("SaveState accepted %q", key)
		}
		if err := MarkFailed(runDir, key, "bad"); err == nil {
			t.Errorf("MarkFailed accepted %q", key)
		}
	}
	if err := SaveState(runDir, "model", State{Model: "other"}); err == nil {
		t.Fatal("mismatched state accepted")
	}
	if ModelLockPath(runDir, "run") == RunLockPath(runDir) || ModelLockPath(runDir, "model") == LifetimeLockPath(runDir, "model") {
		t.Fatal("lock namespaces collided")
	}
	if filepath.Dir(RunLockPath(runDir)) != filepath.Join(filepath.Dir(runDir), ".automator-locks") {
		t.Fatal("lock stored inside run")
	}
	if err := persistence.WriteFile(filepath.Join(runDir, ".automator", "deleted", "model"), []byte("deleted"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), runDir, "model"); err != nil {
		t.Fatal(err)
	}
	if err := MarkFailed(runDir, "model", "do not synthesize"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(StatePath(runDir, "model")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("deleted model recreated")
	}
	if err := os.RemoveAll(runDir); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), runDir, "model"); err == nil {
		t.Fatal("missing run accepted")
	}
	if err := SaveState(runDir, "model", State{Model: "model"}); err != nil {
		t.Fatal(err)
	}
	if err := MarkFailed(runDir, "model", "deleted"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(runDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("deleted run recreated")
	}
}

func TestWorkspaceMatchIsExact(t *testing.T) {
	root := t.TempDir()
	project := filepath.Join(root, "model")
	other := filepath.Join(root, "model-other")
	for _, dir := range []string{project, other, filepath.Join(project, "child")} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		path string
		want bool
	}{
		{project, true}, {project + string(filepath.Separator), true}, {other, false},
		{filepath.Join(project, "child"), false}, {root, false}, {"unrelated-workspace-id", false}, {"", false},
	} {
		if got := workspaceMatches(test.path, project); got != test.want {
			t.Errorf("match(%q) = %v", test.path, got)
		}
	}
	link := filepath.Join(root, "alias")
	if err := os.Symlink(project, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if !workspaceMatches(link, project) {
		t.Fatal("canonical workspace alias not matched")
	}
	if ModelLockPath(link, "key") != ModelLockPath(project, "key") {
		t.Fatal("canonical lock paths differ")
	}
	for _, dir := range []string{filepath.Join(other, "nested"), filepath.Join(other, "model")} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(filepath.Join(other, "nested"), filepath.Join(root, "indirect")); err != nil {
		t.Fatal(err)
	}
	// Lexically cleaning '..' before resolving this symlink would falsely match
	// project, although the browser belongs to the other directory's model.
	indirect := filepath.Join(root, "indirect") + string(filepath.Separator) + ".." + string(filepath.Separator) + "model"
	if workspaceMatches(indirect, project) {
		t.Fatal("symlink parent traversal matched an unrelated workspace")
	}
	if ModelLockPath(indirect, "key") != ModelLockPath(filepath.Join(other, "model"), "key") {
		t.Fatal("symlink parent traversal locked an unrelated workspace")
	}
}
