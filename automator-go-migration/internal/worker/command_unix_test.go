//go:build unix

package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"automator/internal/adapter"
	"automator/internal/config"
	"automator/internal/persistence"
)

func TestCommandHelper(t *testing.T) {
	mode := os.Getenv("AUTOMATOR_WORKER_TEST_HELPER")
	if mode == "" {
		return
	}
	switch mode {
	case "environment":
		cwd, _ := os.Getwd()
		data, _ := json.Marshal([]string{cwd, os.Getenv("AUTOMATOR_WORKER_VALUE"), strings.Join(os.Args, "|")})
		if os.WriteFile("result.json", data, 0o600) != nil {
			os.Exit(2)
		}
	case "exit":
		code, _ := strconv.Atoi(os.Getenv("AUTOMATOR_WORKER_EXIT"))
		os.Exit(code)
	case "signal-worker":
		dir := os.Getenv("AUTOMATOR_WORKER_DIR")
		deps := isolatedDependencies()
		deps.agent = func(ctx context.Context, _ string, _ adapter.Command) error {
			if err := os.WriteFile(filepath.Join(dir, "ready"), []byte("ready"), 0o600); err != nil {
				return err
			}
			<-ctx.Done()
			return ctx.Err()
		}
		if err := execute(context.Background(), dir, "model", nil, deps); errors.Is(err, context.Canceled) {
			os.Exit(130)
		}
		os.Exit(3)
	}
	os.Exit(0)
}

func helperCommand(t *testing.T, mode string) adapter.Command {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return adapter.Command{
		Program: executable, Args: []string{"-test.run=^TestCommandHelper$", "--", "literal ; $(not-executed) 'arg'"},
		Env: []string{"AUTOMATOR_WORKER_TEST_HELPER=" + mode},
	}
}

func TestRunCommandEnvironmentAndArguments(t *testing.T) {
	t.Setenv("AUTOMATOR_WORKER_VALUE", "inherited")
	dir := t.TempDir()
	command := helperCommand(t, "environment")
	command.Env = append(command.Env, "AUTOMATOR_WORKER_VALUE=override")
	if err := runCommand(context.Background(), dir, command); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "result.json"))
	if err != nil {
		t.Fatal(err)
	}
	var result []string
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 3 || result[0] != dir || result[1] != "override" || !strings.Contains(result[2], command.Args[2]) {
		t.Fatalf("result = %v", result)
	}
}

func TestAgentExitCancellation(t *testing.T) {
	for _, code := range []int{0, 9, 130, 143} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			runDir, _ := fixture(t)
			deps := isolatedDependencies()
			command := helperCommand(t, "exit")
			command.Env = append(command.Env, fmt.Sprintf("AUTOMATOR_WORKER_EXIT=%d", code))
			deps.build = func(config.Model, string, string, string) (adapter.Command, error) { return command, nil }
			deps.agent = runCommand
			err := execute(context.Background(), runDir, "model", nil, deps)
			if errors.Is(err, context.Canceled) != (code == 130 || code == 143) {
				t.Fatalf("exit %d = %v", code, err)
			}
			state, loadErr := LoadState(runDir, "model")
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			want := Done
			if code == 9 {
				want = Failed
			}
			if code == 130 || code == 143 {
				want = Cancelled
			}
			if state.Status != want {
				t.Fatalf("status = %s", state.Status)
			}
		})
	}
}

func TestWorkerHandlesSignals(t *testing.T) {
	for _, sig := range []syscall.Signal{syscall.SIGINT, syscall.SIGTERM} {
		t.Run(sig.String(), func(t *testing.T) {
			runDir, _ := fixture(t)
			command := helperCommand(t, "signal-worker")
			cmd := exec.Command(command.Program, command.Args...)
			cmd.Env = append(os.Environ(), command.Env...)
			cmd.Env = append(cmd.Env, "AUTOMATOR_WORKER_DIR="+runDir)
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { _ = cmd.Process.Kill() }()
			wait := make(chan error, 1)
			go func() { wait <- cmd.Wait() }()
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(filepath.Join(runDir, "ready")); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("signal helper did not start")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if err := cmd.Process.Signal(sig); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-wait:
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != 130 {
					t.Fatalf("worker signal error = %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("worker ignored signal")
			}
			state, err := LoadState(runDir, "model")
			if err != nil {
				t.Fatal(err)
			}
			if state.Status != Cancelled {
				t.Fatalf("status = %s", state.Status)
			}
		})
	}
}

func TestPlaywrightCleanupClosesOnlyExactWorkspace(t *testing.T) {
	root := t.TempDir()
	bin, project, other := filepath.Join(root, "bin"), filepath.Join(root, "model"), filepath.Join(root, "other")
	for _, dir := range []string{bin, project, other} {
		if err := os.Mkdir(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	list := fmt.Sprintf(`{"browsers":[{"name":"ours;literal","workspace":%q},{"name":"theirs","workspace":%q},{"name":"nested","workspace":%q}]}`, project, other, filepath.Join(project, "child"))
	if err := os.WriteFile(filepath.Join(project, "list.json"), []byte(list), 0o600); err != nil {
		t.Fatal(err)
	}
	// A private executable fixture, never the installed Playwright CLI.
	script := "#!/bin/sh\nif [ \"$1\" = list ]; then /bin/cat list.json; else printf '%s\\n' \"$1\" \"$2\" >> closed; fi\n"
	if err := os.WriteFile(filepath.Join(bin, "playwright-cli"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	cleanupPlaywrightSessions(context.Background(), project)
	closed, err := os.ReadFile(filepath.Join(project, "closed"))
	if err != nil {
		t.Fatal(err)
	}
	if string(closed) != "-s=ours;literal\nclose\n" {
		t.Fatalf("closed = %s", closed)
	}
	if err := persistence.WriteFile(filepath.Join(project, "list.json"), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	cleanupPlaywrightSessions(context.Background(), project)
	after, err := os.ReadFile(filepath.Join(project, "closed"))
	if err != nil || string(after) != string(closed) {
		t.Fatal("invalid JSON triggered cleanup")
	}
}

func TestPublicRunAndContinueWithPrivateExecutables(t *testing.T) {
	runDir, snapshot := fixture(t)
	bin, home := filepath.Join(t.TempDir(), "bin"), t.TempDir()
	if err := os.Mkdir(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	for name, script := range map[string]string{
		"shell":    "#!/bin/sh\nexec /bin/sh -c \"$2\"\n",
		"git":      "#!/bin/sh\nprintf '%s\\n' \"$*\" >> git.log\n",
		"opencode": "#!/bin/sh\nif [ \"$1\" = --version ]; then printf 'fixture-version\\n'; else printf '%s\\n' \"$@\" >> agent.log; fi\n",
	} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("HOME", home)
	t.Setenv("XDG_DATA_HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("PATH", bin)
	t.Setenv("SHELL", filepath.Join(bin, "shell"))
	snapshot.Template.Steps = []config.ShellStep{{Shell: "printf 'template\\n' >> hooks.log"}}
	snapshot.Pre = []config.ShellStep{{Shell: "printf 'pre\\n' >> hooks.log"}}
	snapshot.PostEach = []config.ShellStep{{Shell: "printf 'post\\n' >> hooks.log"}}
	writeSnapshot(t, runDir, snapshot)
	if err := os.WriteFile(filepath.Join(runDir, "prompt.md"), []byte("literal prompt 'quoted'"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Run(context.Background(), runDir, "model"); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(runDir, "model")
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != Done || state.ToolVersion == nil || *state.ToolVersion != "fixture-version" {
		t.Fatalf("native adapter state = %+v", state)
	}
	state.NativeSessionID = pointer("fixture-session")
	if err := SaveState(runDir, "model", state); err != nil {
		t.Fatal(err)
	}
	if err := Continue(context.Background(), runDir, "model", "continue literal ; message"); err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(runDir, "model")
	hooks, err := os.ReadFile(filepath.Join(project, "hooks.log"))
	if err != nil || string(hooks) != "template\npre\npost\n" {
		t.Fatalf("hooks = %s: %v", hooks, err)
	}
	gitLog, err := os.ReadFile(filepath.Join(project, "git.log"))
	if err != nil || strings.Count(string(gitLog), "\n") != 3 || !strings.Contains(string(gitLog), "commit --allow-empty -m Automator baseline") {
		t.Fatalf("baseline = %s: %v", gitLog, err)
	}
	agentLog, err := os.ReadFile(filepath.Join(project, "agent.log"))
	if err != nil || !strings.Contains(string(agentLog), "test:model\n") || !strings.Contains(string(agentLog), "literal prompt 'quoted'\n") || !strings.Contains(string(agentLog), "--session\nfixture-session\n") || !strings.Contains(string(agentLog), "continue literal ; message\n") {
		t.Fatalf("agent = %s: %v", agentLog, err)
	}
}
