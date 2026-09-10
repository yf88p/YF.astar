package worker

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
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

func treeContents(t *testing.T, root string) map[string]string {
	t.Helper()
	contents := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		contents[rel] = entry.Type().String()
		if entry.Type().IsRegular() {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			contents[rel] += string(data)
		} else if entry.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			contents[rel] += target
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return contents
}

func noTools(t *testing.T) dependencies {
	t.Helper()
	unexpected := func() error {
		t.Error("invalid worker input reached a tool or setup hook")
		return errors.New("unexpected tool call")
	}
	return dependencies{
		build: func(config.Model, string, string, string) (adapter.Command, error) {
			return adapter.Command{}, unexpected()
		},
		resume: func(config.Model, string, string, string) (adapter.Command, error) {
			return adapter.Command{}, unexpected()
		},
		shell:   func(context.Context, string, string) (int, error) { return 0, unexpected() },
		agent:   func(context.Context, string, adapter.Command) error { return unexpected() },
		cleanup: func(context.Context, string) { _ = unexpected() },
		collect: func(context.Context, config.Model, string, string, time.Time) (adapter.Metrics, error) {
			return adapter.Metrics{}, unexpected()
		},
		recover: func(context.Context, config.Model, string, string, time.Time, string) (adapter.Metrics, error) {
			return adapter.Metrics{}, unexpected()
		},
	}
}

func TestReservedModelNamesRejectedBeforeSideEffects(t *testing.T) {
	for _, key := range []string{".automator", ".automator-locks", "run.yaml", "prompt.md", "report.md", "report.json", "report.html", "RUN.YAML", ".AUTOMATOR"} {
		t.Run(key, func(t *testing.T) {
			runDir, snapshot := fixture(t)
			snapshot.Models[key] = snapshot.Models["model"]
			writeSnapshot(t, runDir, snapshot)
			before := treeContents(t, filepath.Dir(runDir))
			for _, target := range []string{key, "model"} {
				for _, message := range []*string{nil, pointer("continue")} {
					if err := execute(context.Background(), runDir, target, message, noTools(t)); err == nil {
						t.Errorf("accepted snapshot model key %q", key)
					}
				}
			}
			if err := Run(context.Background(), runDir, key); err == nil {
				t.Fatal("public Run accepted reserved key")
			}
			if err := Continue(context.Background(), runDir, key, "continue"); err == nil {
				t.Fatal("public Continue accepted reserved key")
			}
			if _, err := LoadState(runDir, key); err == nil {
				t.Fatal("LoadState accepted reserved key")
			}
			if err := SaveState(runDir, key, State{Model: key}); err == nil {
				t.Fatal("SaveState accepted reserved key")
			}
			if err := MarkFailed(runDir, key, "failure"); err == nil {
				t.Fatal("MarkFailed accepted reserved key")
			}
			if after := treeContents(t, filepath.Dir(runDir)); !reflect.DeepEqual(before, after) {
				t.Fatal("reserved key validation changed files")
			}
		})
	}
}

func TestAdapterValidationPrecedesStateAndSetup(t *testing.T) {
	for _, test := range []struct {
		name string
		edit func(*config.RunSnapshot)
	}{
		{"unsupported argument", func(s *config.RunSnapshot) {
			model := s.Models["model"]
			model.Args = map[string]any{"unsupported": true}
			s.Models["model"] = model
		}},
		{"negative pricing", func(s *config.RunSnapshot) {
			model := s.Models["model"]
			model.Pricing = &config.ModelPricing{InputPerMillion: -1}
			s.Models["model"] = model
		}},
		{"nonfinite pricing", func(s *config.RunSnapshot) {
			model := s.Models["model"]
			model.Pricing = &config.ModelPricing{OutputPerMillion: math.Inf(1)}
			s.Models["model"] = model
		}},
		{"unsupported tool", func(s *config.RunSnapshot) {
			model := s.Models["model"]
			model.Tool = "unsupported"
			s.Models["model"] = model
		}},
		{"invalid unselected model", func(s *config.RunSnapshot) {
			model := s.Models["model"]
			model.Args = map[string]any{"unsupported": true}
			s.Models["other"] = model
		}},
		{"unsupported schema", func(s *config.RunSnapshot) { s.SchemaVersion = 2 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			runDir, snapshot := fixture(t)
			state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
			state.Status, state.NativeSessionID = Queued, pointer("existing")
			if err := SaveState(runDir, "model", state); err != nil {
				t.Fatal(err)
			}
			if err := persistence.WriteFile(CancelPath(runDir, "model"), []byte("keep stale marker"), 0o600); err != nil {
				t.Fatal(err)
			}
			test.edit(&snapshot)
			writeSnapshot(t, runDir, snapshot)
			before := treeContents(t, filepath.Dir(runDir))
			for _, message := range []*string{nil, pointer("continue")} {
				if err := execute(context.Background(), runDir, "model", message, noTools(t)); err == nil {
					t.Fatal("invalid configuration accepted")
				}
			}
			if after := treeContents(t, filepath.Dir(runDir)); !reflect.DeepEqual(before, after) {
				t.Fatal("invalid configuration changed state, markers, or lock files")
			}
			if err := os.Remove(StatePath(runDir, "model")); err != nil {
				t.Fatal(err)
			}
			before = treeContents(t, filepath.Dir(runDir))
			if err := MarkFailed(runDir, "model", "invalid launch"); err == nil {
				t.Fatal("synthesized state from invalid configuration")
			}
			if after := treeContents(t, filepath.Dir(runDir)); !reflect.DeepEqual(before, after) {
				t.Fatal("invalid failure synthesis changed files")
			}
		})
	}
}

func TestDirectWorkerRejectsSymlinkPaths(t *testing.T) {
	for _, name := range []string{
		"project", "dangling project", "metadata", "state directory", "cancel directory", "deleted directory", "retry directory",
		"snapshot", "prompt", "state", "cancel", "deleted", "lock directory", "run lock", "model lock", "lifetime lock", "git metadata",
	} {
		t.Run(name, func(t *testing.T) {
			runDir, snapshot := fixture(t)
			paths := map[string]string{
				"project": filepath.Join(runDir, "model"), "dangling project": filepath.Join(runDir, "model"),
				"metadata": filepath.Join(runDir, ".automator"), "state directory": filepath.Join(runDir, ".automator", "state"),
				"cancel directory": filepath.Join(runDir, ".automator", "cancel"), "deleted directory": filepath.Join(runDir, ".automator", "deleted"),
				"retry directory": filepath.Join(runDir, ".automator", "retry-backups"),
				"snapshot":        filepath.Join(runDir, "run.yaml"), "prompt": filepath.Join(runDir, "prompt.md"),
				"state": StatePath(runDir, "model"), "cancel": CancelPath(runDir, "model"), "deleted": filepath.Join(runDir, ".automator", "deleted", "model"),
				"lock directory": filepath.Dir(RunLockPath(runDir)), "run lock": RunLockPath(runDir),
				"model lock": ModelLockPath(runDir, "model"), "lifetime lock": LifetimeLockPath(runDir, "model"),
				"git metadata": filepath.Join(runDir, "model", ".git"),
			}
			outside := t.TempDir()
			target := filepath.Join(outside, "target")
			if name == "project" || name == "metadata" || strings.Contains(name, "directory") {
				if err := os.Mkdir(target, 0o700); err != nil {
					t.Fatal(err)
				}
			} else if name != "dangling project" {
				if err := os.WriteFile(target, []byte("outside sentinel"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			path := paths[name]
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if name == "snapshot" {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.Symlink(target, path); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
			before, outsideBefore := treeContents(t, filepath.Dir(runDir)), treeContents(t, outside)
			state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
			state.Status = Queued
			for operation, err := range map[string]error{
				"run":      execute(context.Background(), runDir, "model", nil, noTools(t)),
				"continue": execute(context.Background(), runDir, "model", pointer("continue"), noTools(t)),
				"save":     SaveState(runDir, "model", state), "mark failed": MarkFailed(runDir, "model", "failure"),
			} {
				if err == nil || !strings.Contains(err.Error(), "symlink") {
					t.Errorf("%s did not reject symlink: %v", operation, err)
				}
			}
			if _, err := LoadState(runDir, "model"); err == nil || !strings.Contains(err.Error(), "symlink") {
				t.Errorf("load did not reject symlink: %v", err)
			}
			if !reflect.DeepEqual(before, treeContents(t, filepath.Dir(runDir))) || !reflect.DeepEqual(outsideBefore, treeContents(t, outside)) {
				t.Fatal("symlink validation modified the run or outside target")
			}
		})
	}
}

func TestWorkerAcceptsTrustedRootSymlinks(t *testing.T) {
	for _, ancestor := range []bool{false, true} {
		t.Run(fmt.Sprint(ancestor), func(t *testing.T) {
			runDir, snapshot := fixture(t)
			alias := filepath.Join(t.TempDir(), "trusted")
			target := runDir
			if ancestor {
				target = filepath.Dir(runDir)
			}
			if err := os.Symlink(target, alias); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
			if ancestor {
				alias = filepath.Join(alias, filepath.Base(runDir))
			}
			state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
			state.Status = Queued
			if err := SaveState(alias, "model", state); err != nil {
				t.Fatal(err)
			}
			if err := execute(context.Background(), alias, "model", nil, isolatedDependencies()); err != nil {
				t.Fatal(err)
			}
			got, err := LoadState(alias, "model")
			if err != nil || got.Status != Done {
				t.Fatalf("trusted alias failed: %+v %v", got, err)
			}
			if LifetimeLockPath(alias, "model") != LifetimeLockPath(runDir, "model") {
				t.Fatal("trusted alias uses a different lifetime lock")
			}
		})
	}
}

func TestSetupCannotRedirectLaterExecution(t *testing.T) {
	runDir, _ := fixture(t)
	outside := t.TempDir()
	probe := filepath.Join(t.TempDir(), "probe")
	if err := os.Symlink(outside, probe); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	deps := noTools(t)
	deps.shell = func(_ context.Context, project, shell string) (int, error) {
		if shell != "template" {
			t.Errorf("executed later hook through replaced project: %s", shell)
		}
		if err := os.Rename(project, project+"-old"); err != nil {
			return 0, err
		}
		return 0, os.Symlink(outside, project)
	}
	if err := execute(context.Background(), runDir, "model", nil, deps); err == nil {
		t.Fatal("project replacement accepted")
	}
	if entries, err := os.ReadDir(outside); err != nil || len(entries) != 0 {
		t.Fatalf("outside project modified: %v %v", entries, err)
	}
}

func TestPersistedHerdrIDsSurviveWorkerLaunch(t *testing.T) {
	for _, resume := range []bool{false, true} {
		for _, envTab := range []string{"", "new-tab"} {
			t.Run(fmt.Sprintf("continue=%v/tab=%s", resume, envTab), func(t *testing.T) {
				runDir, snapshot := fixture(t)
				snapshot.Mode, snapshot.HerdrWorkspaceID = config.Headful, pointer("snapshot-workspace")
				writeSnapshot(t, runDir, snapshot)
				state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
				state.Status, state.NativeSessionID = Running, pointer("existing-session")
				state.HerdrWorkspaceID, state.HerdrTabID, state.HerdrPaneID = pointer("persisted-workspace"), pointer("persisted-tab"), pointer("persisted-pane")
				if err := SaveState(runDir, "model", state); err != nil {
					t.Fatal(err)
				}
				t.Setenv("HERDR_WORKSPACE_ID", "")
				t.Setenv("HERDR_TAB_ID", envTab)
				t.Setenv("HERDR_PANE_ID", "")
				var message *string
				if resume {
					message = pointer("continue")
				}
				if err := execute(context.Background(), runDir, "model", message, isolatedDependencies()); err != nil {
					t.Fatal(err)
				}
				got, err := LoadState(runDir, "model")
				if err != nil {
					t.Fatal(err)
				}
				wantTab := "persisted-tab"
				if envTab != "" {
					wantTab = envTab
				}
				if got.HerdrWorkspaceID == nil || *got.HerdrWorkspaceID != "persisted-workspace" || got.HerdrTabID == nil || *got.HerdrTabID != wantTab || got.HerdrPaneID == nil || *got.HerdrPaneID != "persisted-pane" {
					t.Fatalf("durable IDs lost: %+v", got)
				}
			})
		}
	}
}

func TestStateRequiredFieldsAndNullableCompatibility(t *testing.T) {
	minimal := map[string]any{
		"model": "model", "provider": "provider", "tool": "opencode", "status": "done", "project_path": "project", "native_reopen": "reopen",
	}
	for name := range minimal {
		for _, missing := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/missing=%v", name, missing), func(t *testing.T) {
				runDir, _ := fixture(t)
				fields := make(map[string]any)
				for key, value := range minimal {
					fields[key] = value
				}
				fields[name] = nil
				if missing {
					delete(fields, name)
				}
				if err := persistence.SaveYAML(StatePath(runDir, "model"), fields); err != nil {
					t.Fatal(err)
				}
				if _, err := LoadState(runDir, "model"); err == nil || !strings.Contains(err.Error(), name) {
					t.Fatalf("required field not checked: %v", err)
				}
			})
		}
	}
	runDir, _ := fixture(t)
	minimal["future_field"] = "ignored"
	minimal["input_tokens"], minimal["herdr_pane_id"] = nil, nil
	if err := persistence.SaveYAML(StatePath(runDir, "model"), minimal); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(runDir, "model")
	if err != nil || state.Status != Done || state.StartedAt != nil || state.InputTokens != nil || state.HerdrPaneID != nil {
		t.Fatalf("legacy nullable state rejected: %+v %v", state, err)
	}
}

func TestErrorsAreRedactedWithoutChangingScripts(t *testing.T) {
	for _, phase := range []string{"template", "pre", "post", "agent", "cancelled agent"} {
		t.Run(phase, func(t *testing.T) {
			runDir, snapshot := fixture(t)
			snapshot.Template.Steps[0].Shell = "API_KEY='template secret'; template"
			snapshot.Pre[0].Shell = "API_TOKEN=pre-secret pre"
			snapshot.PostEach[0].Shell = "PASSWORD=\"post secret\" post"
			snapshot.Prompt = "SECRET=prompt-secret"
			writeSnapshot(t, runDir, snapshot)
			before, err := os.ReadFile(filepath.Join(runDir, "run.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			deps := isolatedDependencies()
			deps.shell = func(_ context.Context, _, shell string) (int, error) {
				if strings.HasSuffix(shell, phase) {
					return 7, nil
				}
				return 0, nil
			}
			sentinel := errors.New("agent failed")
			if phase == "cancelled agent" {
				sentinel = context.Canceled
			}
			if strings.Contains(phase, "agent") {
				deps.agent = func(context.Context, string, adapter.Command) error {
					return fmt.Errorf("SECRET='agent secret': %w", sentinel)
				}
			}
			err = execute(context.Background(), runDir, "model", nil, deps)
			if err == nil {
				t.Fatal("failure not reported")
			}
			if strings.Contains(phase, "agent") && !errors.Is(err, sentinel) {
				t.Fatal("redaction lost the original error identity")
			}
			state, loadErr := LoadState(runDir, "model")
			if loadErr != nil || state.Error == nil {
				t.Fatalf("missing failure state: %+v %v", state, loadErr)
			}
			for _, text := range []string{err.Error(), *state.Error} {
				for _, secret := range []string{"template secret", "pre-secret", "post secret", "agent secret"} {
					if strings.Contains(text, secret) {
						t.Errorf("error leaked %q: %s", secret, text)
					}
				}
				if !strings.Contains(text, "<redacted>") {
					t.Errorf("missing redaction: %s", text)
				}
			}
			after, err := os.ReadFile(filepath.Join(runDir, "run.yaml"))
			if err != nil || string(before) != string(after) {
				t.Fatal("error redaction altered the intentionally persisted scripts/prompt")
			}
		})
	}
}

func TestSaveStateAndMarkFailedRedactMessages(t *testing.T) {
	runDir, snapshot := fixture(t)
	state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
	state.Status, state.Error = Queued, pointer("API_KEY='save secret'")
	if err := SaveState(runDir, "model", state); err != nil {
		t.Fatal(err)
	}
	got, err := LoadState(runDir, "model")
	if err != nil || got.Error == nil || strings.Contains(*got.Error, "save secret") {
		t.Fatalf("SaveState leaked secret: %+v %v", got, err)
	}
	if *state.Error != "API_KEY='save secret'" {
		t.Fatal("SaveState mutated its caller's error pointer")
	}
	if err := MarkFailed(runDir, "model", "PRIVATE_KEY='launch secret'"); err != nil {
		t.Fatal(err)
	}
	got, err = LoadState(runDir, "model")
	if err != nil || got.Error == nil || *got.Error != "PRIVATE_KEY=<redacted>" {
		t.Fatalf("MarkFailed leaked secret: %+v %v", got, err)
	}
}

func TestExportedLifetimeLockRejectsWorkersAndFailureSynthesis(t *testing.T) {
	runDir, snapshot := fixture(t)
	state := initialState(runDir, "model", snapshot.Models["model"], snapshot, false)
	state.Status = Running
	if err := SaveState(runDir, "model", state); err != nil {
		t.Fatal(err)
	}
	unlock, err := persistence.TryLock(LifetimeLockPath(runDir, "model"))
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if err := execute(context.Background(), runDir, "model", nil, noTools(t)); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("exported lock did not exclude worker: %v", err)
	}
	if err := MarkFailed(runDir, "model", "duplicate launch"); err != nil {
		t.Fatal(err)
	}
	got, err := LoadState(runDir, "model")
	if err != nil || !reflect.DeepEqual(state, got) {
		t.Fatalf("exported lock did not exclude MarkFailed: %+v %v", got, err)
	}
}
