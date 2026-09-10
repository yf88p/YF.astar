package herdr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"automator/internal/util"
	"automator/internal/worker"
)

func jsonText(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestAutomatorCommandsStripCallerRouting(t *testing.T) {
	f := newFake(t)
	for key, value := range map[string]string{
		"HERDR_SOCKET_PATH": filepath.Join(f.root, "foreign.sock"),
		"HERDR_ENV":         "1", "HERDR_WORKSPACE_ID": "foreign-workspace",
		"HERDR_TAB_ID": "foreign-tab", "HERDR_PANE_ID": "foreign-pane", "HERDR_SESSION": "foreign-session",
	} {
		t.Setenv(key, value)
	}
	snapshot := f.snapshot("model")
	t.Setenv("AUTOMATOR_HERDR_TEST_STATE", worker.StatePath(snapshot.RunDir, "model"))
	f.plan.Ready, f.plan.StartReady = false, true
	f.savePlan()
	ctx := context.Background()
	if err := CreateTabs(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := Dispatch(ctx, snapshot, "model", "continue-worker", "go"); err != nil {
		t.Fatal(err)
	}
	if err := Attach(ctx, snapshot, "model"); err != nil {
		t.Fatal(err)
	}
	if err := SendInterrupt(ctx, *loadState(t, snapshot, "model").HerdrPaneID); err != nil {
		t.Fatal(err)
	}
	calls := f.calls() // Also asserts routing, shell and all isolated directories.
	for _, call := range calls {
		if call.Env["AUTOMATOR_HERDR_TEST_ROOT"] != f.root || call.State == nil {
			t.Fatalf("fixture environment stripped: %#v", call)
		}
	}
	if len(callsWith(calls, "server")) != 1 || len(callsWith(calls, "session", "attach")) != 1 {
		t.Fatal("startup and interactive routing were not exercised")
	}
	if os.Getenv("HERDR_PANE_ID") != "foreign-pane" {
		t.Fatal("caller environment was mutated")
	}
}

func TestDispatchRejectsForeignOrMissingWorkspaceState(t *testing.T) {
	for _, workspaceID := range []*string{nil, ptr("foreign-workspace")} {
		for _, subcommand := range []string{"worker", "continue-worker"} {
			t.Run(subcommand+"/"+valueOrMissing(workspaceID), func(t *testing.T) {
				f := newFake(t)
				snapshot := f.snapshot("model")
				if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
					t.Fatal(err)
				}
				state := loadState(t, snapshot, "model")
				state.HerdrWorkspaceID, state.HerdrTabID, state.HerdrPaneID = workspaceID, ptr("foreign-tab"), ptr("foreign-pane")
				if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
					t.Fatal(err)
				}
				if err := Dispatch(context.Background(), snapshot, "model", subcommand, "go"); err != nil {
					t.Fatal(err)
				}
				for _, call := range f.calls() {
					for _, arg := range call.Args {
						if arg == "foreign-tab" || arg == "foreign-pane" {
							t.Fatalf("used foreign target: %#v", call)
						}
					}
				}
				if state := loadState(t, snapshot, "model"); *state.HerdrWorkspaceID != *snapshot.HerdrWorkspaceID || *state.HerdrPaneID == "foreign-pane" {
					t.Fatalf("foreign state not replaced: %#v", state)
				}
			})
		}
	}
}

func valueOrMissing(value *string) string {
	if value == nil {
		return "missing"
	}
	return *value
}

func TestRestartedWorkspaceDoesNotReuseOldTabs(t *testing.T) {
	for _, newID := range []string{"new-workspace", "w1"} {
		t.Run(newID, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot("model")
			snapshot.HerdrWorkspaceID, snapshot.HerdrRootTabID, snapshot.HerdrRootPaneID = ptr("w1"), ptr("old-root-tab"), ptr("old-root-pane")
			state := loadState(t, snapshot, "model")
			state.HerdrWorkspaceID, state.HerdrTabID, state.HerdrPaneID = ptr("w1"), ptr("old-tab"), ptr("old-pane")
			if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
				t.Fatal(err)
			}
			f.plan.Workspaces = `{"result":{"workspaces":[]}}`
			f.plan.Workspace = jsonText(t, map[string]any{"result": map[string]any{
				"workspace": map[string]any{"workspace_id": newID},
				"tab":       map[string]any{"tab_id": "new-root-tab"}, "root_pane": map[string]any{"pane_id": "new-root-pane"},
			}})
			f.savePlan()
			if err := Dispatch(context.Background(), snapshot, "model", "continue-worker", "go"); err != nil {
				t.Fatal(err)
			}
			calls := f.calls()
			if len(callsWith(calls, "tab", "rename", "old-tab")) != 0 || len(callsWith(calls, "pane", "run", "old-pane")) != 0 {
				t.Fatalf("restarted server received stale target: %#v", calls)
			}
			state = loadState(t, snapshot, "model")
			if *state.HerdrWorkspaceID != newID || *state.HerdrPaneID == "old-pane" {
				t.Fatalf("workspace replacement not recorded: %#v", state)
			}
		})
	}
}

func TestWorkspaceIdentityMetadata(t *testing.T) {
	for _, scenario := range []string{"minimal", "matching", "subdirectory", "symlink", "foreign-label", "foreign-cwd", "foreign-directory", "prefix-collision"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot()
			snapshot.HerdrWorkspaceID, snapshot.HerdrRootTabID, snapshot.HerdrRootPaneID = ptr("w1"), ptr("t1"), ptr("p1")
			info := map[string]any{"workspace_id": "w1"}
			mismatch := false
			switch scenario {
			case "matching":
				info["label"], info["cwd"], info["directory"] = snapshot.Name, snapshot.RunDir, snapshot.RunDir+"/./"
			case "subdirectory":
				info["cwd"] = filepath.Join(snapshot.RunDir, "model", "src")
			case "symlink":
				alias := filepath.Join(f.root, "run-alias")
				if err := os.Symlink(snapshot.RunDir, alias); err != nil {
					t.Fatal(err)
				}
				info["directory"] = alias
			case "foreign-label":
				info["label"], mismatch = "unrelated run", true
			case "foreign-cwd":
				info["cwd"], mismatch = filepath.Join(f.root, "unrelated run"), true
			case "foreign-directory":
				info["directory"], mismatch = filepath.Join(f.root, "unrelated run"), true
			case "prefix-collision":
				info["cwd"], mismatch = snapshot.RunDir+"-other", true
			}
			f.plan.Workspaces = jsonText(t, map[string]any{"result": map[string]any{"workspaces": []any{info}}})
			f.plan.Workspace = `{"result":{"workspace":{"workspace_id":"new-workspace"},"tab":{"tab_id":"new-tab"},"root_pane":{"pane_id":"new-pane"}}}`
			f.savePlan()
			if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
				t.Fatal(err)
			}
			created := len(callsWith(f.calls(), "workspace", "create")) == 1
			if created != mismatch {
				t.Fatalf("workspace recreation = %v, want %v", created, mismatch)
			}
		})
	}
}

func TestTabAndPaneIdentityBeforeDispatch(t *testing.T) {
	for _, embedded := range []bool{false, true} {
		for _, scenario := range []string{"matching", "tab-workspace", "tab-label", "pane-workspace", "pane-tab", "pane-cwd", "pane-prefix", "missing-tab", "missing-pane"} {
			t.Run(fmt.Sprintf("%s/embedded=%t", scenario, embedded), func(t *testing.T) {
				f := newFake(t)
				snapshot := f.snapshot("model")
				if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
					t.Fatal(err)
				}
				state := loadState(t, snapshot, "model")
				state.HerdrWorkspaceID, state.HerdrTabID, state.HerdrPaneID = ptr("w1"), ptr("old-tab"), ptr("old-pane")
				if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
					t.Fatal(err)
				}
				tabInfo := map[string]any{"tab_id": "old-tab", "workspace_id": "w1", "label": "model"}
				paneInfo := map[string]any{"pane_id": "old-pane", "workspace_id": "w1", "tab_id": "old-tab", "cwd": filepath.Join(snapshot.RunDir, "model", "src")}
				switch scenario {
				case "tab-workspace":
					tabInfo["workspace_id"] = "foreign"
				case "tab-label":
					tabInfo["label"] = "another-model"
				case "pane-workspace":
					paneInfo["workspace_id"] = "foreign"
				case "pane-tab":
					paneInfo["tab_id"] = "foreign-tab"
				case "pane-cwd":
					paneInfo["cwd"] = filepath.Join(snapshot.RunDir, "other-model")
				case "pane-prefix":
					paneInfo["cwd"] = filepath.Join(snapshot.RunDir, "model-other")
				case "missing-tab":
					tabInfo["tab_id"] = "other-tab"
				case "missing-pane":
					paneInfo["pane_id"] = "other-pane"
				}
				workspace := map[string]any{"workspace_id": "w1", "label": snapshot.Name, "cwd": snapshot.RunDir}
				if embedded {
					workspace["tabs"], workspace["panes"] = []any{tabInfo}, []any{paneInfo}
				} else {
					f.plan.TabGet = jsonText(t, map[string]any{"result": map[string]any{"tab": tabInfo}})
					f.plan.PaneGet = jsonText(t, map[string]any{"result": map[string]any{"pane": paneInfo}})
				}
				f.plan.Workspaces = jsonText(t, map[string]any{"result": map[string]any{"workspaces": []any{workspace}}})
				f.savePlan()
				if err := Dispatch(context.Background(), snapshot, "model", "worker", ""); err != nil {
					t.Fatal(err)
				}
				calls := f.calls()
				oldRuns, renames := callsWith(calls, "pane", "run", "old-pane"), callsWith(calls, "tab", "rename", "old-tab")
				if scenario == "matching" {
					if len(oldRuns) != 1 || len(renames) != 1 {
						t.Fatal("matching target was not reused")
					}
				} else if len(oldRuns) != 0 || len(renames) != 0 || len(callsWith(calls, "tab", "create")) != 1 {
					t.Fatalf("identity mismatch used stale target: %#v", calls)
				}
				if embedded && (len(callsWith(calls, "tab", "get")) != 0 || len(callsWith(calls, "pane", "get")) != 0) {
					t.Fatal("queried metadata already available in workspace list")
				}
			})
		}
	}
}

func TestRootPaneMetadataDoesNotPermitSiblingModel(t *testing.T) {
	for _, cwd := range []string{"", "model", "sibling"} {
		t.Run("cwd-"+cwd, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot("model")
			if err := CreateTabs(context.Background(), snapshot); err != nil {
				t.Fatal(err)
			}
			pane := map[string]any{"pane_id": "p1", "tab_id": "t1", "workspace_id": "w1", "cwd": filepath.Join(snapshot.RunDir, cwd)}
			workspace := map[string]any{"workspace_id": "w1", "label": snapshot.Name, "tabs": []any{
				map[string]any{"tab_id": "t1", "workspace_id": "w1", "label": "model", "root_pane": pane},
			}}
			f.plan.Workspaces = jsonText(t, map[string]any{"workspaces": []any{workspace}})
			f.savePlan()
			before := len(f.calls())
			if err := Dispatch(context.Background(), snapshot, "model", "worker", ""); err != nil {
				t.Fatal(err)
			}
			calls := f.calls()[before:]
			if reused := len(callsWith(calls, "pane", "run", "p1")) == 1; reused != (cwd != "sibling") {
				t.Fatalf("root reuse = %v for %q", reused, cwd)
			}
			if len(callsWith(calls, "pane", "get")) != 0 {
				t.Fatal("queried embedded root pane metadata")
			}
		})
	}
}

func TestTargetLookupFailures(t *testing.T) {
	for _, scenario := range []string{"missing-tab", "missing-pane", "unsupported", "transport", "foreign-session"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot("model")
			if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
				t.Fatal(err)
			}
			state := loadState(t, snapshot, "model")
			state.HerdrWorkspaceID, state.HerdrTabID, state.HerdrPaneID = ptr("w1"), ptr("old-tab"), ptr("old-pane")
			if scenario == "foreign-session" {
				state.HerdrSession = ptr("foreign-session")
			}
			if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
				t.Fatal(err)
			}
			f.plan.Workspaces = jsonText(t, map[string]any{"workspaces": []any{map[string]any{"workspace_id": "w1", "label": snapshot.Name}}})
			f.plan.TabGet = `{"result":{"tab":{"tab_id":"old-tab","workspace_id":"w1","label":"model"}}}`
			f.plan.PaneGet = `{"result":{"pane":{"pane_id":"old-pane","workspace_id":"w1","tab_id":"old-tab"}}}`
			switch scenario {
			case "missing-tab":
				f.plan.Failures = map[string]string{"tab get": "tab not found"}
			case "missing-pane":
				f.plan.Failures = map[string]string{"pane get": "unknown pane"}
			case "unsupported":
				f.plan.Failures = map[string]string{"tab get": "unknown command 'get'", "pane get": "unrecognized subcommand 'get'"}
			case "transport":
				f.plan.Failures = map[string]string{"tab get": "server disconnected"}
			}
			f.savePlan()
			err := Dispatch(context.Background(), snapshot, "model", "continue-worker", "go")
			calls := f.calls()
			if scenario == "transport" {
				if err == nil || !strings.Contains(err.Error(), "verify Herdr tab target") || len(callsWith(calls, "pane", "run")) != 0 || len(callsWith(calls, "tab", "rename")) != 0 {
					t.Fatalf("unsafe verification failure: %v, %#v", err, calls)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if reused := len(callsWith(calls, "pane", "run", "old-pane")) == 1; reused != (scenario == "unsupported") {
				t.Fatalf("old target reuse = %v, calls %#v", reused, calls)
			}
		})
	}
}

func TestDispatchErrorsRedactBeforePersistence(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	if err := CreateTabs(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	message := "private continuation's \"contents\"\nnext private line"
	f.plan.Failures = map[string]string{
		"pane run":   "stale pane; message: " + message + " API_KEY=stderr-key PASSWORD='secret phrase'",
		"tab create": "replacement failed TOKEN=another-secret",
	}
	f.plan.EchoFailedArgs = true
	f.savePlan()
	err := Dispatch(context.Background(), snapshot, "model", "continue-worker", message)
	if err == nil {
		t.Fatal("expected dispatch failure")
	}
	state := loadState(t, snapshot, "model")
	if state.Status != worker.Failed || state.Error == nil {
		t.Fatalf("failure not persisted: %#v", state)
	}
	for _, text := range []string{err.Error(), *state.Error} {
		for _, secret := range []string{message, util.ShellQuote(message), "private continuation", "next private line", "stderr-key", "secret phrase", "another-secret", "report-refresh --run"} {
			if strings.Contains(text, secret) {
				t.Fatalf("secret/payload leaked in failure: %s", text)
			}
		}
		for _, context := range []string{"stale pane", "replacement failed", "herdr pane run p1", "redacted"} {
			if !strings.Contains(text, context) {
				t.Fatalf("missing useful context %q: %s", context, text)
			}
		}
	}
	runs := callsWith(f.calls(), "pane", "run")
	if !strings.Contains(runs[len(runs)-1].Args[3], util.ShellQuote(message)) {
		t.Fatal("redaction changed dispatched command")
	}
}

func TestCommandFailuresRedactAssignments(t *testing.T) {
	f := newFake(t)
	f.plan.Failures = map[string]string{"pane send-keys": "failed API_KEY=private-value"}
	f.savePlan()
	err := SendInterrupt(context.Background(), "pane-TOKEN=private-id")
	if err == nil || strings.Contains(err.Error(), "private-value") || strings.Contains(err.Error(), "private-id") {
		t.Fatalf("unsafe command error: %v", err)
	}
	wrapped := redactError(errors.Join(context.Canceled, errors.New("PASSWORD=private")))
	if !errors.Is(wrapped, context.Canceled) || strings.Contains(wrapped.Error(), "private") {
		t.Fatalf("redaction lost cancellation or retained secret: %v", wrapped)
	}
}
