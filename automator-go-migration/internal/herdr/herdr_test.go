package herdr

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/util"
	"automator/internal/worker"
)

// The fake is this test executable, never the installed Herdr. Its PATH contains
// only these test-owned executables, and it never executes pane commands.
func TestMain(m *testing.M) {
	if os.Getenv("AUTOMATOR_HERDR_TEST_ROOT") != "" {
		switch filepath.Base(os.Args[0]) {
		case "herdr", "fake shell's name":
			os.Exit(fakeMain())
		}
		if len(os.Args) > 1 {
			switch os.Args[1] {
			case "worker", "continue-worker", "worker-failed", "report-refresh":
				os.Exit(fakeMain())
			}
		}
	}
	os.Exit(m.Run())
}

type fakePlan struct {
	Ready           bool
	StartReady      bool
	BreakExecutable bool
	Workspace       string
	Workspaces      string
	Tab             string
	TabGet          string
	PaneGet         string
	Failures        map[string]string
	EchoFailedArgs  bool
	WorkerExit      int
	Block           string
}

type fakeCall struct {
	Program string
	Args    []string
	Env     map[string]string
	State   *worker.State
}

func fakeMain() int {
	root := os.Getenv("AUTOMATOR_HERDR_TEST_ROOT")
	data, err := os.ReadFile(filepath.Join(root, "plan.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 91
	}
	var plan fakePlan
	if err := json.Unmarshal(data, &plan); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 92
	}
	call := fakeCall{Program: filepath.Base(os.Args[0]), Args: os.Args[1:], Env: map[string]string{}}
	for _, key := range []string{"HERDR_SESSION", "HERDR_SOCKET_PATH", "HERDR_ENV", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID", "HERDR_PANE_ID", "SHELL", "HOME", "AUTOMATOR_HOME", "XDG_RUNTIME_DIR", "PATH", "AUTOMATOR_HERDR_TEST_ROOT"} {
		call.Env[key] = os.Getenv(key)
	}
	if path := os.Getenv("AUTOMATOR_HERDR_TEST_STATE"); path != "" {
		var state worker.State
		if persistence.LoadYAML(path, &state) == nil {
			call.State = &state
		}
	}
	log, err := os.OpenFile(filepath.Join(root, "calls.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return 93
	}
	encoded, _ := json.Marshal(call)
	_, err = log.Write(append(encoded, '\n'))
	_ = log.Close()
	if err != nil {
		return 94
	}
	args := call.Args
	if plan.Block != "" && strings.HasPrefix(strings.Join(args, " "), plan.Block) {
		time.Sleep(30 * time.Second)
		return 98
	}
	for n := len(args); n > 0; n-- {
		if message, ok := plan.Failures[strings.Join(args[:n], " ")]; ok {
			fmt.Fprintln(os.Stderr, message)
			if plan.EchoFailedArgs {
				fmt.Fprintln(os.Stderr, strings.Join(args, " "))
				encoded, _ := json.Marshal(strings.Join(args, " "))
				fmt.Fprintln(os.Stderr, string(encoded))
			}
			return 23
		}
	}
	if call.Program != "herdr" {
		if len(args) > 0 && (args[0] == "worker" || args[0] == "continue-worker") {
			return plan.WorkerExit
		}
		return 0
	}
	if len(args) == 1 && args[0] == "server" {
		fmt.Fprintln(os.Stdout, "fake server stdout")
		fmt.Fprintln(os.Stderr, "fake server stderr")
		if plan.StartReady {
			if os.WriteFile(filepath.Join(root, "ready"), nil, 0o600) != nil {
				return 95
			}
		}
		return 0
	}
	if len(args) < 2 {
		return 96
	}
	switch strings.Join(args[:2], " ") {
	case "status server":
		if plan.BreakExecutable {
			executable := filepath.Join(root, "bin", "herdr")
			_ = os.Remove(executable)
			_ = os.WriteFile(executable, []byte("#!/nonexistent-fake-interpreter\n"), 0o700)
		}
		if _, err := os.Stat(filepath.Join(root, "ready")); plan.Ready || err == nil {
			return 0
		}
		return 1
	case "workspace create":
		if plan.Workspace == "" {
			data, _ := os.ReadFile(filepath.Join(root, "calls.jsonl"))
			n := strings.Count(string(data), `"Args":["workspace","create"`)
			plan.Workspace = fmt.Sprintf(`{"result":{"workspace":{"workspace_id":"w%d"},"tab":{"tab_id":"t%d"},"root_pane":{"pane_id":"p%d"}}}`, n, n, n)
		}
		fmt.Fprintln(os.Stdout, plan.Workspace)
	case "workspace list":
		if plan.Workspaces == "" {
			plan.Workspaces = `{"result":{"workspaces":[{"workspace_id":"w1"}]}}`
		}
		fmt.Fprintln(os.Stdout, plan.Workspaces)
	case "tab create":
		if plan.Tab == "" {
			data, _ := os.ReadFile(filepath.Join(root, "calls.jsonl"))
			n := 1 + strings.Count(string(data), `"Args":["tab","create"`)
			plan.Tab = fmt.Sprintf(`{"result":{"tab":{"tab_id":"t%d"},"root_pane":{"pane_id":"p%d"}}}`, n, n)
		}
		fmt.Fprintln(os.Stdout, plan.Tab)
	case "tab get":
		if plan.TabGet == "" {
			fmt.Fprintln(os.Stderr, "unexpected fake Herdr tab get")
			return 97
		}
		fmt.Fprintln(os.Stdout, plan.TabGet)
	case "pane get":
		if plan.PaneGet == "" {
			fmt.Fprintln(os.Stderr, "unexpected fake Herdr pane get")
			return 97
		}
		fmt.Fprintln(os.Stdout, plan.PaneGet)
	case "tab rename", "pane run", "workspace focus", "tab focus", "session attach", "pane send-keys":
	default:
		fmt.Fprintln(os.Stderr, "unexpected fake command:", args)
		return 97
	}
	return 0
}

type fakeHerdr struct {
	t     *testing.T
	root  string
	bin   string
	shell string
	plan  fakePlan
}

func newFake(t *testing.T) *fakeHerdr {
	t.Helper()
	root := t.TempDir()
	f := &fakeHerdr{t: t, root: root, bin: filepath.Join(root, "bin"), plan: fakePlan{Ready: true}}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(key, "HERDR_") || strings.HasPrefix(key, "AUTOMATOR_HERDR_TEST_") || key == "ENV" || key == "BASH_ENV" {
			t.Setenv(key, "")
		}
	}
	for key, dir := range map[string]string{
		"HOME": "home", "AUTOMATOR_HOME": "automator-home", "XDG_CONFIG_HOME": "config",
		"XDG_DATA_HOME": "data", "XDG_CACHE_HOME": "cache", "XDG_RUNTIME_DIR": "runtime",
		"TMPDIR": "tmp", "ZDOTDIR": "zsh", "PATH": "bin",
	} {
		path := filepath.Join(root, dir)
		if err := os.MkdirAll(path, 0o700); err != nil {
			t.Fatal(err)
		}
		t.Setenv(key, path)
	}
	t.Setenv("HERDR_SESSION", "inherited-session-must-not-be-used")
	t.Setenv("AUTOMATOR_HERDR_TEST_ROOT", root)
	t.Setenv("GORACE", "atexit_sleep_ms=0")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	f.shell = filepath.Join(f.bin, "fake shell's name")
	for _, target := range []string{filepath.Join(f.bin, "herdr"), f.shell} {
		if err := os.Symlink(exe, target); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("SHELL", f.shell)
	f.savePlan()
	return f
}

func (f *fakeHerdr) savePlan() {
	f.t.Helper()
	data, err := json.Marshal(f.plan)
	if err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.root, "plan.json"), data, 0o600); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fakeHerdr) calls() []fakeCall {
	f.t.Helper()
	data, err := os.ReadFile(filepath.Join(f.root, "calls.jsonl"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		f.t.Fatal(err)
	}
	var calls []fakeCall
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var call fakeCall
		if err := json.Unmarshal([]byte(line), &call); err != nil {
			f.t.Fatal(err)
		}
		if call.Program == "herdr" {
			if call.Env["HERDR_SESSION"] != session || call.Env["SHELL"] != f.shell {
				f.t.Fatalf("wrong Herdr session/shell: %#v", call)
			}
			for _, key := range []string{"HERDR_SOCKET_PATH", "HERDR_ENV", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID", "HERDR_PANE_ID"} {
				if call.Env[key] != "" {
					f.t.Fatalf("inherited live Herdr environment: %s=%s", key, call.Env[key])
				}
			}
			for _, key := range []string{"HOME", "AUTOMATOR_HOME", "XDG_RUNTIME_DIR", "PATH"} {
				if !strings.HasPrefix(call.Env[key], f.root+string(os.PathSeparator)) {
					f.t.Fatalf("nonisolated %s: %s", key, call.Env[key])
				}
			}
		}
		calls = append(calls, call)
	}
	return calls
}

func (f *fakeHerdr) snapshot(keys ...string) *config.RunSnapshot {
	f.t.Helper()
	dir := filepath.Join(f.root, "run's folder")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		f.t.Fatal(err)
	}
	snapshot := &config.RunSnapshot{
		SchemaVersion: 1, Name: "run's name", RunDir: dir, HerdrSession: session, Mode: config.Headful,
		Models: map[string]config.Model{},
	}
	for _, key := range keys {
		snapshot.Models[key] = config.Model{Tool: config.Pi}
		state := worker.State{Model: key, Status: worker.Paused, ProjectPath: filepath.Join(dir, key)}
		if err := worker.SaveState(dir, key, state); err != nil {
			f.t.Fatal(err)
		}
	}
	if err := persistence.SaveYAML(filepath.Join(dir, "run.yaml"), snapshot); err != nil {
		f.t.Fatal(err)
	}
	return snapshot
}

func callsWith(calls []fakeCall, prefix ...string) []fakeCall {
	var matches []fakeCall
	for _, call := range calls {
		if len(call.Args) >= len(prefix) && reflect.DeepEqual(call.Args[:len(prefix)], prefix) {
			matches = append(matches, call)
		}
	}
	return matches
}

func loadState(t *testing.T, snapshot *config.RunSnapshot, key string) worker.State {
	t.Helper()
	state, err := worker.LoadState(snapshot.RunDir, key)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func ptr[T any](value T) *T { return &value }

func TestEnsureWorkspacePersistsAndReusesIDs(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	snapshot.HerdrSession = "old session"
	snapshot.HerdrWorkspaceLabel = "custom workspace's label"
	if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	var saved config.RunSnapshot
	if err := persistence.LoadYAML(filepath.Join(snapshot.RunDir, "run.yaml"), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.HerdrWorkspaceID == nil || *saved.HerdrWorkspaceID != "w1" ||
		saved.HerdrRootTabID == nil || *saved.HerdrRootTabID != "t1" ||
		saved.HerdrRootPaneID == nil || *saved.HerdrRootPaneID != "p1" ||
		saved.HerdrSession != session || saved.HerdrWorkspaceLabel != snapshot.HerdrWorkspaceLabel {
		t.Fatalf("wrong saved workspace: %#v", saved)
	}
	if !reflect.DeepEqual(saved.HerdrWorkspaceID, snapshot.HerdrWorkspaceID) {
		t.Fatal("snapshot was not updated")
	}
	if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	calls := f.calls()
	want := [][]string{
		{"status", "server"},
		{"workspace", "create", "--cwd", snapshot.RunDir, "--label", snapshot.HerdrWorkspaceLabel, "--no-focus"},
		{"status", "server"}, {"workspace", "list"},
	}
	var args [][]string
	for _, call := range calls {
		args = append(args, call.Args)
	}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("commands:\n%#v\nwant:\n%#v", args, want)
	}
}

func TestEnsureWorkspaceRecreatesMissingWorkspace(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot()
	snapshot.HerdrWorkspaceID, snapshot.HerdrRootTabID, snapshot.HerdrRootPaneID = ptr("gone"), ptr("gone-tab"), ptr("gone-pane")
	f.plan.Workspace = `{"workspace":{"workspace_id":"","id":"new-workspace"},"tab":{"id":"new-tab"},"root_pane":{"pane_id":7,"terminal_id":"new-pane"}}`
	f.savePlan()
	if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	if *snapshot.HerdrWorkspaceID != "new-workspace" || *snapshot.HerdrRootTabID != "new-tab" || *snapshot.HerdrRootPaneID != "new-pane" || snapshot.HerdrWorkspaceLabel != snapshot.Name {
		t.Fatalf("IDs/label not recovered: %#v", snapshot)
	}
	if len(callsWith(f.calls(), "workspace", "list")) != 1 || len(callsWith(f.calls(), "workspace", "create")) != 1 {
		t.Fatal("expected a list followed by recreation")
	}
}

func TestWorkspacesArePerRun(t *testing.T) {
	f := newFake(t)
	first := f.snapshot()
	second := *first
	second.RunDir, second.Name = filepath.Join(f.root, "second run"), "second run"
	if err := os.MkdirAll(second.RunDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, snapshot := range []*config.RunSnapshot{first, &second} {
		if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
			t.Fatal(err)
		}
		var saved config.RunSnapshot
		if err := persistence.LoadYAML(filepath.Join(snapshot.RunDir, "run.yaml"), &saved); err != nil {
			t.Fatal(err)
		}
		if saved.RunDir != snapshot.RunDir || *saved.HerdrWorkspaceID != *snapshot.HerdrWorkspaceID {
			t.Fatalf("snapshot belongs to another run: %#v", saved)
		}
	}
	if *first.HerdrWorkspaceID == *second.HerdrWorkspaceID {
		t.Fatal("runs shared a workspace")
	}
	if len(callsWith(f.calls(), "workspace", "create")) != 2 {
		t.Fatal("expected one workspace per run")
	}
}

func TestWorkspaceResponseFailuresDoNotPersistPartialIDs(t *testing.T) {
	for _, test := range []struct{ response, message string }{
		{`not json`, "parse herdr JSON from `workspace create"},
		{`{}`, "herdr workspace id missing"},
		{`{"workspace":{"id":"w"}}`, "herdr root tab id missing"},
		{`{"workspace":{"id":"w"},"tab":{"id":"t"},"root_pane":{"pane_id":"","id":1}}`, "herdr root pane id missing"},
		{`{"result":null,"workspace":{"id":"w"}}`, "herdr workspace id missing"},
	} {
		t.Run(test.message, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot()
			before, _ := os.ReadFile(filepath.Join(snapshot.RunDir, "run.yaml"))
			f.plan.Workspace = test.response
			f.savePlan()
			err := EnsureWorkspace(context.Background(), snapshot)
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("error = %v, want %s", err, test.message)
			}
			after, _ := os.ReadFile(filepath.Join(snapshot.RunDir, "run.yaml"))
			if string(before) != string(after) || snapshot.HerdrWorkspaceID != nil {
				t.Fatal("partial workspace IDs were persisted")
			}
			f.calls()
		})
	}
}

func TestCreateTabsKeepsHeavyModelsPaused(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("z-model", "a'model")
	snapshot.Heavy = true
	for _, key := range config.SortedKeys(snapshot.Models) {
		state := loadState(t, snapshot, key)
		state.TmuxAttach = ptr("legacy tmux")
		state.TotalTokens, state.NativeSessionID = ptr(uint64(42)), ptr("native-session")
		if err := worker.SaveState(snapshot.RunDir, key, state); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(worker.CancelPath(snapshot.RunDir, "a'model")), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(worker.CancelPath(snapshot.RunDir, "a'model"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := CreateTabs(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	calls := f.calls()
	runs := callsWith(calls, "pane", "run")
	if len(runs) != 2 || runs[0].Args[2] != "p1" || runs[1].Args[2] != "p2" {
		t.Fatalf("wrong root/sorted tab allocation: %#v", runs)
	}
	for i, key := range config.SortedKeys(snapshot.Models) {
		want := fmt.Sprintf("echo %s; echo %s; exec %s", util.ShellQuote("automator paused: "+snapshot.Name+" / "+key), util.ShellQuote("start with: automator start "+snapshot.Name+" "+key), util.ShellQuote(f.shell))
		if runs[i].Args[3] != want {
			t.Fatalf("paused command = %q, want %q", runs[i].Args[3], want)
		}
		state := loadState(t, snapshot, key)
		if state.Status != worker.Paused || state.StartedAt != nil || state.TmuxAttach != nil ||
			state.HerdrSession == nil || *state.HerdrSession != session || *state.HerdrWorkspaceID != "w1" ||
			*state.HerdrPaneID != runs[i].Args[2] || *state.HerdrAttach != "herdr session attach 'Automator'" ||
			*state.TotalTokens != 42 || *state.NativeSessionID != "native-session" {
			t.Fatalf("paused state not preserved: %#v", state)
		}
	}
	tabs := callsWith(calls, "tab", "create")
	want := []string{"tab", "create", "--workspace", "w1", "--cwd", filepath.Join(snapshot.RunDir, "z-model"), "--label", "z-model", "--env", "SHELL=" + f.shell, "--no-focus"}
	if len(tabs) != 1 || !reflect.DeepEqual(tabs[0].Args, want) {
		t.Fatalf("tab command = %#v, want %#v", tabs, want)
	}
	if _, err := os.Stat(filepath.Join(snapshot.RunDir, "z-model")); err != nil {
		t.Fatal("model working directory missing:", err)
	}
	if _, err := os.Stat(worker.CancelPath(snapshot.RunDir, "a'model")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cancel request was not cleared")
	}
}

func TestDispatchExactWrappersAndDurableTabs(t *testing.T) {
	for _, subcommand := range []string{"worker", "continue-worker"} {
		t.Run(subcommand, func(t *testing.T) {
			f := newFake(t)
			key := "model'quoted"
			snapshot := f.snapshot(key)
			if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
				t.Fatal(err)
			}
			state := loadState(t, snapshot, key)
			state.HerdrWorkspaceID = snapshot.HerdrWorkspaceID
			state.HerdrTabID, state.HerdrPaneID = ptr("existing-tab"), ptr("existing-pane")
			state.NativeSessionID, state.TotalTokens = ptr("session-id"), ptr(uint64(123))
			if err := worker.SaveState(snapshot.RunDir, key, state); err != nil {
				t.Fatal(err)
			}
			t.Setenv("AUTOMATOR_HERDR_TEST_STATE", worker.StatePath(snapshot.RunDir, key))
			message := "continue 'quoted'\n$(not-a-command); & \"still a message\""
			if err := Dispatch(context.Background(), snapshot, key, subcommand, message); err != nil {
				t.Fatal(err)
			}
			calls := f.calls()
			runs := callsWith(calls, "pane", "run")
			if len(runs) != 1 || runs[0].Args[2] != "existing-pane" || len(callsWith(calls, "tab", "create")) != 0 {
				t.Fatalf("existing tab not reused: %#v", calls)
			}
			exe, _ := os.Executable()
			exeQ, runQ, keyQ := util.ShellQuote(exe), util.ShellQuote(snapshot.RunDir), util.ShellQuote(key)
			action := exeQ + " " + subcommand + " --run " + runQ + " --model " + keyQ
			failure, exited := "worker process exited before terminal state", "worker"
			if subcommand == "continue-worker" {
				action += " --message " + util.ShellQuote(message)
				failure, exited = "continue worker exited before terminal state", "continue"
			}
			want := action + "; code=$?; if [ \"$code\" -ne 0 ]; then " + exeQ + " worker-failed --run " + runQ + " --model " + keyQ + " --error " + util.ShellQuote(failure) + "; fi; " + exeQ + " report-refresh --run " + runQ + "; echo; echo 'automator " + exited + " exited. press Ctrl-D to close.'; exec " + util.ShellQuote(f.shell)
			if runs[0].Args[3] != want {
				t.Fatalf("wrapper:\n%s\nwant:\n%s", runs[0].Args[3], want)
			}
			during := runs[0].State
			if during == nil || during.Status != worker.Running || during.StartedAt == nil || *during.HerdrPaneID != "existing-pane" || *during.TotalTokens != 123 || *during.NativeSessionID != "session-id" {
				t.Fatalf("state not recorded before dispatch: %#v", during)
			}
			if _, err := time.Parse(time.RFC3339Nano, *during.StartedAt); err != nil {
				t.Fatal(err)
			}
			// Execute only this generated wrapper with fake workers and fake shell.
			// The fake Herdr itself never runs the pane command.
			for _, exit := range []int{0, 17} {
				f.plan.WorkerExit = exit
				f.savePlan()
				before := len(f.calls())
				if out, err := exec.Command("/bin/sh", "-c", want).CombinedOutput(); err != nil {
					t.Fatalf("wrapper failed: %v: %s", err, out)
				}
				children := f.calls()[before:]
				workerArgs := []string{subcommand, "--run", snapshot.RunDir, "--model", key}
				if subcommand == "continue-worker" {
					workerArgs = append(workerArgs, "--message", message)
				}
				if !reflect.DeepEqual(children[0].Args, workerArgs) {
					t.Fatalf("shell quoting corrupted args: %#v", children)
				}
				failed := callsWith(children, "worker-failed")
				if exit == 0 && len(failed) != 0 || exit != 0 && (len(failed) != 1 || !reflect.DeepEqual(failed[0].Args, []string{"worker-failed", "--run", snapshot.RunDir, "--model", key, "--error", failure})) {
					t.Fatalf("failure wrapper: %#v", children)
				}
				refresh := callsWith(children, "report-refresh")
				if len(refresh) != 1 || !reflect.DeepEqual(refresh[0].Args, []string{"report-refresh", "--run", snapshot.RunDir}) || children[len(children)-1].Program != "fake shell's name" {
					t.Fatalf("refresh/durable shell missing: %#v", children)
				}
			}
		})
	}
}

func TestDispatchAllocatesRootOnce(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("a", "b")
	for _, key := range []string{"a", "b", "a"} {
		if err := Dispatch(context.Background(), snapshot, key, "worker", ""); err != nil {
			t.Fatal(err)
		}
	}
	calls := f.calls()
	runs := callsWith(calls, "pane", "run")
	if len(runs) != 3 || runs[0].Args[2] != "p1" || runs[1].Args[2] != "p2" || runs[2].Args[2] != "p1" || len(callsWith(calls, "tab", "create")) != 1 {
		t.Fatalf("wrong durable root allocation: %#v", calls)
	}
}

func TestConcurrentDispatchDoesNotShareRoot(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("a", "b")
	if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := make(chan error, 2)
	for _, key := range []string{"a", "b"} {
		copy := *snapshot
		go func(key string, snapshot config.RunSnapshot) {
			results <- Dispatch(ctx, &snapshot, key, "worker", "")
		}(key, copy)
	}
	for i := 0; i < 2; i++ {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	a, b := loadState(t, snapshot, "a"), loadState(t, snapshot, "b")
	if *a.HerdrPaneID == *b.HerdrPaneID || *a.HerdrTabID == *b.HerdrTabID {
		t.Fatal("concurrent workers claimed the same root")
	}
	if len(callsWith(f.calls(), "tab", "create")) != 1 {
		t.Fatal("expected exactly one additional tab")
	}
}

func TestCancelledDispatchDoesNotReplacePane(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	f.plan.Block = "pane run"
	f.savePlan()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := Dispatch(ctx, snapshot, "model", "worker", ""); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v", err)
	}
	state := loadState(t, snapshot, "model")
	if state.Status != worker.Failed || state.Error == nil || !strings.Contains(*state.Error, "context deadline exceeded") {
		t.Fatalf("cancelled dispatch left running state: %#v", state)
	}
	if len(callsWith(f.calls(), "tab", "create")) != 0 {
		t.Fatal("cancelled dispatch created replacement")
	}
}

func TestStalePaneReplacement(t *testing.T) {
	for _, failure := range []string{"", "create", "run"} {
		t.Run("replacement-"+failure, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot("model")
			if err := EnsureWorkspace(context.Background(), snapshot); err != nil {
				t.Fatal(err)
			}
			state := loadState(t, snapshot, "model")
			state.HerdrWorkspaceID = snapshot.HerdrWorkspaceID
			state.HerdrTabID, state.HerdrPaneID = ptr("old-tab"), ptr("old-pane")
			state.TotalTokens, state.NativeSessionID = ptr(uint64(56)), ptr("native-id")
			if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
				t.Fatal(err)
			}
			f.plan.Failures = map[string]string{"pane run old-pane": "stale pane", "tab rename": "stale tab"}
			if failure == "create" {
				f.plan.Failures["tab create"] = "cannot create tab"
			}
			if failure == "run" {
				f.plan.Failures["pane run p2"] = "cannot run replacement"
			}
			f.savePlan()
			t.Setenv("AUTOMATOR_HERDR_TEST_STATE", worker.StatePath(snapshot.RunDir, "model"))
			err := Dispatch(context.Background(), snapshot, "model", "continue-worker", "go")
			if failure == "" && err != nil {
				t.Fatal(err)
			}
			if failure != "" && (err == nil || !strings.Contains(err.Error(), "stale pane") || !strings.Contains(err.Error(), "replacement") && !strings.Contains(err.Error(), "replace stale")) {
				t.Fatalf("missing failure context: %v", err)
			}
			state = loadState(t, snapshot, "model")
			if *state.TotalTokens != 56 || *state.NativeSessionID != "native-id" {
				t.Fatal("failure/replacement lost native metadata")
			}
			if failure == "" {
				if state.Status != worker.Running || *state.HerdrTabID != "t2" || *state.HerdrPaneID != "p2" {
					t.Fatalf("replacement not recorded: %#v", state)
				}
			} else if state.Status != worker.Failed || state.FinishedAt == nil || state.Error == nil || !strings.Contains(*state.Error, "failed to launch worker pane") {
				t.Fatalf("failed dispatch state: %#v", state)
			}
			calls := f.calls()
			if len(callsWith(calls, "tab", "create")) != 1 {
				t.Fatalf("replacement should be tried only once: %#v", calls)
			}
			runs := callsWith(calls, "pane", "run")
			if failure != "create" && (len(runs) != 2 || *runs[1].State.HerdrPaneID != "p2") {
				t.Fatal("replacement IDs not persisted before run")
			}
		})
	}
}

func TestPausedDispatchDoesNotReplaceOrMarkFailed(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	f.plan.Failures = map[string]string{"pane run": "paused pane failed"}
	f.savePlan()
	if err := CreateTabs(context.Background(), snapshot); err == nil || !strings.Contains(err.Error(), "paused pane failed") {
		t.Fatalf("error = %v", err)
	}
	if state := loadState(t, snapshot, "model"); state.Status != worker.Paused || state.StartedAt != nil {
		t.Fatalf("paused state changed: %#v", state)
	}
	if len(callsWith(f.calls(), "tab", "create")) != 0 {
		t.Fatal("paused launch unexpectedly replaced root tab")
	}
}

func TestTabResponseIDFallbacksAndErrors(t *testing.T) {
	for _, test := range []struct{ response, message string }{
		{`{"tab":{"tab_id":"","id":"fallback-tab"},"root_pane":{"terminal_id":"fallback-pane"}}`, ""},
		{`{"tab":{"id":"fallback-tab"},"root_pane":{"id":"fallback-pane"}}`, ""},
		{`{"root_pane":{"pane_id":"pane"}}`, "herdr tab id missing"},
		{`{"tab":{"tab_id":"tab"}}`, "herdr tab root pane id missing"},
		{`invalid`, "parse herdr JSON from `tab create"},
	} {
		t.Run(test.response, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot("model")
			f.plan.Tab = test.response
			f.savePlan()
			err := Dispatch(context.Background(), snapshot, "model", "continue-worker", "go")
			if test.message != "" {
				if err == nil || !strings.Contains(err.Error(), test.message) {
					t.Fatalf("error = %v, want %s", err, test.message)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				state := loadState(t, snapshot, "model")
				if *state.HerdrTabID != "fallback-tab" || *state.HerdrPaneID != "fallback-pane" {
					t.Fatalf("fallback IDs = %#v", state)
				}
			}
			f.calls()
		})
	}
}

func TestDeletedModelsDoNotLaunchOrConsumeRoot(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("a-deleted", "b-live")
	dir := filepath.Join(snapshot.RunDir, ".automator", "deleted")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a-deleted"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Dispatch(context.Background(), snapshot, "a-deleted", "worker", ""); err != nil {
		t.Fatal(err)
	}
	if len(f.calls()) != 0 {
		t.Fatal("deleted model contacted Herdr")
	}
	if err := CreateTabs(context.Background(), snapshot); err != nil {
		t.Fatal(err)
	}
	runs := callsWith(f.calls(), "pane", "run")
	if len(runs) != 1 || runs[0].Args[2] != "p1" || !strings.Contains(runs[0].Args[3], "b-live") {
		t.Fatalf("deleted model consumed root: %#v", runs)
	}
}

func TestAttachFocusesModelAndSession(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	snapshot.HerdrWorkspaceID = ptr("snapshot-workspace")
	state := loadState(t, snapshot, "model")
	state.HerdrSession = ptr("recorded session's name")
	state.HerdrWorkspaceID, state.HerdrTabID = ptr("model-workspace"), ptr("model-tab")
	if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
		t.Fatal(err)
	}
	f.plan.Failures = map[string]string{"workspace focus": "stale workspace", "tab focus": "stale tab"}
	f.savePlan()
	if err := Attach(context.Background(), snapshot, "model"); err != nil {
		t.Fatal(err)
	}
	want := [][]string{{"status", "server"}, {"workspace", "focus", "model-workspace"}, {"tab", "focus", "model-tab"}, {"session", "attach", "recorded session's name"}}
	var args [][]string
	for _, call := range f.calls() {
		args = append(args, call.Args)
	}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("attach commands = %#v, want %#v", args, want)
	}
}

func TestAttachFallsBackToSnapshotAndDefaultSession(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot()
	snapshot.HerdrWorkspaceID, snapshot.HerdrSession = ptr("run-workspace"), ""
	if err := Attach(context.Background(), snapshot, "missing-state"); err != nil {
		t.Fatal(err)
	}
	calls := f.calls()
	if focus := callsWith(calls, "workspace", "focus"); len(focus) != 1 || focus[0].Args[2] != "run-workspace" {
		t.Fatalf("missing snapshot fallback: %#v", calls)
	}
	if attach := callsWith(calls, "session", "attach"); len(attach) != 1 || attach[0].Args[2] != session {
		t.Fatalf("missing session default: %#v", calls)
	}
}

func TestAttachNativeReopenFallback(t *testing.T) {
	for _, scenario := range []string{"missing-herdr", "attach-failed", "no-session", "reopen-failed"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFake(t)
			snapshot := f.snapshot("model")
			state := loadState(t, snapshot, "model")
			state.NativeReopen = "cd '/native project' && tool --session 'native-id'"
			f.plan.Failures = map[string]string{"session attach": "attach failed"}
			if scenario == "missing-herdr" {
				if err := os.Remove(filepath.Join(f.bin, "herdr")); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "no-session" {
				state.NativeReopen = "tool --session '<session-id>'"
			}
			if scenario == "reopen-failed" {
				f.plan.Failures["-lc"] = "native reopen failed"
			}
			f.savePlan()
			if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
				t.Fatal(err)
			}
			err := Attach(context.Background(), snapshot, "model")
			if scenario == "no-session" {
				if err == nil || !strings.Contains(err.Error(), "no native session id captured for model") {
					t.Fatalf("error = %v", err)
				}
			} else if scenario == "reopen-failed" {
				if err == nil || !strings.Contains(err.Error(), "reopen native session for model") || !strings.Contains(err.Error(), "herdr session attach failed") {
					t.Fatalf("error = %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			reopens := callsWith(f.calls(), "-lc")
			if scenario == "no-session" {
				if len(reopens) != 0 {
					t.Fatal("executed placeholder native session")
				}
			} else if len(reopens) != 1 || !reflect.DeepEqual(reopens[0].Args, []string{"-lc", state.NativeReopen}) || reopens[0].Program != "fake shell's name" {
				t.Fatalf("wrong native reopen: %#v", reopens)
			}
		})
	}
}

func TestAttachCommand(t *testing.T) {
	for _, test := range []struct {
		snapshot string
		state    *string
		want     string
	}{
		{"", nil, "herdr session attach 'Automator'"},
		{"snapshot session", nil, "herdr session attach 'snapshot session'"},
		{"snapshot", ptr("model's session"), "herdr session attach 'model'\\''s session'"},
		{"snapshot", ptr(""), "herdr session attach 'Automator'"},
	} {
		got := AttachCommand(config.RunSnapshot{HerdrSession: test.snapshot}, worker.State{HerdrSession: test.state})
		if got != test.want {
			t.Fatalf("AttachCommand = %q, want %q", got, test.want)
		}
	}
}

func TestSendInterrupt(t *testing.T) {
	f := newFake(t)
	if err := SendInterrupt(context.Background(), "pane-id"); err != nil {
		t.Fatal(err)
	}
	calls := f.calls()
	if len(calls) != 1 || !reflect.DeepEqual(calls[0].Args, []string{"pane", "send-keys", "pane-id", "Ctrl-C"}) {
		t.Fatalf("wrong interrupt command: %#v", calls)
	}
	f.plan.Failures = map[string]string{"pane send-keys": "pane gone"}
	f.savePlan()
	if err := SendInterrupt(context.Background(), "pane-id"); err == nil || !strings.Contains(err.Error(), "herdr pane send-keys pane-id Ctrl-C failed: pane gone") {
		t.Fatalf("interrupt error = %v", err)
	}
}

func TestServerStartupAndAppendLogs(t *testing.T) {
	f := newFake(t)
	f.plan.Ready, f.plan.StartReady = false, true
	f.savePlan()
	logDir := filepath.Join(os.Getenv("AUTOMATOR_HOME"), "herdr")
	if err := os.MkdirAll(logDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"automator.out.log", "automator.err.log"} {
		if err := os.WriteFile(filepath.Join(logDir, name), []byte("previous log\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := ensureReady(ctx); err != nil {
		t.Fatal(err)
	}
	calls := f.calls()
	if len(callsWith(calls, "server")) != 1 || len(callsWith(calls, "status", "server")) < 2 {
		t.Fatalf("startup commands = %#v", calls)
	}
	for name, text := range map[string]string{"automator.out.log": "fake server stdout", "automator.err.log": "fake server stderr"} {
		data, err := os.ReadFile(filepath.Join(logDir, name))
		if err != nil || !strings.HasPrefix(string(data), "previous log\n") || !strings.Contains(string(data), text) {
			t.Fatalf("startup log %s = %q, %v", name, data, err)
		}
	}
}

func TestServerStartupFailures(t *testing.T) {
	for _, scenario := range []string{"missing", "spawn", "logs", "timeout", "cancel"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFake(t)
			f.plan.Ready = false
			want := ""
			switch scenario {
			case "missing":
				if err := os.Remove(filepath.Join(f.bin, "herdr")); err != nil {
					t.Fatal(err)
				}
				want = "herdr not found; install herdr or use mode: headless"
			case "spawn":
				f.plan.BreakExecutable = true
				want = "start Herdr Automator server"
			case "logs":
				if err := os.WriteFile(filepath.Join(os.Getenv("AUTOMATOR_HOME"), "herdr"), nil, 0o600); err != nil {
					t.Fatal(err)
				}
				want = "start Herdr Automator server"
			case "timeout":
				want = "herdr Automator session did not become ready"
			case "cancel":
				want = "context deadline exceeded"
			}
			f.savePlan()
			ctx := context.Background()
			if scenario == "cancel" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
			}
			err := ensureReady(ctx)
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("error = %v, want %s", err, want)
			}
			if scenario == "cancel" && !errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("context cancellation was not preserved")
			}
			calls := f.calls()
			if scenario == "timeout" && (len(callsWith(calls, "status", "server")) != 41 || len(callsWith(calls, "server")) != 1) {
				t.Fatalf("wrong readiness retry count: %d calls", len(calls))
			}
		})
	}
}

func TestCancelledAttachDoesNotReopen(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	state := loadState(t, snapshot, "model")
	state.NativeReopen = "tool --session valid"
	if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Attach(ctx, snapshot, "model"); !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v", err)
	}
	if len(f.calls()) != 0 {
		t.Fatal("cancelled attach launched a command")
	}
}

func TestNativeReopenCancellation(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	state := loadState(t, snapshot, "model")
	state.NativeReopen = "tool --session valid"
	if err := worker.SaveState(snapshot.RunDir, "model", state); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(f.bin, "herdr")); err != nil {
		t.Fatal(err)
	}
	f.plan.Block = "-lc"
	f.savePlan()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if err := Attach(ctx, snapshot, "model"); !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "reopen native session for model") {
		t.Fatalf("error = %v", err)
	}
	if len(callsWith(f.calls(), "-lc")) != 1 {
		t.Fatal("native reopen was not attempted")
	}
}

func TestInvalidDispatchDoesNotInvokeHerdr(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	for _, test := range []struct{ key, subcommand string }{{"../outside", "worker"}, {"missing", "worker"}, {"model", "worker; false"}} {
		if err := Dispatch(context.Background(), snapshot, test.key, test.subcommand, ""); err == nil {
			t.Fatalf("invalid dispatch accepted: %#v", test)
		}
	}
	if len(f.calls()) != 0 {
		t.Fatal("invalid dispatch invoked Herdr")
	}
}

func TestDeletedRunIsNotRecreated(t *testing.T) {
	f := newFake(t)
	snapshot := f.snapshot("model")
	if err := os.RemoveAll(snapshot.RunDir); err != nil {
		t.Fatal(err)
	}
	if err := EnsureWorkspace(context.Background(), snapshot); err == nil || !strings.Contains(err.Error(), "run directory no longer exists") {
		t.Fatalf("error = %v", err)
	}
	if len(f.calls()) != 0 {
		t.Fatal("deleted run contacted Herdr")
	}
	if _, err := os.Stat(snapshot.RunDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("deleted run was recreated")
	}
}

func TestJSONIDHelpers(t *testing.T) {
	var value map[string]any
	if err := json.Unmarshal([]byte(`{"result":{"workspaces":[{"workspace_id":"w2"},{"workspace_id":"w7"},{"id":"not-workspace-id"},null]}}`), &value); err != nil {
		t.Fatal(err)
	}
	if listedObject(commandResult(value), "workspaces", "workspace_id", "w2") == nil ||
		listedObject(commandResult(value), "workspaces", "workspace_id", "w24") != nil ||
		listedObject(commandResult(value), "workspaces", "workspace_id", "not-workspace-id") != nil ||
		listedObject(commandResult(value), "workspaces", "workspace_id", "") != nil {
		t.Fatal("workspace list ID matching changed")
	}
	for _, raw := range []string{`{}`, `{"result":null}`, `{"workspaces":{}}`, `{"workspaces":[7]}`} {
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			t.Fatal(err)
		}
		if listedObject(commandResult(value), "workspaces", "workspace_id", "w1") != nil {
			t.Fatalf("invalid workspace list matched: %s", raw)
		}
	}
}
