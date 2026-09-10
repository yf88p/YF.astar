package adapter

import (
	"context"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"automator/internal/config"
	"automator/internal/util"
)

// Every test that discovers sessions or invokes a tool replaces all relevant
// roots and PATH. No test can reach an installed agent or a user's sessions.
func isolatedHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_SESSION_DIR", filepath.Join(home, ".pi", "agent", "sessions"))
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(home, ".claude"))
	t.Setenv("PATH", filepath.Join(home, "bin"))
	return home
}

func writeFixture(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}

func fakeTool(t *testing.T, home, name, script string) {
	t.Helper()
	path := filepath.Join(home, "bin", name)
	writeFixture(t, path, "#!/bin/sh\n"+script+"\n")
	if err := os.Chmod(path, 0o700); err != nil {
		t.Fatal(err)
	}
}

func TestBuildAndContinueCommands(t *testing.T) {
	home := isolatedHome(t)
	project := filepath.Join(home, "project with ' quotes")
	if err := os.MkdirAll(project, 0o700); err != nil {
		t.Fatal(err)
	}
	promptPath := filepath.Join(home, "prompt with ' quotes.md")
	prompt := "fix it; $(touch should-not-exist)\nkeep this newline\n"
	writeFixture(t, promptPath, prompt)
	title := "run:opus-5"
	for _, tc := range []struct {
		tool   config.Tool
		args   map[string]any
		want   []string
		resume []string
	}{
		{config.Pi, map[string]any{"thinking": "high", "approve": true, "session_dir": "~/raw path"},
			[]string{"--print", "--provider", "anthropic", "--model", "claude-opus-5", "--name", title, "--thinking", "high", "--approve", "--session-dir", "~/raw path", "@" + promptPath}, nil},
		{config.Opencode, map[string]any{"agent": "build", "variant": "max", "thinking": true, "format": "json", "dangerously_skip_permissions": true},
			[]string{"run", "--model", "anthropic/claude-opus-5", "--title", title, "--dir", project, "--agent", "build", "--variant", "max", "--thinking", "--dangerously-skip-permissions", prompt},
			[]string{"run", "--session", "1234", "--model", "anthropic/claude-opus-5", "--dir", project, "--agent", "build", "--variant", "max", "--thinking", "--dangerously-skip-permissions", "continue"}},
		{config.Claude, map[string]any{"effort": "max", "dangerously_skip_permissions": true},
			[]string{"--print", "--model", "claude-opus-5", "--name", title, "--effort", "max", "--dangerously-skip-permissions", prompt},
			[]string{"--print", "--resume", "1234", "--model", "claude-opus-5", "--effort", "max", "--dangerously-skip-permissions", "continue"}},
	} {
		t.Run(string(tc.tool), func(t *testing.T) {
			model := config.Model{Tool: tc.tool, Provider: "anthropic", Model: "claude-opus-5", Args: tc.args}
			command, err := BuildCommand(model, project, promptPath, title)
			if err != nil {
				t.Fatal(err)
			}
			if command.Program != string(tc.tool) || !reflect.DeepEqual(command.Args, tc.want) || len(command.Env) != 0 {
				t.Fatalf("command = %#v; want args %#v", command, tc.want)
			}
			preview, err := BuildCommandWithPrompt(model, project, promptPath, prompt, title)
			if err != nil || !reflect.DeepEqual(preview, command) {
				t.Fatalf("preview and execution builders differ: %#v, %v", preview, err)
			}
			fakeTool(t, home, command.Program, `printf '%s\000' "$@" > "$ADAPTER_ARGV_FILE"
printf '%s' "$PWD" > "$ADAPTER_CWD_FILE"`)
			argvPath, cwdPath := filepath.Join(home, "argv"), filepath.Join(home, "cwd")
			t.Setenv("ADAPTER_ARGV_FILE", argvPath)
			t.Setenv("ADAPTER_CWD_FILE", cwdPath)
			cmd := exec.CommandContext(context.Background(), command.Program, command.Args...)
			cmd.Dir = project
			cmd.Env = append(os.Environ(), command.Env...)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("fake command: %v: %s", err, output)
			}
			got, err := os.ReadFile(argvPath)
			if err != nil || string(got) != strings.Join(tc.want, "\x00")+"\x00" {
				t.Fatalf("actual argv = %q, error %v", got, err)
			}
			cwd, err := os.ReadFile(cwdPath)
			if err != nil || string(cwd) != project {
				t.Fatalf("actual cwd = %q, error %v", cwd, err)
			}
			resumed, err := ContinueCommand(model, project, "1234", "continue")
			if tc.resume == nil {
				if err == nil || err.Error() != "continue/nudge is not implemented for pi sessions yet" {
					t.Fatalf("Pi continue error = %v", err)
				}
			} else if err != nil || !reflect.DeepEqual(resumed.Args, tc.resume) {
				t.Fatalf("resume = %#v, error %v; want %#v", resumed, err, tc.resume)
			}
		})
	}
}

func TestBuildCommandWithPromptDoesNotAccessFiles(t *testing.T) {
	home := isolatedHome(t)
	project := filepath.Join(home, "uncreated", "project")
	paths := []string{
		filepath.Join(project, "prompt.md"),
		home, // Reading a directory as a prompt would fail.
		filepath.Join(home, "auth.json"),
		"invalid\x00path",
	}
	for _, tool := range []config.Tool{config.Pi, config.Opencode, config.Claude} {
		for _, path := range paths {
			model := config.Model{Tool: tool, Provider: "provider's", Model: "model's"}
			command, err := BuildCommandWithPrompt(model, project, path, "supplied prompt's\n", "title's")
			if err != nil {
				t.Fatalf("%s preview accessed %q: %v", tool, path, err)
			}
			want := "supplied prompt's\n"
			if tool == config.Pi {
				want = "@" + path
			}
			if got := command.Args[len(command.Args)-1]; got != want {
				t.Fatalf("prompt arg = %q, want %q", got, want)
			}
			model.Args = map[string]any{"unsupported": true}
			if _, err := BuildCommandWithPrompt(model, project, path, "", ""); err == nil || !strings.Contains(err.Error(), "unsupported tool arg") {
				t.Fatalf("%s preview skipped validation: %v", tool, err)
			}
		}
	}
	entries, err := os.ReadDir(home)
	if err != nil || len(entries) != 0 {
		t.Fatalf("preview created files: %v, %v", entries, err)
	}
}

func TestStructuredCommandSecretRedaction(t *testing.T) {
	for _, assignment := range []string{
		`API_KEY='FAKE_LEFT FAKE_RIGHT'`,
		`API_KEY="FAKE_LEFT'FAKE_RIGHT"`,
		`API_KEY="FAKE_LEFT' FAKE_RIGHT"`,
		`API_KEY='FAKE_LEFT'\''FAKE_RIGHT'`,
		`API_KEY=FAKE_LEFT\'FAKE_RIGHT`,
		`API_KEY="FAKE_LEFT; FAKE_RIGHT"`,
		`API_KEY=FAKE_LEFT'FAKE_RIGHT'`,
	} {
		for _, tool := range []config.Tool{config.Pi, config.Opencode, config.Claude} {
			for _, field := range []string{"provider", "model", "title", "prompt"} {
				model := config.Model{Tool: tool, Provider: "provider's", Model: "model's"}
				prompt, title := "prompt's", "title's"
				switch field {
				case "provider":
					model.Provider = assignment
				case "model":
					model.Model = assignment
				case "title":
					title = assignment
				case "prompt":
					prompt = assignment
				}
				command, err := BuildCommandWithPrompt(model, "project's", "prompt's.md", prompt, title)
				if err != nil {
					t.Fatal(err)
				}
				if !(tool == config.Claude && field == "provider") && !(tool == config.Pi && field == "prompt") && !strings.Contains(strings.Join(command.Args, "\x00"), assignment) {
					t.Fatalf("%s %s: builder changed the original argument", tool, field)
				}
				quoted := []string{command.Program}
				for _, arg := range command.Args {
					quoted = append(quoted, util.ShellQuote(arg))
				}
				display := util.RedactSecrets(strings.Join(quoted, " "))
				if strings.Contains(display, "FAKE_LEFT") || strings.Contains(display, "FAKE_RIGHT") {
					t.Errorf("%s %s %q: secret fragments leaked: %s", tool, field, assignment, display)
				}
				label := util.RedactSecrets(ModelKeyDisplay("key's", model))
				if strings.Contains(label, "FAKE_LEFT") || strings.Contains(label, "FAKE_RIGHT") {
					t.Errorf("%s %s %q: label secret fragments leaked: %s", tool, field, assignment, label)
				}
			}
		}
	}
}

func TestCommandArgumentCoercionAndPromptErrors(t *testing.T) {
	model := config.Model{Tool: config.Pi, Args: map[string]any{"thinking": false, "approve": "true", "session_dir": 123}}
	cmd, err := BuildCommand(model, "/project", "/nonexistent/prompt", "title")
	if err != nil || !reflect.DeepEqual(cmd.Args, []string{"--print", "--provider", "", "--model", "", "--name", "title", "--thinking", "false", "@/nonexistent/prompt"}) {
		t.Fatalf("coercion: %#v, %v", cmd, err)
	}
	for _, tool := range []config.Tool{config.Opencode, config.Claude} {
		if _, err := BuildCommand(config.Model{Tool: tool}, "", filepath.Join(t.TempDir(), "missing"), ""); err == nil {
			t.Errorf("%s accepted an unreadable prompt", tool)
		}
	}
	cmd, err = ContinueCommand(config.Model{Tool: config.Opencode, Args: map[string]any{"agent": true, "variant": 42, "thinking": "true"}}, "p", "s", "m")
	if err != nil || !reflect.DeepEqual(cmd.Args, []string{"run", "--session", "s", "--model", "/", "--dir", "p", "--agent", "true", "m"}) {
		t.Fatalf("OpenCode coercion: %#v, %v", cmd, err)
	}
}

func TestValidateModel(t *testing.T) {
	for _, tool := range []config.Tool{config.Pi, config.Opencode, config.Claude} {
		if err := ValidateModel("valid", config.Model{Tool: tool}); err != nil {
			t.Fatal(err)
		}
		model := config.Model{Tool: tool, Args: map[string]any{"z_unknown": true, "a_unknown": true}}
		if err := ValidateModel("key", model); err == nil || err.Error() != "model key: unsupported tool arg: a_unknown" {
			t.Fatalf("whitelist error = %v", err)
		}
		if _, err := BuildCommand(model, "", "", ""); err == nil {
			t.Fatal("build skipped validation")
		}
		if _, err := ContinueCommand(model, "", "", ""); err == nil {
			t.Fatal("continue skipped validation")
		}
	}
	for _, field := range []string{"input_per_million", "output_per_million", "cache_read_per_million", "cache_write_per_million"} {
		for _, rate := range []float64{-1, math.NaN(), math.Inf(1), math.Inf(-1)} {
			pricing := &config.ModelPricing{}
			switch field {
			case "input_per_million":
				pricing.InputPerMillion = rate
			case "output_per_million":
				pricing.OutputPerMillion = rate
			case "cache_read_per_million":
				pricing.CacheReadPerMillion = rate
			case "cache_write_per_million":
				pricing.CacheWritePerMillion = rate
			}
			err := ValidateModel("", config.Model{Tool: config.Pi, Pricing: pricing})
			if err == nil || err.Error() != "pricing."+field+" must be a finite non-negative number" {
				t.Fatalf("%s = %v: %v", field, rate, err)
			}
		}
	}
	if err := ValidateModel("", config.Model{Tool: "unknown"}); err == nil {
		t.Fatal("accepted unknown tool")
	}
	if err := ValidateModel("", config.Model{Tool: config.Claude, Pricing: &config.ModelPricing{InputPerMillion: 3}, Args: map[string]any{"effort": []any{1}}}); err != nil {
		t.Fatalf("Rust permits unusable values for known options: %v", err)
	}
}

func TestReopenShellQuoting(t *testing.T) {
	for _, tc := range []struct {
		tool config.Tool
		flag string
	}{{config.Pi, "--session"}, {config.Opencode, "--session"}, {config.Claude, "--resume"}} {
		model := config.Model{Tool: tc.tool}
		got := ReopenCommand(model, "/tmp/run dir/it's", "sid;rm -rf /")
		want := "cd '/tmp/run dir/it'\\''s' && " + string(tc.tool) + " " + tc.flag + " 'sid;rm -rf /'"
		if got != want {
			t.Fatalf("reopen = %q; want %q", got, want)
		}
		for _, invalid := range []string{"", "sid\nnext", "sid\rnext", "sid\x00next"} {
			if got := ReopenCommand(model, "/tmp", invalid); !strings.HasSuffix(got, "'<session-id>'") {
				t.Fatalf("invalid ID not replaced: %q", got)
			}
		}
	}
	if got := ModelKeyDisplay("key", config.Model{Provider: "provider", Model: "model"}); got != "key (provider/model)" {
		t.Fatal(got)
	}
	if ToolBinary("unknown") != "" {
		t.Fatal("unknown tool has executable")
	}
}

func TestInstalledVersion(t *testing.T) {
	home := isolatedHome(t)
	for _, tool := range []config.Tool{config.Pi, config.Opencode, config.Claude} {
		if got := InstalledVersion(context.Background(), tool); got != nil {
			t.Fatalf("unavailable tool has version %q", *got)
		}
		fakeTool(t, home, string(tool), `test "$#" = 1 && test "$1" = --version || exit 7
printf '  fake-1.2\n'`)
		if got := InstalledVersion(context.Background(), tool); got == nil || *got != "fake-1.2" {
			t.Fatalf("version = %v", got)
		}
		fakeTool(t, home, string(tool), "exit 2")
		if got := InstalledVersion(context.Background(), tool); got != nil {
			t.Fatalf("failed tool has version %q", *got)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if InstalledVersion(ctx, config.Pi) != nil || InstalledVersion(context.Background(), "unknown") != nil {
		t.Fatal("cancelled/unknown version lookup succeeded")
	}
}
