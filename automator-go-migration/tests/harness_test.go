//go:build unix

// Package tests exercises the built CLI, never a developer's agents or sessions.
// Run with: go test -count=1 ./tests
// Parity is mandatory in migration CI: AUTOMATOR_REQUIRE_PARITY=1 go test -count=1 ./tests
// The default reference is the absolute module-root/.automator-reference/automator-rust.
// AUTOMATOR_RUST_REFERENCE may name another absolute reference executable. Only
// absence skips parity; a broken reference or a semantic mismatch fails the test.
package tests

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	"go.yaml.in/yaml/v3"
	_ "modernc.org/sqlite"
)

var goBinary, moduleRoot string

func TestMain(m *testing.M) {
	// The Rust adapter invokes sqlite3. This tiny read-only stand-in uses the
	// same synthetic DB as Go, without requiring sqlite3 on the host.
	if len(os.Args) > 1 && os.Args[1] == "--fixture-sqlite" {
		if err := fixtureSQLite(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	code := func() int {
		cwd, err := os.Getwd()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		moduleRoot = filepath.Dir(cwd)
		buildDir, err := os.MkdirTemp("", "automator-e2e-build-")
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		defer os.RemoveAll(buildDir)
		goBinary = filepath.Join(buildDir, "automator")
		goTool := filepath.Join(runtime.GOROOT(), "bin", "go")
		if info, err := os.Stat(goTool); err != nil || info.IsDir() {
			goTool, err = exec.LookPath("go")
			if err != nil {
				fmt.Fprintln(os.Stderr, "locate Go via runtime.GOROOT or PATH:", err)
				return 1
			}
		}
		// Reuse only Go's module/build caches, not the caller's HOME or agent env.
		home, _ := os.UserHomeDir()
		cache, _ := os.UserCacheDir()
		modCache := os.Getenv("GOMODCACHE")
		if modCache == "" {
			modCache = filepath.Join(home, "go", "pkg", "mod")
		}
		buildCache := os.Getenv("GOCACHE")
		if buildCache == "" {
			buildCache = filepath.Join(cache, "go-build")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, goTool, "build", "-o", goBinary, "./cmd/automator")
		cmd.Dir = moduleRoot
		cmd.Env = []string{
			"PATH=" + filepath.Dir(goTool) + ":/usr/bin:/bin", "HOME=" + buildDir,
			"AUTOMATOR_HOME=" + filepath.Join(buildDir, "automator-home"),
			"XDG_DATA_HOME=" + filepath.Join(buildDir, "data"),
			"XDG_CONFIG_HOME=" + filepath.Join(buildDir, "config"),
			"PI_CODING_AGENT_SESSION_DIR=" + filepath.Join(buildDir, "pi"),
			"CLAUDE_CONFIG_DIR=" + filepath.Join(buildDir, "claude"),
			"GOMODCACHE=" + modCache, "GOCACHE=" + buildCache,
			"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null",
			"GOTOOLCHAIN=local", "GOENV=off", "GOFLAGS=-mod=readonly", "GOPROXY=off", "GOSUMDB=off",
		}
		if out, err := cmd.CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "canonical CLI build failed (cmd/automator and dependencies must be ready): %v\n%s", err, out)
			return 1
		}
		return m.Run()
	}()
	os.Exit(code)
}

type fixture struct {
	t                   *testing.T
	dir, home, app, bin string
	root, exe           string
	env                 map[string]string
}

func newFixture(t *testing.T, exe string) *fixture {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "fixture space")
	f := &fixture{t: t, dir: dir, home: filepath.Join(dir, "home"), app: filepath.Join(dir, "automator-home"), bin: filepath.Join(dir, "bin"), root: filepath.Join(dir, "runs"), exe: exe}
	for _, path := range []string{f.home, f.app, f.bin, filepath.Join(dir, "tmp")} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	testExe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately do not inherit os.Environ: this drops every HERDR_* route,
	// credential, config override, shell startup file and agent server URL.
	f.env = map[string]string{
		"HOME": f.home, "AUTOMATOR_HOME": f.app, "PATH": f.bin,
		"XDG_DATA_HOME":               filepath.Join(f.home, ".local", "share"),
		"XDG_CONFIG_HOME":             filepath.Join(f.home, ".config"),
		"XDG_CACHE_HOME":              filepath.Join(f.home, ".cache"),
		"XDG_STATE_HOME":              filepath.Join(f.home, ".local", "state"),
		"XDG_RUNTIME_DIR":             filepath.Join(dir, "tmp"),
		"PI_CODING_AGENT_SESSION_DIR": filepath.Join(f.home, ".pi", "agent", "sessions"),
		"PI_CODING_AGENT_DIR":         filepath.Join(f.home, ".pi", "agent"),
		"CLAUDE_CONFIG_DIR":           filepath.Join(f.home, ".claude"),
		"SHELL":                       filepath.Join(f.bin, "fixture-shell"), "TMPDIR": filepath.Join(dir, "tmp"),
		"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": filepath.Join(dir, "gitconfig"),
		"GIT_ATTR_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0",
		"GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
		"GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
		"LC_ALL": "C", "TZ": "UTC", "TERM": "dumb", "NO_COLOR": "1",
		"AUTOMATOR_TEST_ROOT": dir, "AUTOMATOR_TEST_BINARY": testExe,
	}
	f.write(filepath.Join(dir, "gitconfig"), "[init]\n\tdefaultBranch = main\n")
	// No real coding agent, multiplexer, browser, or sqlite3 can be resolved.
	// Only ordinary shell utilities and git are permitted on the fixture PATH.
	for _, name := range []string{"git", "mkdir", "basename", "sleep", "cp", "touch", "kill", "env"} {
		var target string
		for _, base := range []string{"/usr/bin", "/bin"} {
			candidate := filepath.Join(base, name)
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				target = candidate
				break
			}
		}
		if target == "" {
			t.Fatalf("required fixture utility %s is unavailable", name)
		}
		if err := os.Symlink(target, filepath.Join(f.bin, name)); err != nil {
			t.Fatal(err)
		}
	}
	f.script("fixture-shell", `if [ "$1" = "-lc" ]; then shift; exec /bin/sh -c "$@"; fi
exec /bin/sh "$@"
`)
	f.script("pi", fakePi)
	f.script("opencode", fakeOpenCode)
	f.script("claude", "exit 97\n")
	f.script("herdr", "printf '%s\\n' 'unexpected fake herdr invocation' >&2\nexit 98\n")
	f.script("playwright-cli", "printf '%s\\n' '{\"browsers\":[]}'\n")
	f.script("sqlite3", "exec \"$AUTOMATOR_TEST_BINARY\" --fixture-sqlite \"$@\"\n")
	f.write(filepath.Join(f.app, "config.yaml"), "schema_version: 1\ndefault_concurrency: 6\n")
	f.write(filepath.Join(f.app, "providers.yaml"), "schema_version: 1\nproviders:\n  anthropic:\n    display_name: Anthropic\n    auth: external\n")
	f.write(filepath.Join(f.app, "templates.yaml"), "schema_version: 1\ntemplates:\n  empty:\n    display_name: Empty\n    steps: []\n")
	f.write(filepath.Join(f.app, "model-presets.yaml"), "schema_version: 1\npresets: {}\n")
	f.write(filepath.Join(f.app, "runs-index.yaml"), "schema_version: 1\nruns: []\n")
	f.models("fake-pi")
	return f
}

func (f *fixture) write(path, text string) {
	f.t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) script(name, body string) {
	f.t.Helper()
	path := filepath.Join(f.bin, name)
	f.write(path, "#!/bin/sh\nset -eu\n"+body)
	if err := os.Chmod(path, 0700); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) models(keys ...string) {
	f.t.Helper()
	text := "schema_version: 1\nmodels:\n"
	for _, key := range keys {
		text += fmt.Sprintf("  %q:\n    display_name: %q\n    tool: pi\n    provider: anthropic\n    model: test-model\n    args:\n      approve: true\n", key, key)
	}
	f.write(filepath.Join(f.app, "models.yaml"), text)
}

func (f *fixture) draft(key, name, extra string) {
	f.t.Helper()
	f.write(filepath.Join(f.app, "drafts", key, "v1.yaml"), fmt.Sprintf("schema_version: 1\nname: %s\nroot: %q\nconcurrency: 2\nmode: headless\ntemplate: empty\nprompt: test prompt\n%s", name, f.root, extra))
}

type result struct {
	stdout, stderr string
	code           int
}

func (r result) String() string {
	return fmt.Sprintf("exit=%d\nstdout:\n%s\nstderr:\n%s", r.code, r.stdout, r.stderr)
}

func (f *fixture) command(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, f.exe, args...)
	cmd.Dir = f.dir
	keys := make([]string, 0, len(f.env))
	for key := range f.env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		cmd.Env = append(cmd.Env, key+"="+f.env[key])
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = time.Second
	return cmd
}

func (f *fixture) run(args ...string) result {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := f.command(ctx, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	r := result{stdout: stdout.String(), stderr: stderr.String()}
	if ctx.Err() != nil {
		f.t.Fatalf("CLI timed out: %v\n%s", args, r)
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		r.code = exit.ExitCode()
	} else if err != nil {
		f.t.Fatalf("launch %v: %v", args, err)
	}
	return r
}

func (f *fixture) ok(args ...string) result {
	f.t.Helper()
	r := f.run(args...)
	if r.code != 0 {
		f.t.Fatalf("%v: %s", args, r)
	}
	return r
}

func (f *fixture) text(path string) string {
	f.t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		f.t.Fatal(err)
	}
	return string(b)
}

func (f *fixture) yaml(path string) map[string]any {
	f.t.Helper()
	var value map[string]any
	if err := yaml.Unmarshal([]byte(f.text(path)), &value); err != nil {
		f.t.Fatalf("decode %s: %v", path, err)
	}
	return value
}

func (f *fixture) state(run, key, status string) map[string]any {
	f.t.Helper()
	path := filepath.Join(f.root, run, ".automator", "state", key+".yaml")
	deadline := time.Now().Add(8 * time.Second)
	var state map[string]any
	var lastErr error
	for time.Now().Before(deadline) {
		b, err := os.ReadFile(path)
		lastErr = err
		if err == nil {
			state = nil
			lastErr = yaml.Unmarshal(b, &state)
			if lastErr == nil && state["status"] == status {
				return state
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	f.t.Fatalf("waiting for %s = %s: state=%v err=%v", path, status, state, lastErr)
	return nil
}

func (f *fixture) exists(path string, want bool) {
	f.t.Helper()
	_, err := os.Stat(path)
	if want && err != nil || !want && !errors.Is(err, os.ErrNotExist) {
		f.t.Fatalf("exists(%s) want %t: %v", path, want, err)
	}
}

func requireFields(t *testing.T, got map[string]any, want map[string]any) {
	t.Helper()
	for key, value := range want {
		if number, ok := value.(float64); ok {
			if actual, ok := got[key].(float64); ok && math.Abs(actual-number) < 1e-10 {
				continue
			}
		}
		if fmt.Sprint(got[key]) != fmt.Sprint(value) {
			t.Errorf("%s = %#v, want %#v (state: %v)", key, got[key], value, got)
		}
	}
}

const fakePi = `if [ "${1:-}" = "--version" ]; then printf '%s\n' 'pi 0.test'; exit 0; fi
base="${PWD##*/}"
printf '%s\n' "$@" > "$PWD/agent-argv.txt"
printf '%s\n' "$base" >> "$AUTOMATOR_TEST_ROOT/agent-calls"
sid=sid_fake; input=7; output=5; cost=0.03
case "$base" in
  fail-pi) sid=sid_failed; input=11; output=13; cost=0.07 ;;
  alpha-pi) sid=sid_alpha; input=101; output=11; cost=0.01 ;;
  beta-pi) sid=sid_beta; input=202; output=22; cost=0.01; sleep 0.2 ;;
  cancel-pi) sid=sid_cancel ;;
esac
dir="$PI_CODING_AGENT_SESSION_DIR/$base"
mkdir -p "$dir"
printf '{"type":"session","cwd":"%s"}\n' "$PWD" > "$dir/20260101_$sid.jsonl"
printf '{"message":{"usage":{"input":%s,"output":%s,"totalTokens":%s,"cost":{"total":%s}}}}\n' "$input" "$output" "$((input + output))" "$cost" >> "$dir/20260101_$sid.jsonl"
case "$base" in
  alpha-pi) sleep 0.5 ;;
  fail-pi) exit 42 ;;
  cancel-pi) exit 130 ;;
esac
exit 0
`

const fakeOpenCode = `if [ "${1:-}" = "--version" ]; then printf '%s\n' 'opencode 0.test'; exit 0; fi
if [ "${1:-}" != "run" ]; then exit 0; fi
printf '%s\n' "$@" > "$PWD/agent-argv.txt"
printf '%s\n' "${PWD##*/}" >> "$AUTOMATOR_TEST_ROOT/agent-calls"
case " $* " in
  *" --session "*) exit 0 ;;
esac
if [ -f "$AUTOMATOR_TEST_ROOT/session-fixture.db" ]; then
  mkdir -p "$XDG_DATA_HOME/opencode"
  cp "$AUTOMATOR_TEST_ROOT/session-fixture.db" "$XDG_DATA_HOME/opencode/opencode.db"
fi
exit "${FAKE_OPENCODE_EXIT:-0}"
`

func fixtureSQLite(args []string) error {
	if len(args) != 5 || args[0] != "-readonly" || args[1] != "-batch" || args[2] != "-noheader" {
		return fmt.Errorf("unexpected sqlite fixture arguments: %q", args)
	}
	path, err := filepath.EvalSymlinks(args[3])
	if err != nil {
		return err
	}
	root := os.Getenv("AUTOMATOR_TEST_ROOT")
	rel, err := filepath.Rel(root, path)
	if root == "" || err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("refusing SQLite outside fixture")
	}
	uri := url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return err
	}
	defer db.Close()
	rows, err := db.Query(args[4])
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var text sql.NullString
		if err := rows.Scan(&text); err != nil {
			return err
		}
		fmt.Println(text.String)
	}
	return rows.Err()
}

func TestFixtureEnvironmentIsIsolated(t *testing.T) {
	// Poison the caller's environment with synthetic values, never real secrets.
	for _, key := range []string{"HERDR_SESSION", "HERDR_SOCKET_PATH", "HERDR_ENV", "HERDR_PANE_ID", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENCODE_SERVER_URL", "BASH_ENV", "ENV", "AUTOMATOR_TEST_HOST_TOKEN"} {
		t.Setenv(key, "fixture-must-not-inherit")
	}
	f := newFixture(t, goBinary)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := f.command(ctx, "models")
	for _, item := range cmd.Env {
		if strings.HasPrefix(item, "HERDR_") || strings.Contains(item, "fixture-must-not-inherit") {
			t.Errorf("caller environment leaked: %s", item)
		}
	}
	for _, key := range []string{"HOME", "AUTOMATOR_HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_CODING_AGENT_DIR", "CLAUDE_CONFIG_DIR", "TMPDIR", "PATH", "SHELL", "GIT_CONFIG_GLOBAL"} {
		if !strings.HasPrefix(f.env[key], f.dir+string(filepath.Separator)) {
			t.Errorf("%s is not isolated inside the fixture: %s", key, f.env[key])
		}
	}
	f.ok("models")
}
