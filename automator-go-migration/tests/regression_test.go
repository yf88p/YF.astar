//go:build unix

package tests

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type scenario struct {
	name string
	run  func(*testing.T, *fixture) map[string]any
}

// These seven scenarios deliberately retain every assertion from basic.rs.
var basicScenarios = []scenario{
	{"validate_and_run_headless_with_fake_pi", headlessScenario},
	{"failed_worker_still_runs_post_each", failureScenario},
	{"cancellation_exit_130_skips_post_each", cancellationScenario},
	{"parallel_pi_sessions_are_correlated_by_project_dir", parallelScenario},
	{"heavy_headless_run_pauses_by_default_and_run_heavy_executes", heavyScenario},
	{"runtime_models_can_be_selected_with_presets", presetsScenario},
	{"validate_rejects_unsafe_model_keys", unsafeScenario},
}

func TestNativeRegression(t *testing.T) {
	for _, test := range basicScenarios {
		t.Run(test.name, func(t *testing.T) { test.run(t, newFixture(t, goBinary)) })
	}
}

func headlessScenario(t *testing.T, f *fixture) map[string]any {
	f.draft("demo", "Demo Run", "")
	validation := f.ok("validate", "demo", "--model", "fake-pi")
	if !strings.Contains(validation.stdout, "fake-pi") {
		t.Fatal(validation)
	}
	f.exists(f.root, false)
	f.exists(filepath.Join(f.dir, "agent-calls"), false)
	run := f.ok("run", "demo", "--model", "fake-pi")
	dir := filepath.Join(f.root, "demo-run")
	f.exists(filepath.Join(dir, "run.yaml"), true)
	if prompt := f.text(filepath.Join(dir, "prompt.md")); prompt != "test prompt" {
		t.Fatalf("prompt = %q", prompt)
	}
	f.exists(filepath.Join(dir, "fake-pi", ".git"), true)
	state := f.state("demo-run", "fake-pi", "done")
	requireFields(t, state, map[string]any{"model": "fake-pi", "provider": "anthropic", "tool": "pi", "native_session_id": "sid_fake", "input_tokens": 7, "output_tokens": 5, "total_tokens": 12, "cost": 0.03, "tool_version": "pi 0.test", "error": nil})
	assertTerminalMetadata(t, state)
	for _, needle := range []string{"fake-pi", "sid_fake", "$0.0300"} {
		if !strings.Contains(f.text(filepath.Join(dir, "report.md")), needle) {
			t.Errorf("report missing %q", needle)
		}
	}
	argv := f.text(filepath.Join(dir, "fake-pi", "agent-argv.txt"))
	for _, arg := range []string{"--print\n", "--provider\nanthropic\n", "--approve\n", "@" + filepath.Join(dir, "prompt.md")} {
		if !strings.Contains(argv, arg) {
			t.Errorf("Pi argv missing %q: %s", arg, argv)
		}
	}
	obs := f.capture("demo-run")
	obs["validate"] = f.output(validation, "validate")
	obs["run"] = f.output(run, "run")
	obs["report-command"] = f.output(f.ok("report", "demo-run"), "report")
	return obs
}

func failureScenario(t *testing.T, f *fixture) map[string]any {
	f.models("fail-pi", "good-pi")
	f.draft("failure", "Failure Run", "pre:\n  - shell: printf 'pre\\n' >> hooks.txt\npost_each:\n  - shell: printf 'post_each\\n' >> hooks.txt; printf post_each > post_each.txt\npost_all:\n  - shell: printf post_all > post_all.txt\n")
	run := f.ok("run", "failure", "--model", "fail-pi,good-pi")
	dir := filepath.Join(f.root, "failure-run")
	for _, key := range []string{"fail-pi", "good-pi"} {
		if hooks := f.text(filepath.Join(dir, key, "hooks.txt")); hooks != "pre\npost_each\n" {
			t.Errorf("%s hooks = %q; post_each must run exactly once", key, hooks)
		}
		f.exists(filepath.Join(dir, key, "post_each.txt"), true)
	}
	f.exists(filepath.Join(dir, "post_all.txt"), true)
	failed := f.state("failure-run", "fail-pi", "failed")
	requireFields(t, failed, map[string]any{"native_session_id": "sid_failed", "input_tokens": 11, "output_tokens": 13, "total_tokens": 24, "cost": 0.07})
	if !strings.Contains(fmt.Sprint(failed["error"]), "42") {
		t.Errorf("worker failure must retain exit 42: %v", failed)
	}
	assertTerminalMetadata(t, failed)
	f.state("failure-run", "good-pi", "done")
	obs := f.capture("failure-run")
	obs["run"] = f.output(run, "run")
	return obs
}

func cancellationScenario(t *testing.T, f *fixture) map[string]any {
	f.models("cancel-pi")
	f.draft("cancel", "Cancel Run", "post_each:\n  - shell: printf should-not-run > post_each.txt\n")
	run := f.ok("run", "cancel", "--model", "cancel-pi")
	state := f.state("cancel-run", "cancel-pi", "cancelled")
	assertTerminalMetadata(t, state)
	requireFields(t, state, map[string]any{"native_session_id": "sid_cancel", "total_tokens": 12, "cost": 0.03})
	f.exists(filepath.Join(f.root, "cancel-run", "cancel-pi", "post_each.txt"), false)
	obs := f.capture("cancel-run")
	obs["run"] = f.output(run, "run")
	return obs
}

func parallelScenario(t *testing.T, f *fixture) map[string]any {
	f.models("alpha-pi", "beta-pi")
	f.draft("parallel", "Parallel Run", "")
	run := f.ok("run", "parallel", "--model", "alpha-pi,beta-pi")
	alpha := f.state("parallel-run", "alpha-pi", "done")
	beta := f.state("parallel-run", "beta-pi", "done")
	requireFields(t, alpha, map[string]any{"native_session_id": "sid_alpha", "input_tokens": 101, "output_tokens": 11, "total_tokens": 112})
	requireFields(t, beta, map[string]any{"native_session_id": "sid_beta", "input_tokens": 202, "output_tokens": 22, "total_tokens": 224})
	obs := f.capture("parallel-run")
	obs["run"] = f.output(run, "run")
	return obs
}

func heavyScenario(t *testing.T, f *fixture) map[string]any {
	f.draft("heavy", "Heavy Run", "heavy: true\npre:\n  - shell: printf pre > pre.txt\npost_each:\n  - shell: printf post_each > post_each.txt\n")
	run := f.ok("run", "heavy", "--model", "fake-pi")
	dir := filepath.Join(f.root, "heavy-run")
	paused := f.state("heavy-run", "fake-pi", "paused")
	requireFields(t, paused, map[string]any{"started_at": nil, "finished_at": nil, "native_session_id": nil})
	f.exists(filepath.Join(f.dir, "agent-calls"), false)
	f.exists(filepath.Join(dir, "fake-pi", "pre.txt"), false)
	initial := f.capture("heavy-run")
	start := f.ok("start", "heavy-run", "fake-pi")
	f.state("heavy-run", "fake-pi", "done")
	f.exists(filepath.Join(dir, "fake-pi", "post_each.txt"), true)
	if invalid := f.run("start", "heavy-run", "fake-pi"); invalid.code == 0 {
		t.Fatalf("starting a terminal state without --force succeeded: %s", invalid)
	}
	// A fresh retry must move the old tree, not merely rerun in it.
	f.write(filepath.Join(dir, "fake-pi", "old-work.txt"), "preserve me")
	retry := f.ok("retry", "heavy-run", "fake-pi")
	f.state("heavy-run", "fake-pi", "done")
	f.exists(filepath.Join(dir, "fake-pi", "old-work.txt"), false)
	backups, err := os.ReadDir(filepath.Join(dir, ".automator", "retry-backups"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("retry backups = %v, %v", backups, err)
	}
	backup := filepath.Join(dir, ".automator", "retry-backups", backups[0].Name())
	if text := f.text(filepath.Join(backup, "old-work.txt")); text != "preserve me" {
		t.Fatalf("lost previous project: %q", text)
	}
	f.exists(filepath.Join(backup, ".git"), true)
	runHeavy := f.ok("run", "heavy", "--model", "fake-pi", "--run-heavy")
	f.state("heavy-run-v2", "fake-pi", "done")
	requireFields(t, f.yaml(filepath.Join(f.root, "heavy-run-v2", "run.yaml")), map[string]any{"heavy": false, "name": "heavy-run-v2"})
	requireFields(t, f.yaml(filepath.Join(dir, "run.yaml")), map[string]any{"heavy": true, "name": "heavy-run"})
	index := f.yaml(filepath.Join(f.app, "runs-index.yaml"))["runs"].([]any)
	if len(index) != 2 {
		t.Errorf("start/retry must not register additional runs: %v", index)
	}
	if calls := strings.Fields(f.text(filepath.Join(f.dir, "agent-calls"))); len(calls) != 3 {
		t.Errorf("expected start, retry, and --run-heavy only: %v", calls)
	}
	// Manual actions are asynchronous; refresh only after terminal-state polling.
	f.ok("report-refresh", "--run", dir)
	obs := f.capture("heavy-run", "heavy-run-v2")
	obs["initial"] = initial
	obs["run"] = f.output(run, "run")
	obs["start"] = f.output(start, "start")
	obs["retry"] = f.output(retry, "retry")
	obs["run-heavy"] = f.output(runHeavy, "run")
	return obs
}

func presetsScenario(t *testing.T, f *fixture) map[string]any {
	f.models("qwen", "deepseek", "claude")
	f.write(filepath.Join(f.app, "model-presets.yaml"), "schema_version: 1\npresets:\n  open-models:\n    display_name: Open models\n    models: [qwen, deepseek, qwen]\n")
	f.draft("runtime", "Runtime Model Run", "")
	missing := f.run("validate", "runtime")
	if missing.code == 0 || !strings.Contains(missing.stderr, "no models selected") {
		t.Fatal(missing)
	}
	args := []string{"runtime", "--preset", "open-models", "--model", "claude,qwen", "--model", "claude"}
	validation := f.ok(append([]string{"validate"}, args...)...)
	for _, key := range []string{"qwen", "deepseek", "claude"} {
		if !strings.Contains(validation.stdout, key) {
			t.Errorf("validation missing %s: %s", key, validation)
		}
	}
	run := f.ok(append([]string{"run"}, args...)...)
	for _, key := range []string{"qwen", "deepseek", "claude"} {
		f.exists(filepath.Join(f.root, "runtime-model-run", key), true)
		f.state("runtime-model-run", key, "done")
	}
	if calls := strings.Fields(f.text(filepath.Join(f.dir, "agent-calls"))); len(calls) != 3 {
		t.Errorf("presets and explicit selections must deduplicate: %v", calls)
	}
	obs := f.capture("runtime-model-run")
	obs["missing"] = f.output(missing, "validate")
	obs["validate"] = f.output(validation, "validate")
	obs["run"] = f.output(run, "run")
	obs["models"] = f.output(f.ok("models"), "models")
	obs["presets"] = f.output(f.ok("presets"), "presets")
	return obs
}

func unsafeScenario(t *testing.T, f *fixture) map[string]any {
	f.models("../escape")
	f.draft("escape", "Escape Run", "")
	r := f.run("validate", "escape", "--model", "../escape")
	if r.code == 0 || !strings.Contains(r.stderr, "unsafe model key") {
		t.Fatal(r)
	}
	f.exists(f.root, false)
	f.exists(filepath.Join(f.dir, "agent-calls"), false)
	return map[string]any{"validate": f.output(r, "validate")}
}

func assertTerminalMetadata(t *testing.T, state map[string]any) {
	t.Helper()
	for _, key := range []string{"started_at", "finished_at", "duration_seconds"} {
		if state[key] == nil {
			t.Errorf("terminal state lacks %s: %v", key, state)
		}
	}
	if state["native_session_id"] != nil && !strings.Contains(fmt.Sprint(state["native_reopen"]), fmt.Sprint(state["native_session_id"])) {
		t.Errorf("native reopen does not contain captured session: %v", state)
	}
}

type invalidCase struct {
	name, file, text, needle string
	selection                []string
}

func invalidCases() []invalidCase {
	cases := []invalidCase{
		{name: "missing-selection", needle: "no models selected", selection: []string{}},
		{name: "unknown-model", needle: "model not found", selection: []string{"--model", "missing"}},
		{name: "unknown-preset", needle: "model preset not found", selection: []string{"--preset", "missing"}},
		{name: "unsafe-preset", needle: "unsafe model preset key", selection: []string{"--preset", "../escape"}},
		{name: "empty-preset", file: "model-presets.yaml", text: "schema_version: 1\npresets:\n  empty:\n    display_name: Empty\n    models: []\n", needle: "no models selected", selection: []string{"--preset", "empty"}},
		{name: "unsafe-preset-member", file: "model-presets.yaml", text: "schema_version: 1\npresets:\n  bad:\n    display_name: Bad\n    models: ['../escape']\n", needle: "unsafe model key", selection: []string{"--preset", "bad"}},
		{name: "unknown-preset-member", file: "model-presets.yaml", text: "schema_version: 1\npresets:\n  bad:\n    display_name: Bad\n    models: [missing]\n", needle: "model not found", selection: []string{"--preset", "bad"}},
		{name: "missing-provider", file: "providers.yaml", text: "schema_version: 1\nproviders: {}\n", needle: "provider not found"},
		{name: "missing-template", file: "templates.yaml", text: "schema_version: 1\ntemplates: {}\n", needle: "template not found"},
		{name: "malformed-yaml", file: "models.yaml", text: "schema_version: 1\nmodels: [unterminated\n", needle: ""},
	}
	for i, key := range []string{".", "..", "../escape", "/absolute", "nested/model", `bad\key`} {
		cases = append(cases, invalidCase{name: fmt.Sprintf("unsafe-model-%d", i), needle: "unsafe model key", selection: []string{"--model", key}})
	}
	for _, file := range []string{"providers.yaml", "models.yaml", "templates.yaml", "model-presets.yaml", "drafts/invalid/v1.yaml"} {
		cases = append(cases, invalidCase{name: "schema-" + strings.ReplaceAll(file, "/", "-"), file: file, needle: "schema_version"})
	}
	model := "schema_version: 1\nmodels:\n  fake-pi:\n    display_name: Fake\n    tool: pi\n    provider: anthropic\n    model: test\n"
	cases = append(cases,
		invalidCase{name: "unsupported-arg", file: "models.yaml", text: model + "    args: {execute: bad}\n", needle: "unsupported tool arg"},
		invalidCase{name: "negative-pricing", file: "models.yaml", text: model + "    pricing: {input_per_million: -1, output_per_million: 0, cache_read_per_million: 0, cache_write_per_million: 0}\n", needle: "finite non-negative"},
		invalidCase{name: "infinite-pricing", file: "models.yaml", text: model + "    pricing: {input_per_million: .inf, output_per_million: 0, cache_read_per_million: 0, cache_write_per_million: 0}\n", needle: "finite non-negative"},
		invalidCase{name: "unknown-tool", file: "models.yaml", text: strings.Replace(model, "tool: pi", "tool: unsafe", 1), needle: ""},
	)
	return cases
}

func validationFailure(t *testing.T, f *fixture, test invalidCase) map[string]any {
	f.draft("invalid", "Invalid Run", "")
	if test.file != "" {
		path := filepath.Join(f.app, test.file)
		text := test.text
		if text == "" {
			text = strings.Replace(f.text(path), "schema_version: 1", "schema_version: 99", 1)
		}
		f.write(path, text)
	}
	selection := test.selection
	if selection == nil {
		selection = []string{"--model", "fake-pi"}
	}
	obs := map[string]any{}
	for _, verb := range []string{"validate", "run"} {
		r := f.run(append([]string{verb, "invalid"}, selection...)...)
		if r.code == 0 || !strings.Contains(r.stderr, test.needle) {
			t.Fatalf("%s must reject %s (%s): %s", verb, test.name, test.needle, r)
		}
		obs[verb] = f.output(r, verb)
	}
	f.exists(f.root, false)
	f.exists(filepath.Join(f.dir, "agent-calls"), false)
	if runs := f.yaml(filepath.Join(f.app, "runs-index.yaml"))["runs"].([]any); len(runs) != 0 {
		t.Errorf("invalid draft registered a run: %v", runs)
	}
	return obs
}

func TestNativeValidationFailures(t *testing.T) {
	for _, test := range invalidCases() {
		t.Run(test.name, func(t *testing.T) { validationFailure(t, newFixture(t, goBinary), test) })
	}
}

func TestNativeReservedModelPaths(t *testing.T) {
	// These are intentional native safety checks, not unsafe Rust executions:
	// the old reference accepts some metadata-colliding model names.
	for _, key := range []string{".automator", ".automator-locks", "run.yaml", "prompt.md", "report.md"} {
		t.Run(key, func(t *testing.T) {
			f := newFixture(t, goBinary)
			f.models(key)
			validationFailure(t, f, invalidCase{name: key, needle: "conflicts with run metadata", selection: []string{"--model", key}})
		})
	}
}

func TestNativeMissingBinaryAndLatestDraft(t *testing.T) {
	f := newFixture(t, goBinary)
	f.draft("latest", "Old Run", "")
	path := filepath.Join(f.app, "drafts", "latest", "v1.yaml")
	f.write(filepath.Join(f.app, "drafts", "latest", "v2.yaml"), strings.Replace(f.text(path), "Old Run", "Version Two", 1))
	f.write(filepath.Join(f.app, "drafts", "latest", "v10.yaml"), strings.Replace(f.text(path), "Old Run", "Version Ten", 1))
	if err := os.Remove(filepath.Join(f.bin, "pi")); err != nil {
		t.Fatal(err)
	}
	r := f.ok("validate", "latest", "--model", "fake-pi")
	for _, needle := range []string{"version-ten", "missing: pi"} {
		if !strings.Contains(r.stdout, needle) {
			t.Errorf("validation must select numeric latest and report the missing binary: %s", r)
		}
	}
	if r := f.run("run", "latest", "--model", "fake-pi"); r.code == 0 || !strings.Contains(r.stderr, "required binary not found") {
		t.Fatal(r)
	}
	f.exists(f.root, false)
	f.exists(filepath.Join(f.dir, "agent-calls"), false)
}

func TestNativePiSingleUncorrelatedSessionFallback(t *testing.T) {
	f := newFixture(t, goBinary)
	f.draft("fallback", "Fallback Run", "")
	// Keep basic.rs's original session-without-cwd shape as well as the
	// correlated fixtures used by the stronger parallel and lifecycle cases.
	f.script("pi", `if [ "${1:-}" = "--version" ]; then printf '%s\n' 'pi 0.test'; exit 0; fi
mkdir -p "$PI_CODING_AGENT_SESSION_DIR/cwd"
printf '%s\n' '{"message":{"usage":{"input":7,"output":5,"totalTokens":12,"cost":{"total":0.03}}}}' > "$PI_CODING_AGENT_SESSION_DIR/cwd/20260101_sid_fake.jsonl"
`)
	f.ok("run", "fallback", "--model", "fake-pi")
	requireFields(t, f.state("fallback-run", "fake-pi", "done"), map[string]any{"native_session_id": "sid_fake", "input_tokens": 7, "output_tokens": 5, "total_tokens": 12, "cost": 0.03})
}
