//go:build unix

package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"automator/internal/adapter"
	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/report"
	"automator/internal/worker"
)

// Child executions use this test executable, not a installed Automator CLI or
// any native provider. Every tool and session path is confined to a fixture.
func TestMain(m *testing.M) {
	if os.Getenv("EXECUTOR_TEST_HELPER") == "1" && filepath.Base(os.Args[0]) == "test-shell" && len(os.Args) == 1 {
		os.Exit(0)
	}
	if os.Getenv("EXECUTOR_TEST_HELPER") == "1" && len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-test.") {
		os.Exit(helperMain())
	}
	os.Exit(m.Run())
}

func helperMain() int {
	args := os.Args[1:]
	flag := func(name string) string {
		for i := range args {
			if args[i] == name && i+1 < len(args) {
				return args[i+1]
			}
		}
		return ""
	}
	events := os.Getenv("EXECUTOR_TEST_EVENTS")
	if events == "" {
		return 99
	}
	base := filepath.Base(os.Args[0])
	if base == "test-shell" {
		if len(args) < 2 {
			return 0
		}
		cmd := exec.Command("/bin/sh", "-c", args[1])
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			var exit *exec.ExitError
			if errors.As(err, &exit) {
				return exit.ExitCode()
			}
			return 1
		}
		return 0
	}
	if args[0] == "descendant" {
		for {
			time.Sleep(time.Hour)
		}
	}
	if args[0] == "worker" || args[0] == "continue-worker" {
		key, dir := flag("--model"), flag("--run")
		if key == "stubborn" {
			signal.Ignore(syscall.SIGTERM)
			exe, _ := os.Executable()
			cmd := exec.Command(exe, "descendant")
			if err := cmd.Start(); err != nil {
				return 1
			}
			_ = os.WriteFile(filepath.Join(events, "descendant.pid"), []byte(strconv.Itoa(cmd.Process.Pid)), 0600)
			for {
				time.Sleep(time.Hour)
			}
		}
		if key == "crash" {
			return 2
		}
		var err error
		if args[0] == "worker" {
			err = worker.Run(context.Background(), dir, key)
		} else {
			err = worker.Continue(context.Background(), dir, key, flag("--message"))
		}
		if errors.Is(err, context.Canceled) {
			return 130
		}
		if err != nil {
			_ = worker.MarkFailed(dir, key, err.Error())
			return 1
		}
		return 0
	}
	if args[0] == "worker-failed" {
		if worker.MarkFailed(flag("--run"), flag("--model"), flag("--error")) != nil {
			return 1
		}
		return 0
	}
	if args[0] == "report-refresh" {
		err := refreshReport(flag("--run"))
		_ = os.WriteFile(filepath.Join(events, "report-"+filepath.Base(flag("--run"))), []byte("done"), 0600)
		if err != nil {
			return 1
		}
		return 0
	}
	if base == "herdr" {
		unlock, err := persistence.Lock(context.Background(), filepath.Join(events, "herdr.lock"))
		if err != nil {
			return 1
		}
		f, err := os.OpenFile(filepath.Join(events, "herdr.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err == nil {
			_ = json.NewEncoder(f).Encode(args)
			_ = f.Close()
		}
		unlock()
		if args[0] == "status" {
			return 0
		}
		if args[0] == "workspace" && args[1] == "list" {
			fmt.Print(`{"result":{"workspaces":[{"workspace_id":"w-test"}]}}`)
			return 0
		}
		if args[0] == "workspace" && args[1] == "create" {
			fmt.Print(`{"result":{"workspace":{"workspace_id":"w-test"},"tab":{"tab_id":"root-tab"},"root_pane":{"pane_id":"root-pane"}}}`)
			return 0
		}
		if args[0] == "tab" && args[1] == "create" {
			fmt.Printf(`{"result":{"tab":{"tab_id":%q},"root_pane":{"pane_id":%q}}}`, "tab-"+flag("--label"), "pane-"+flag("--label"))
			return 0
		}
		if args[0] == "pane" && args[1] == "run" {
			if len(args) > 3 && os.Getenv("EXECUTOR_TEST_HERDR_BLOCK_KEY") != "" && strings.Contains(args[3], "--model '"+os.Getenv("EXECUTOR_TEST_HERDR_BLOCK_KEY")+"'") {
				_ = os.WriteFile(filepath.Join(events, "herdr-blocked"), []byte("blocked"), 0600)
				for {
					time.Sleep(time.Hour)
				}
			}
			if os.Getenv("EXECUTOR_TEST_HERDR_FAIL") == "1" {
				return 1
			}
			if len(args) > 3 && (strings.Contains(args[3], " worker --run ") || strings.Contains(args[3], " continue-worker --run ")) {
				cmd := exec.Command(os.Getenv("SHELL"), "-c", args[3])
				if err := cmd.Start(); err != nil {
					return 1
				}
				_ = cmd.Process.Release()
			}
		}
		return 0
	}
	if base == "git" {
		return 0
	}
	if base == "playwright-cli" {
		fmt.Print(`{"browsers":[]}`)
		return 0
	}
	if args[0] == "--version" {
		fmt.Println("fixture-1.0")
		return 0
	}
	if base == "opencode" && args[0] == "session" {
		active := filepath.Join(events, "warmup-active")
		if err := os.Mkdir(active, 0700); err != nil {
			_ = os.WriteFile(filepath.Join(events, "warmup-overlap"), []byte("overlap"), 0600)
			return 1
		}
		defer os.Remove(active)
		if delay, err := time.ParseDuration(os.Getenv("EXECUTOR_TEST_WARMUP_DELAY")); err == nil {
			time.Sleep(delay)
		}
		_ = os.WriteFile(filepath.Join(events, "warmup"), []byte("yes"), 0600)
		if os.Getenv("EXECUTOR_TEST_WARMUP_FAIL") == "1" {
			return 1
		}
		return 0
	}
	if base != "pi" && base != "opencode" && base != "claude" {
		return 98
	}
	project, _ := os.Getwd()
	key := filepath.Base(project)
	_ = os.WriteFile(filepath.Join(events, key+".start"), []byte(strconv.FormatInt(time.Now().UnixNano(), 10)), 0600)
	if key == "block" {
		exe, _ := os.Executable()
		cmd := exec.Command(exe, "descendant")
		if err := cmd.Start(); err != nil {
			return 1
		}
		_ = os.WriteFile(filepath.Join(events, "descendant.pid"), []byte(strconv.Itoa(cmd.Process.Pid)), 0600)
		_ = cmd.Wait()
	}
	if delay, err := time.ParseDuration(os.Getenv("EXECUTOR_TEST_DELAY")); err == nil {
		time.Sleep(delay)
	}
	_ = os.WriteFile(filepath.Join(project, "artifact"), []byte("native output"), 0600)
	data, _ := json.Marshal(args)
	_ = os.WriteFile(filepath.Join(events, key+".argv"), data, 0600)
	_ = os.WriteFile(filepath.Join(events, key+".finish"), []byte(strconv.FormatInt(time.Now().UnixNano(), 10)), 0600)
	if key == "failed" {
		return 1
	}
	if key == "cancelled" {
		return 130
	}
	return 0
}

type fixture struct {
	t                       *testing.T
	home, root, events, bin string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	base, err := filepath.EvalSymlinks(t.TempDir())
	must(t, err)
	f := &fixture{t: t, home: filepath.Join(base, "home"), root: filepath.Join(base, "runs"), events: filepath.Join(base, "events"), bin: filepath.Join(base, "bin")}
	for _, path := range []string{f.home, f.root, f.events, f.bin} {
		must(t, os.MkdirAll(path, 0700))
	}
	for key, value := range map[string]string{
		"GORACE":                        "atexit_sleep_ms=0",
		"PI_CODING_AGENT_SESSION_DIR":   filepath.Join(f.home, "pi-sessions"),
		"EXECUTOR_TEST_HERDR_BLOCK_KEY": "",
		"EXECUTOR_TEST_WARMUP_DELAY":    "",
		"HOME":                          f.home, "AUTOMATOR_HOME": filepath.Join(f.home, ".automator"), "XDG_CONFIG_HOME": filepath.Join(f.home, "config"), "XDG_DATA_HOME": filepath.Join(f.home, "data"), "XDG_STATE_HOME": filepath.Join(f.home, "state"), "XDG_CACHE_HOME": filepath.Join(f.home, "cache"),
		"CLAUDE_CONFIG_DIR": filepath.Join(f.home, "claude"), "PI_CODING_AGENT_DIR": filepath.Join(f.home, "pi"), "OPENCODE_CONFIG_DIR": filepath.Join(f.home, "opencode"), "PATH": f.bin, "SHELL": filepath.Join(f.bin, "test-shell"),
		"EXECUTOR_TEST_HELPER": "1", "EXECUTOR_TEST_EVENTS": f.events, "EXECUTOR_TEST_DELAY": "120ms", "EXECUTOR_TEST_WARMUP_FAIL": "", "EXECUTOR_TEST_HERDR_FAIL": "", "HERDR_SESSION": "fixture-never-real", "HERDR_ENV": "", "HERDR_WORKSPACE_ID": "", "HERDR_TAB_ID": "", "HERDR_PANE_ID": "",
	} {
		t.Setenv(key, value)
	}
	exe, err := os.Executable()
	must(t, err)
	for _, tool := range []string{"test-shell", "git", "pi", "opencode", "claude", "herdr", "playwright-cli"} {
		must(t, os.Symlink(exe, filepath.Join(f.bin, tool)))
	}
	must(t, config.EnsureHome())
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "providers.yaml"), config.ProvidersFile{SchemaVersion: 1, Providers: map[string]config.Provider{"provider": {DisplayName: "Fixture", Auth: "external"}}}))
	return f
}

func (f *fixture) draft(keys ...string) config.DraftRun {
	models := make(map[string]config.Model)
	for _, key := range keys {
		models[key] = config.Model{DisplayName: key, Tool: config.Claude, Provider: "provider", Model: "native", Args: map[string]any{}}
	}
	must(f.t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), config.ModelsFile{SchemaVersion: 1, Models: models}))
	draft := config.DraftRun{SchemaVersion: 1, Name: "Example Run", Root: f.root, Mode: config.Headless, Concurrency: 2, Template: "empty", Prompt: "test prompt"}
	f.saveDraft(draft)
	return draft
}

func (f *fixture) saveDraft(draft config.DraftRun) {
	f.t.Helper()
	must(f.t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "drafts", "example", "v1.yaml"), draft))
}
func (f *fixture) runDir() string { return filepath.Join(f.root, "example-run") }
func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func ptr[T any](value T) *T { return &value }
func readText(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	must(t, err)
	return string(data)
}
func waitFor(t *testing.T, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		if predicate() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition timed out")
}
func waitState(t *testing.T, dir, key string, status worker.Status) worker.State {
	t.Helper()
	var state worker.State
	waitFor(t, func() bool {
		var err error
		state, err = worker.LoadState(dir, key)
		return err == nil && state.Status == status
	})
	return state
}
func exists(path string) bool { _, err := os.Lstat(path); return err == nil }

func TestValidateReadOnlyAndCommandParity(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("pi-model", "open-model", "claude-model")
	draft.Heavy, draft.Concurrency, draft.Mode = true, 0, config.Headful
	draft.Prompt = "hello 'world' API_TOKEN='never-print'"
	draft.Pre = []config.ShellStep{{Shell: "API_KEY='secret' test"}}
	f.saveDraft(draft)
	models, err := config.Models()
	must(t, err)
	for key, tool := range map[string]config.Tool{"pi-model": config.Pi, "open-model": config.Opencode, "claude-model": config.Claude} {
		model := models.Models[key]
		model.Tool = tool
		model.Args = map[config.Tool]map[string]any{config.Pi: {"thinking": true, "approve": true, "session_dir": "sessions"}, config.Opencode: {"agent": "build", "variant": "high", "thinking": true, "format": "json"}, config.Claude: {"effort": "high", "dangerously_skip_permissions": true}}[tool]
		models.Models[key] = model
	}
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "model-presets.yaml"), config.ModelPresetsFile{SchemaVersion: 1, Presets: map[string]config.ModelPreset{"all": {Models: []string{"open-model", "pi-model", "open-model"}}}}))
	before := tree(t, config.HomeDir())
	must(t, os.Remove(filepath.Join(f.bin, "herdr")))
	out, err := ValidateDraft(context.Background(), "example", config.ModelSelection{Models: []string{"claude-model", "pi-model"}, Presets: []string{"all"}})
	must(t, err)
	for _, want := range []string{"mode: Headful", "concurrency: 1", "heavy: true", "missing: herdr", "ok: pi", "ok: opencode", "ok: claude", "<redacted>", "template steps:", "post_each steps:", "post_all steps:"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %s", want, out)
		}
	}
	if strings.Contains(out, "never-print") || strings.Contains(out, "'secret'") {
		t.Fatal("secrets leaked")
	}
	if strings.Count(out, "  - pi-model") != 1 {
		t.Fatal("preset selection was not deduplicated")
	}
	if !reflect.DeepEqual(before, tree(t, config.HomeDir())) || exists(f.runDir()) {
		t.Fatal("validation wrote files")
	}
	prompt := filepath.Join(f.events, "prompt.md")
	must(t, os.WriteFile(prompt, []byte(draft.Prompt), 0600))
	for key, model := range models.Models {
		project := filepath.Join(f.root, key)
		cmd, err := adapter.BuildCommand(model, project, prompt, "title")
		must(t, err)
		quoted := make([]string, len(cmd.Args))
		for i, arg := range cmd.Args {
			quoted[i] = "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
		}
		want := cmd.Program + " " + strings.Join(quoted, " ")
		if model.Tool != config.Opencode {
			want = "cd '" + project + "' && " + want
		}
		if got, err := previewCommand(model, project, prompt, draft.Prompt, "title"); err != nil || got != want {
			t.Errorf("preview mismatch for %s\n%s\n%s", key, got, want)
		}
	}
}

func tree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	must(t, filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			out[path] = string(data)
		}
		return nil
	}))
	return out
}

func TestInvalidSelectionNeverWrites(t *testing.T) {
	for _, key := range []string{"../escape", "a/b", `a\b`, ".", "..", "", "x\x00y", ".automator", "run.yaml", "prompt.md", "report.md"} {
		t.Run(strconv.Quote(key), func(t *testing.T) {
			f := newFixture(t)
			f.draft("valid")
			before := tree(t, config.HomeDir())
			for _, call := range []func() error{
				func() error {
					_, err := ValidateDraft(context.Background(), "example", config.ModelSelection{Models: []string{key}})
					return err
				},
				func() error {
					return RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{key}})
				},
				func() error { return StartModel(context.Background(), f.runDir(), key, false) },
				func() error { return DeleteModel(context.Background(), f.runDir(), key) },
			} {
				if err := call(); err == nil {
					t.Fatalf("accepted unsafe key %q", key)
				}
			}
			if !reflect.DeepEqual(before, tree(t, config.HomeDir())) {
				t.Fatal("invalid selection wrote config")
			}
			entries, err := os.ReadDir(f.root)
			must(t, err)
			if len(entries) != 0 {
				t.Fatal("invalid selection wrote run root")
			}
		})
	}
	f := newFixture(t)
	f.draft("valid")
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "model-presets.yaml"), config.ModelPresetsFile{SchemaVersion: 1, Presets: map[string]config.ModelPreset{"bad": {Models: []string{"valid", "../escape"}}}}))
	before := tree(t, config.HomeDir())
	if err := RunDraft(context.Background(), "example", config.ModelSelection{Presets: []string{"bad"}}); err == nil {
		t.Fatal("accepted unsafe preset expansion")
	}
	if !reflect.DeepEqual(before, tree(t, config.HomeDir())) {
		t.Fatal("preset validation wrote config")
	}
}

func TestRuntimeResolutionErrorsAndHeavyOverride(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("valid")
	draft.Heavy = true
	f.saveDraft(draft)
	for _, selection := range []config.ModelSelection{{}, {Models: []string{"absent"}}, {Presets: []string{"absent"}}, {Presets: []string{"../unsafe"}}} {
		if _, err := ValidateDraft(context.Background(), "example", selection); err == nil {
			t.Fatal("accepted invalid selection")
		}
	}
	out, err := ValidateDraft(context.Background(), "example", config.ModelSelection{Models: []string{"valid"}, RunHeavy: true})
	must(t, err)
	if !strings.Contains(out, "heavy: false") {
		t.Fatal(out)
	}
	models, err := config.Models()
	must(t, err)
	model := models.Models["valid"]
	model.Args = map[string]any{"not-supported": true}
	models.Models["valid"] = model
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	if err := RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"valid"}}); err == nil {
		t.Fatal("accepted conflicting args")
	}
	model.Args = nil
	model.Provider = "absent"
	models.Models["valid"] = model
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	if _, err := ValidateDraft(context.Background(), "example", config.ModelSelection{Models: []string{"valid"}}); err == nil {
		t.Fatal("accepted missing provider")
	}
	model.Provider = "provider"
	models.Models["valid"] = model
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	must(t, os.Remove(filepath.Join(f.bin, "claude")))
	if err := RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"valid"}}); err == nil {
		t.Fatal("run accepted missing binary")
	}
	if exists(f.runDir()) {
		t.Fatal("failed resolution created run")
	}
}

func TestHeadlessBoundedNativeWorkersAndIsolatedFailure(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("a", "b", "cancelled", "crash", "failed", "z")
	draft.PostAll = []config.ShellStep{{Shell: "exit 1"}, {Shell: "printf 'post' > post-all"}}
	f.saveDraft(draft)
	t.Setenv("EXECUTOR_TEST_DELAY", "300ms")
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"a", "b", "cancelled", "crash", "failed", "z"}}))
	for key, status := range map[string]worker.Status{"a": worker.Done, "b": worker.Done, "cancelled": worker.Cancelled, "crash": worker.Failed, "failed": worker.Failed, "z": worker.Done} {
		state, err := worker.LoadState(f.runDir(), key)
		must(t, err)
		if state.Status != status {
			t.Errorf("%s: got %s want %s", key, state.Status, status)
		}
	}
	if readText(t, filepath.Join(f.runDir(), "post-all")) != "post" {
		t.Fatal("post_all did not continue after failure")
	}
	if !strings.Contains(readText(t, filepath.Join(f.runDir(), "report.md")), "Cancelled") {
		t.Fatal("report missing terminal state")
	}
	for _, key := range []string{"a", "b", "cancelled", "failed", "z"} {
		start, err := strconv.ParseInt(readText(t, filepath.Join(f.events, key+".start")), 10, 64)
		must(t, err)
		active := 0
		for _, other := range []string{"a", "b", "cancelled", "failed", "z"} {
			s, err := strconv.ParseInt(readText(t, filepath.Join(f.events, other+".start")), 10, 64)
			must(t, err)
			e, err := strconv.ParseInt(readText(t, filepath.Join(f.events, other+".finish")), 10, 64)
			must(t, err)
			if s <= start && start < e {
				active++
			}
		}
		if active > 2 {
			t.Fatalf("concurrency exceeded: %d", active)
		}
	}
	aEnd, _ := strconv.ParseInt(readText(t, filepath.Join(f.events, "a.finish")), 10, 64)
	bStart, _ := strconv.ParseInt(readText(t, filepath.Join(f.events, "b.start")), 10, 64)
	if bStart >= aEnd {
		t.Fatal("independent same-provider models were serialized")
	}
}

func TestConcurrentAllocationAndIndexTransactions(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("model")
	draft.Heavy = true
	f.saveDraft(draft)
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"model"}})
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		must(t, err)
	}
	index, err := config.LoadRunsIndex()
	must(t, err)
	if len(index.Runs) != 8 {
		t.Fatalf("lost index updates: %d", len(index.Runs))
	}
	seen := map[string]bool{}
	for _, entry := range index.Runs {
		if seen[entry.Path] {
			t.Fatal("duplicate allocated path")
		}
		seen[entry.Path] = true
		state, err := worker.LoadState(entry.Path, "model")
		must(t, err)
		if state.Status != worker.Paused {
			t.Fatal(state.Status)
		}
	}
	errs = make(chan error, 8)
	for _, entry := range index.Runs {
		wg.Add(1)
		go func(path string) { defer wg.Done(); errs <- DeleteRun(context.Background(), path) }(entry.Path)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		must(t, err)
	}
	index, err = config.LoadRunsIndex()
	must(t, err)
	if len(index.Runs) != 0 {
		t.Fatal("deletion lost index updates")
	}
	if NextRunDir(f.root, "Example Run") != filepath.Join(f.root, "example-run-v9") {
		t.Fatal("reused externally tombstoned run directory")
	}
}

func TestHeavyActionsRetryBackupsContinueAndFailure(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("model", "crash")
	draft.Heavy = true
	f.saveDraft(draft)
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"model", "crash"}}))
	if exists(filepath.Join(f.events, "model.start")) {
		t.Fatal("heavy model executed")
	}
	must(t, StartModel(context.Background(), f.runDir(), "model", false))
	if err := StartModel(context.Background(), f.runDir(), "model", true); err == nil {
		t.Fatal("duplicate start accepted")
	}
	waitState(t, f.runDir(), "model", worker.Done)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	if err := StartModel(context.Background(), f.runDir(), "model", false); err == nil {
		t.Fatal("terminal start without force accepted")
	}
	must(t, os.Remove(filepath.Join(f.events, "report-example-run")))
	must(t, RetryModel(context.Background(), f.runDir(), "model", false))
	waitState(t, f.runDir(), "model", worker.Done)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	backups, err := os.ReadDir(filepath.Join(f.runDir(), ".automator", "retry-backups"))
	must(t, err)
	if len(backups) != 1 || readText(t, filepath.Join(f.runDir(), ".automator", "retry-backups", backups[0].Name(), "artifact")) != "native output" {
		t.Fatal("retry did not preserve project backup")
	}
	state, err := worker.LoadState(f.runDir(), "model")
	must(t, err)
	state.NativeSessionID, state.Cost = ptr("native-session"), ptr(2.5)
	must(t, worker.SaveState(f.runDir(), "model", state))
	must(t, os.Remove(filepath.Join(f.events, "report-example-run")))
	must(t, ContinueModel(context.Background(), f.runDir(), "model", "  ", false))
	waitState(t, f.runDir(), "model", worker.Done)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	argv := readText(t, filepath.Join(f.events, "model.argv"))
	if !strings.Contains(argv, `"--resume","native-session"`) || !strings.Contains(argv, `"continue"`) {
		t.Fatal(argv)
	}
	if len(backups) != 1 {
		t.Fatal("continue backed up project")
	}
	must(t, os.Remove(filepath.Join(f.events, "report-example-run")))
	must(t, StartModel(context.Background(), f.runDir(), "crash", false))
	waitState(t, f.runDir(), "crash", worker.Failed)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	t.Setenv("SHELL", filepath.Join(f.bin, "missing-shell"))
	if err := StartModel(context.Background(), f.runDir(), "model", true); err == nil {
		t.Fatal("spawn failure lost")
	}
	state, err = worker.LoadState(f.runDir(), "model")
	must(t, err)
	if state.Status != worker.Failed || state.Error == nil {
		t.Fatalf("spawn failure left state %s", state.Status)
	}
}

func TestContinuationRecoveryAndHistoricalRepricing(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("model", "unsupported", "running", "mismatch")
	draft.Heavy = true
	f.saveDraft(draft)
	models, err := config.Models()
	must(t, err)
	model := models.Models["unsupported"]
	model.Tool = config.Pi
	models.Models["unsupported"] = model
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"model", "unsupported", "running", "mismatch"}}))
	for _, key := range []string{"model", "unsupported", "mismatch"} {
		state, err := worker.LoadState(f.runDir(), key)
		must(t, err)
		state.Status = worker.Done
		state.Cost = ptr(99.0)
		state.InputTokens = ptr(uint64(999))
		must(t, worker.SaveState(f.runDir(), key, state))
	}
	state, err := worker.LoadState(f.runDir(), "running")
	must(t, err)
	state.Status = worker.Queued
	must(t, worker.SaveState(f.runDir(), "running", state))
	for key, model := range models.Models {
		model.Pricing = &config.ModelPricing{InputPerMillion: 2, OutputPerMillion: 4}
		models.Models[key] = model
	}
	model = models.Models["mismatch"]
	model.Model = "different"
	models.Models["mismatch"] = model
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	project := filepath.Join(f.runDir(), "model")
	event := fmt.Sprintf("{\"type\":\"assistant\",\"cwd\":%q,\"sessionId\":\"recovered\",\"message\":{\"id\":\"msg\",\"usage\":{\"input_tokens\":1000000,\"output_tokens\":500000}}}\n", project)
	sessionPath := filepath.Join(os.Getenv("CLAUDE_CONFIG_DIR"), "projects", "fixture", "session.jsonl")
	must(t, persistence.WriteFile(sessionPath, []byte(event), 0600))
	index, err := config.LoadRunsIndex()
	must(t, err)
	index.Runs = append(index.Runs, index.Runs[0])
	must(t, config.SaveRunsIndex(index))
	must(t, Reprice(context.Background(), ""))
	state, err = worker.LoadState(f.runDir(), "model")
	must(t, err)
	if state.Cost == nil || *state.Cost != 4 || state.NativeSessionID == nil || *state.NativeSessionID != "recovered" || *state.InputTokens != 1000000 {
		t.Fatalf("bad recovered metrics: %+v", state)
	}
	snapshot, err := loadSnapshot(f.runDir())
	must(t, err)
	if snapshot.Models["model"].Pricing == nil || snapshot.Models["mismatch"].Pricing != nil {
		t.Fatal("repricing registry adoption ignored identity")
	}
	must(t, Reprice(context.Background(), f.runDir()))
	state, err = worker.LoadState(f.runDir(), "model")
	must(t, err)
	if *state.Cost != 4 {
		t.Fatal("repricing was cumulative")
	}
	unsupported, err := worker.LoadState(f.runDir(), "unsupported")
	must(t, err)
	if *unsupported.Cost != 99 {
		t.Fatal("repriced unsupported tool")
	}
	state.NativeSessionID = nil
	must(t, worker.SaveState(f.runDir(), "model", state))
	must(t, os.MkdirAll(project, 0700))
	must(t, ContinueModel(context.Background(), f.runDir(), "model", "new instruction", false))
	state = waitState(t, f.runDir(), "model", worker.Done)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	if state.NativeSessionID == nil || *state.NativeSessionID != "recovered" {
		t.Fatal("continue did not recover session")
	}
	if !strings.Contains(readText(t, filepath.Join(f.events, "model.argv")), `"new instruction"`) {
		t.Fatal("continue lost message")
	}
	unsupported.NativeSessionID = ptr("pi-session")
	must(t, worker.SaveState(f.runDir(), "unsupported", unsupported))
	if err := ContinueModel(context.Background(), f.runDir(), "unsupported", "continue", true); err == nil {
		t.Fatal("unsupported Pi continuation accepted")
	}
}

func TestSafeDeletionTombstonesAndQueuedWorkerGuards(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("one", "two")
	draft.Heavy = true
	f.saveDraft(draft)
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"one", "two"}}))
	state, err := worker.LoadState(f.runDir(), "one")
	must(t, err)
	state.Status = worker.Running
	must(t, worker.SaveState(f.runDir(), "one", state))
	if err := DeleteModel(context.Background(), f.runDir(), "one"); err == nil {
		t.Fatal("deleted running model")
	}
	if err := DeleteRun(context.Background(), f.runDir()); err == nil {
		t.Fatal("deleted running run")
	}
	state.Status = worker.Queued
	must(t, worker.SaveState(f.runDir(), "one", state))
	guard, err := persistence.TryLock(worker.LifetimeLockPath(f.runDir(), "one"))
	must(t, err)
	if err := DeleteModel(context.Background(), f.runDir(), "one"); err == nil {
		t.Fatal("deleted queued lifetime owner")
	}
	if err := DeleteRun(context.Background(), f.runDir()); err == nil {
		t.Fatal("deleted queued worker run")
	}
	guard()
	must(t, DeleteModel(context.Background(), f.runDir(), "one"))
	if exists(worker.StatePath(f.runDir(), "one")) || !modelDeleted(f.runDir(), "one") {
		t.Fatal("missing deletion tombstone")
	}
	must(t, worker.Run(context.Background(), f.runDir(), "one"))
	must(t, worker.MarkFailed(f.runDir(), "one", "late worker"))
	if exists(worker.StatePath(f.runDir(), "one")) {
		t.Fatal("resurrected deleted state")
	}
	snapshot, err := loadSnapshot(f.runDir())
	must(t, err)
	if len(snapshot.Models) != 1 {
		t.Fatal("snapshot retained deleted model")
	}
	must(t, DeleteModel(context.Background(), f.runDir(), "two"))
	if exists(f.runDir()) {
		t.Fatal("last model left empty run")
	}
	index, err := config.LoadRunsIndex()
	must(t, err)
	if len(index.Runs) != 0 {
		t.Fatal("deleted run retained index")
	}
	must(t, worker.MarkFailed(f.runDir(), "two", "late worker"))
	if exists(f.runDir()) {
		t.Fatal("late failure recreated deleted run")
	}
}

func TestDeletionRejectsSymlinksAndForgedPaths(t *testing.T) {
	for _, target := range []string{"run", "run-trailing-slash", "model", "dangling-model", "state", "metadata", "snapshot", "index", "snapshot-path", "project-path", "root-path", "unindexed"} {
		t.Run(target, func(t *testing.T) {
			f := newFixture(t)
			draft := f.draft("model", "other")
			draft.Heavy = true
			f.saveDraft(draft)
			must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"model", "other"}}))
			outside := filepath.Join(f.home, "outside")
			must(t, os.MkdirAll(outside, 0700))
			must(t, os.WriteFile(filepath.Join(outside, "sentinel"), []byte("safe"), 0600))
			dir := f.runDir()
			switch target {
			case "run", "run-trailing-slash":
				dir = filepath.Join(f.root, "alias")
				must(t, os.Symlink(f.runDir(), dir))
				if target == "run-trailing-slash" {
					dir += string(filepath.Separator)
				}
			case "model":
				must(t, os.Symlink(outside, filepath.Join(dir, "model")))
			case "dangling-model":
				must(t, os.Symlink(filepath.Join(outside, "absent"), filepath.Join(dir, "model")))
			case "state":
				path := worker.StatePath(dir, "model")
				must(t, os.Rename(path, filepath.Join(outside, "model.yaml")))
				must(t, os.Symlink(filepath.Join(outside, "model.yaml"), path))
			case "metadata":
				path := filepath.Join(dir, ".automator")
				must(t, os.Rename(path, filepath.Join(outside, "metadata")))
				must(t, os.Symlink(filepath.Join(outside, "metadata"), path))
			case "snapshot":
				path := filepath.Join(dir, "run.yaml")
				must(t, os.Rename(path, filepath.Join(outside, "run.yaml")))
				must(t, os.Symlink(filepath.Join(outside, "run.yaml"), path))
			case "index":
				path := filepath.Join(config.HomeDir(), "runs-index.yaml")
				must(t, os.Rename(path, filepath.Join(outside, "index.yaml")))
				must(t, os.Symlink(filepath.Join(outside, "index.yaml"), path))
			case "snapshot-path":
				snapshot, err := loadSnapshot(dir)
				must(t, err)
				snapshot.RunDir = outside
				must(t, persistence.SaveYAML(filepath.Join(dir, "run.yaml"), snapshot))
			case "project-path":
				state, err := worker.LoadState(dir, "model")
				must(t, err)
				state.ProjectPath = outside
				must(t, worker.SaveState(dir, "model", state))
			case "root-path":
				snapshot, err := loadSnapshot(dir)
				must(t, err)
				snapshot.Root = dir
				must(t, persistence.SaveYAML(filepath.Join(dir, "run.yaml"), snapshot))
			case "unindexed":
				must(t, config.SaveRunsIndex(config.RunsIndex{SchemaVersion: 1, Runs: []config.RunIndexEntry{}}))
			}
			if err := DeleteModel(context.Background(), dir, "model"); err == nil {
				t.Fatal("unsafe model deletion accepted")
			}
			if err := DeleteRun(context.Background(), dir); err == nil {
				t.Fatal("unsafe run deletion accepted")
			}
			if readText(t, filepath.Join(outside, "sentinel")) != "safe" || !exists(f.runDir()) {
				t.Fatal("unsafe deletion changed files")
			}
		})
	}
}

func TestHeadfulPausedTabsDispatchAndAttach(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("one", "two")
	draft.Mode, draft.Heavy = config.Headful, true
	f.saveDraft(draft)
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"one", "two"}}))
	one, err := worker.LoadState(f.runDir(), "one")
	must(t, err)
	if one.Status != worker.Paused || one.HerdrTabID == nil || *one.HerdrTabID != "root-tab" {
		t.Fatalf("bad paused tab: %+v", one)
	}
	must(t, StartModel(context.Background(), f.runDir(), "one", false))
	waitState(t, f.runDir(), "one", worker.Done)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	must(t, Attach(context.Background(), f.runDir(), "one"))
	calls := readText(t, filepath.Join(f.events, "herdr.jsonl"))
	if !strings.Contains(calls, `["tab","rename","root-tab","one"]`) || !strings.Contains(calls, `["session","attach","Automator"]`) {
		t.Fatal(calls)
	}
	t.Setenv("EXECUTOR_TEST_HERDR_FAIL", "1")
	if err := StartModel(context.Background(), f.runDir(), "two", false); err == nil {
		t.Fatal("Herdr failure lost")
	}
	state, err := worker.LoadState(f.runDir(), "two")
	must(t, err)
	if state.Status != worker.Failed {
		t.Fatal("failed dispatch not synthesized")
	}
	must(t, report.Write(f.runDir()))
}

func TestHeadfulSchedulerAndWarmupFailure(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("one", "two")
	draft.Mode, draft.Concurrency = config.Headful, 1
	f.saveDraft(draft)
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"one", "two"}}))
	for _, key := range []string{"one", "two"} {
		waitState(t, f.runDir(), key, worker.Done)
	}
	start, _ := strconv.ParseInt(readText(t, filepath.Join(f.events, "two.start")), 10, 64)
	finish, _ := strconv.ParseInt(readText(t, filepath.Join(f.events, "one.finish")), 10, 64)
	if start < finish {
		t.Fatal("headful concurrency exceeded")
	}
	models, err := config.Models()
	must(t, err)
	model := models.Models["one"]
	model.Tool = config.Opencode
	models.Models["one"] = model
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	t.Setenv("EXECUTOR_TEST_WARMUP_FAIL", "1")
	if err := RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"one"}}); err == nil {
		t.Fatal("warmup failure ignored")
	}
	if exists(filepath.Join(f.root, "example-run-v2")) {
		t.Fatal("warmup failure created run")
	}
}

func TestIndexTransactionsAcrossIndependentRoots(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("model")
	draft.Heavy = true
	for i := 0; i < 6; i++ {
		name := fmt.Sprintf("draft-%d", i)
		draft.Root = filepath.Join(f.root, name)
		must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "drafts", name, "v1.yaml"), draft))
	}
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		go func(i int) {
			errs <- RunDraft(context.Background(), fmt.Sprintf("draft-%d", i), config.ModelSelection{Models: []string{"model"}})
		}(i)
	}
	for i := 0; i < 6; i++ {
		must(t, <-errs)
	}
	index, err := config.LoadRunsIndex()
	must(t, err)
	if len(index.Runs) != 6 {
		t.Fatalf("concurrent roots lost index entries: %d", len(index.Runs))
	}
}

func TestStaleHerdrSnapshotCannotRestoreDeletedModels(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("one", "two")
	draft.Heavy = true
	f.saveDraft(draft)
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"one", "two"}}))
	snapshot, err := loadSnapshot(f.runDir())
	must(t, err)
	must(t, DeleteModel(context.Background(), f.runDir(), "two"))
	must(t, dispatchHerdr(context.Background(), &snapshot, "", "", ""))
	snapshot, err = loadSnapshot(f.runDir())
	must(t, err)
	if _, exists := snapshot.Models["two"]; exists {
		t.Fatal("Herdr restored a deleted snapshot model")
	}
	if exists(worker.StatePath(f.runDir(), "two")) {
		t.Fatal("Herdr restored a deleted model state")
	}
}
