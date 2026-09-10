//go:build unix

package tests

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"automator/internal/persistence"
	"automator/internal/worker"
)

func (f *fixture) openCodeModel() {
	f.write(filepath.Join(f.app, "models.yaml"), "schema_version: 1\nmodels:\n  fake-oc:\n    display_name: Fake OpenCode\n    tool: opencode\n    provider: anthropic\n    model: test-model\n")
}

func (f *fixture) sqlite(path, run string, parts bool) {
	f.t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		f.t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		f.t.Fatal(err)
	}
	defer db.Close()
	for _, query := range []string{
		"create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, version text)",
		"create table message (id text primary key, session_id text, time_created integer, data text)",
		"create table part (id text primary key, message_id text, session_id text, time_created integer, data text)",
	} {
		if _, err := db.Exec(query); err != nil {
			f.t.Fatal(err)
		}
	}
	project, title := filepath.Join(f.root, run, "fake-oc"), run+":fake-oc"
	now := time.Now().UnixMilli()
	for _, row := range []struct{ id, parent, directory, title string }{
		{"ses_fixture", "", project, title},
		{"ses_child", "ses_fixture", project, "subagent"},
		{"ses_decoy", "", project, "wrong-title"},
		{"ses_foreign", "", filepath.Join(f.dir, "unrelated-project"), title},
	} {
		if _, err := db.Exec("insert into session values (?, ?, ?, ?, ?, ?, ?)", row.id, row.parent, row.directory, row.title, now, now, "opencode 0.fixture"); err != nil {
			f.t.Fatal(err)
		}
	}
	for i, row := range []struct{ session, usage string }{
		{"ses_fixture", `"input":10,"output":2,"reasoning":3,"cache":{"read":4,"write":5},"total":24`},
		{"ses_child", `"input":20,"output":7,"reasoning":0,"cache":{"read":8,"write":1},"total":36`},
		{"ses_decoy", `"input":999,"output":999,"total":1998`},
		{"ses_foreign", `"input":888,"output":888,"total":1776`},
	} {
		cost := 0.05
		if i == 1 {
			cost = 0.07
		}
		data := fmt.Sprintf(`{"role":"assistant","providerID":"anthropic","modelID":"test-model","tokens":{%s},"cost":%g}`, row.usage, cost)
		message := fmt.Sprintf("message-%d", i)
		if parts {
			data = `{"role":"assistant","providerID":"anthropic","modelID":"test-model"}`
		}
		if _, err := db.Exec("insert into message values (?, ?, ?, ?)", message, row.session, now+int64(i), data); err != nil {
			f.t.Fatal(err)
		}
		if parts {
			part := fmt.Sprintf(`{"type":"step-finish","tokens":{%s},"cost":%g}`, row.usage, cost)
			if _, err := db.Exec("insert into part values (?, ?, ?, ?, ?)", fmt.Sprintf("part-%d", i), message, row.session, now+int64(i), part); err != nil {
				f.t.Fatal(err)
			}
		}
	}
	// User messages must not contribute to usage even if they contain tokens.
	if _, err := db.Exec("insert into message values (?, ?, ?, ?)", "user", "ses_fixture", now, `{"role":"user","tokens":{"input":9999,"output":9999},"cost":99}`); err != nil {
		f.t.Fatal(err)
	}
}

func assertOpenCodeMetrics(t *testing.T, state map[string]any) {
	t.Helper()
	requireFields(t, state, map[string]any{"native_session_id": "ses_fixture", "input_tokens": 30, "output_tokens": 9, "reasoning_tokens": 3, "cache_read_tokens": 12, "cache_write_tokens": 6, "total_tokens": 60, "cost": 0.12, "tool_version": "opencode 0.fixture", "error": nil})
	assertTerminalMetadata(t, state)
}

func openCodeScenario(t *testing.T, f *fixture) map[string]any {
	f.openCodeModel()
	f.draft("sqlite", "SQLite Run", "")
	f.sqlite(filepath.Join(f.dir, "session-fixture.db"), "sqlite-run", false)
	r := f.ok("run", "sqlite", "--model", "fake-oc")
	assertOpenCodeMetrics(t, f.state("sqlite-run", "fake-oc", "done"))
	obs := f.capture("sqlite-run")
	obs["run"] = f.output(r, "run")
	return obs
}

func TestNativeOpenCodeSQLite(t *testing.T) {
	t.Run("messages-and-descendants", func(t *testing.T) { openCodeScenario(t, newFixture(t, goBinary)) })
	t.Run("parts-fallback", func(t *testing.T) {
		f := newFixture(t, goBinary)
		f.openCodeModel()
		f.draft("parts", "Parts Run", "")
		f.sqlite(filepath.Join(f.dir, "session-fixture.db"), "parts-run", true)
		f.ok("run", "parts", "--model", "fake-oc")
		assertOpenCodeMetrics(t, f.state("parts-run", "fake-oc", "done"))
	})
}

func recoveryScenario(t *testing.T, f *fixture) map[string]any {
	f.openCodeModel()
	f.env["FAKE_OPENCODE_EXIT"] = "42"
	f.draft("recover", "Recover Run", "pre:\n  - shell: printf 'pre\\n' >> hooks.txt\npost_each:\n  - shell: printf 'post_each\\n' >> hooks.txt\n")
	f.ok("run", "recover", "--model", "fake-oc")
	failed := f.state("recover-run", "fake-oc", "failed")
	requireFields(t, failed, map[string]any{"native_session_id": nil})
	missing := f.run("continue", "recover-run", "fake-oc")
	if missing.code == 0 || !strings.Contains(missing.stderr, "native session") {
		t.Fatalf("continuation without a recoverable session must fail: %s", missing)
	}
	f.state("recover-run", "fake-oc", "failed")
	// Recovery must find the exact project+title and include its subagent, not
	// the equally recent same-project or same-title decoys.
	f.sqlite(filepath.Join(f.env["XDG_DATA_HOME"], "opencode", "opencode.db"), "recover-run", false)
	message := "keep literal $(touch INJECTED); do not rerun hooks"
	r := f.ok("continue", "recover-run", "fake-oc", message)
	state := f.state("recover-run", "fake-oc", "done")
	assertOpenCodeMetrics(t, state)
	dir := filepath.Join(f.root, "recover-run")
	if hooks := f.text(filepath.Join(dir, "fake-oc", "hooks.txt")); hooks != "pre\npost_each\n" {
		t.Errorf("continue reran hooks: %q", hooks)
	}
	args := f.text(filepath.Join(dir, "fake-oc", "agent-argv.txt"))
	if !strings.Contains(args, "--session\nses_fixture\n") || !strings.HasSuffix(args, message+"\n") {
		t.Errorf("wrong native continuation argv: %s", args)
	}
	f.exists(filepath.Join(dir, "fake-oc", "INJECTED"), false)
	f.exists(filepath.Join(dir, ".automator", "retry-backups"), false)
	if calls := strings.Fields(f.text(filepath.Join(f.dir, "agent-calls"))); len(calls) != 2 {
		t.Errorf("unexpected tool executions: %v", calls)
	}
	f.ok("report-refresh", "--run", dir)
	obs := f.capture("recover-run")
	obs["missing-session"] = f.output(missing, "continue")
	obs["continue"] = f.output(r, "continue")
	return obs
}

func TestNativeSessionRecovery(t *testing.T) {
	recoveryScenario(t, newFixture(t, goBinary))
}

func TestNativePiContinuationIsSafelyRejected(t *testing.T) {
	f := newFixture(t, goBinary)
	f.draft("pi", "Pi Run", "")
	f.ok("run", "pi", "--model", "fake-pi")
	before := f.state("pi-run", "fake-pi", "done")
	r := f.run("continue", "pi-run", "fake-pi", "continue")
	if r.code == 0 || !strings.Contains(r.stderr, "not implemented") {
		t.Fatal(r)
	}
	after := f.state("pi-run", "fake-pi", "done")
	requireFields(t, after, before)
	if calls := strings.Fields(f.text(filepath.Join(f.dir, "agent-calls"))); len(calls) != 1 {
		t.Errorf("unsupported continuation invoked Pi: %v", calls)
	}
}

func TestNativeWorkerLocksAndStop(t *testing.T) {
	f := newFixture(t, goBinary)
	f.draft("locked", "Locked Run", "heavy: true\npost_each:\n  - shell: printf forbidden > post_each.txt\n")
	// Keep the worker alive only inside its owned process group, with a bounded
	// fallback lifetime even if a regression prevents stop from working.
	f.script("pi", strings.Replace(fakePi, "exit 0\n", `printf ready > "$AUTOMATOR_TEST_ROOT/ready"
n=0
while [ "$n" -lt 100 ]; do sleep 0.1; n=$((n + 1)); done
exit 0
`, 1))
	f.ok("run", "locked", "--model", "fake-pi")
	dir := filepath.Join(f.root, "locked-run")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	cmd := f.command(ctx, "worker", "--run", dir, "--model", "fake-pi")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	f.state("locked-run", "fake-pi", "running")
	waitFile(t, filepath.Join(f.dir, "ready"))
	for _, args := range [][]string{
		{"worker", "--run", dir, "--model", "fake-pi"},
		{"start", "locked-run", "fake-pi"},
		{"start", "locked-run", "fake-pi", "--force"},
		{"retry", "locked-run", "fake-pi", "--force"},
		{"continue", "locked-run", "fake-pi", "--force"},
	} {
		if r := f.run(args...); r.code == 0 {
			t.Errorf("concurrent action was accepted: %v: %s", args, r)
		}
		f.state("locked-run", "fake-pi", "running")
	}
	// Failed-launch bookkeeping must not overwrite the actual live worker.
	f.ok("worker-failed", "--run", dir, "--model", "fake-pi", "--error", "duplicate rejected")
	f.state("locked-run", "fake-pi", "running")
	f.ok("stop", "locked-run", "fake-pi")
	state := f.state("locked-run", "fake-pi", "cancelled")
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("stop left the worker process alive")
	}
	requireFields(t, state, map[string]any{"native_session_id": "sid_fake", "total_tokens": 12, "cost": 0.03})
	f.exists(filepath.Join(dir, "fake-pi", "post_each.txt"), false)
	f.ok("worker-failed", "--run", dir, "--model", "fake-pi", "--error", "late launcher error")
	requireFields(t, f.state("locked-run", "fake-pi", "cancelled"), state)
	if calls := strings.Fields(f.text(filepath.Join(f.dir, "agent-calls"))); len(calls) != 1 {
		t.Errorf("duplicate workers escaped the lifetime lock: %v", calls)
	}
	if r := f.run("stop", "locked-run", "fake-pi"); r.code == 0 {
		t.Errorf("stop accepted terminal state: %s", r)
	}
}

func TestNativeTransitionLocksSerializeWorker(t *testing.T) {
	for _, kind := range []string{"run", "model"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t, goBinary)
			f.draft("lock", "Lock Run", "heavy: true\n")
			f.ok("run", "lock", "--model", "fake-pi")
			dir := filepath.Join(f.root, "lock-run")
			path := worker.RunLockPath(dir)
			if kind == "model" {
				path = worker.ModelLockPath(dir, "fake-pi")
			}
			unlock, err := persistence.Lock(context.Background(), path)
			if err != nil {
				t.Fatal(err)
			}
			defer unlock()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			cmd := f.command(ctx, "worker", "--run", dir, "--model", "fake-pi")
			if err := cmd.Start(); err != nil {
				cancel()
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			defer cancel()
			select {
			case err := <-done:
				t.Fatalf("worker bypassed held %s transition lock: %v", kind, err)
			case <-time.After(150 * time.Millisecond):
			}
			f.state("lock-run", "fake-pi", "paused")
			f.exists(filepath.Join(f.dir, "agent-calls"), false)
			unlock()
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			f.state("lock-run", "fake-pi", "done")
		})
	}
}

func waitFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for fixture marker %s", path)
}

func herdrScenario(t *testing.T, f *fixture) map[string]any {
	f.script("herdr", fakeHerdr)
	f.models("alpha-pi", "beta-pi")
	f.draft("headful", "Headful Run", "heavy: true\n")
	path := filepath.Join(f.app, "drafts", "headful", "v1.yaml")
	f.write(path, strings.Replace(f.text(path), "mode: headless", "mode: headful", 1))
	r := f.ok("run", "headful", "--model", "alpha-pi,beta-pi")
	alpha := f.state("headful-run", "alpha-pi", "paused")
	beta := f.state("headful-run", "beta-pi", "paused")
	for _, state := range []map[string]any{alpha, beta} {
		requireFields(t, state, map[string]any{"herdr_session": "Automator", "herdr_workspace_id": "fixture-workspace", "native_session_id": nil, "tmux_attach": nil})
		if state["herdr_tab_id"] == nil || state["herdr_pane_id"] == nil {
			t.Errorf("paused model has no durable Herdr target: %v", state)
		}
	}
	if alpha["herdr_tab_id"] == beta["herdr_tab_id"] || alpha["herdr_pane_id"] == beta["herdr_pane_id"] {
		t.Errorf("models shared Herdr targets: alpha=%v beta=%v", alpha, beta)
	}
	f.ok("attach", "headful-run", "beta-pi")
	log := f.text(filepath.Join(f.dir, "herdr-calls"))
	for _, needle := range []string{"workspace create", "tab create", "pane run", "workspace focus fixture-workspace", "tab focus", "session attach Automator"} {
		if !strings.Contains(log, needle) {
			t.Errorf("Herdr fixture missing %q:\n%s", needle, log)
		}
	}
	f.exists(filepath.Join(f.dir, "agent-calls"), false)
	obs := f.capture("headful-run")
	obs["run"] = f.output(r, "run")
	return obs
}

func TestNativeHerdrFixtures(t *testing.T) {
	herdrScenario(t, newFixture(t, goBinary))
}

const fakeHerdr = `if [ -n "${HERDR_SOCKET_PATH:-}${HERDR_PANE_ID:-}${HERDR_ENV:-}" ]; then
  printf '%s\n' 'unsafe Herdr routing leaked into fixture' >&2; exit 96
fi
# Rust routes interactive attach by argv rather than HERDR_SESSION.
if [ "$1 $2 ${3:-}" != 'session attach Automator' ] && [ "${HERDR_SESSION:-}" != Automator ]; then
  printf '%s\n' 'unexpected Herdr session' >&2; exit 96
fi
printf '%s\n' "$*" >> "$AUTOMATOR_TEST_ROOT/herdr-calls"
case "$1 $2" in
  'status server') printf '%s\n' '{"ok":true}' ;;
  'workspace list') printf '%s\n' '{"result":{"workspaces":[{"workspace_id":"fixture-workspace"}]}}' ;;
  'workspace create') printf '%s\n' '{"result":{"workspace":{"workspace_id":"fixture-workspace"},"tab":{"tab_id":"fixture:root"},"root_pane":{"pane_id":"fixture-root"}}}' ;;
  'tab create') printf '%s\n' '{"result":{"tab":{"tab_id":"fixture:second"},"root_pane":{"pane_id":"fixture-second"}}}' ;;
  'tab rename'|'pane run'|'workspace focus'|'tab focus'|'session attach') printf '%s\n' '{"ok":true}' ;;
  *) printf 'unexpected fake Herdr command: %s\n' "$*" >&2; exit 95 ;;
esac
`
