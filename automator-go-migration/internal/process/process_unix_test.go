//go:build unix

package process

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

func TestProcessHelper(t *testing.T) {
	role := os.Getenv("AUTOMATOR_PROCESS_TEST_HELPER")
	if role == "" {
		return
	}
	dir := os.Getenv("AUTOMATOR_PROCESS_TEST_DIR")
	switch role {
	case "parent":
		executable, err := os.Executable()
		if err != nil {
			os.Exit(2)
		}
		child := exec.Command(executable, "-test.run=^TestProcessHelper$")
		child.Env = append(os.Environ(), "AUTOMATOR_PROCESS_TEST_HELPER=child")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if child.Start() != nil {
			os.Exit(3)
		}
		if os.WriteFile(filepath.Join(dir, "pid"), []byte(strconv.Itoa(child.Process.Pid)), 0o600) != nil {
			os.Exit(4)
		}
		_ = child.Wait()
	case "child":
		for i := 0; ; i++ {
			if os.WriteFile(filepath.Join(dir, "heartbeat"), []byte(strconv.Itoa(i)), 0o600) != nil {
				os.Exit(5)
			}
			time.Sleep(10 * time.Millisecond)
		}
	case "exit":
		code, _ := strconv.Atoi(os.Getenv("AUTOMATOR_PROCESS_TEST_EXIT"))
		os.Exit(code)
	case "signal":
		if syscall.Kill(os.Getpid(), syscall.SIGTERM) != nil {
			os.Exit(6)
		}
		time.Sleep(time.Second)
		os.Exit(7)
	}
	os.Exit(0)
}

func TestCancellationStopsDescendants(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := CommandContext(ctx, executable, "-test.run=^TestProcessHelper$")
	cmd.Env = append(os.Environ(), "AUTOMATOR_PROCESS_TEST_HELPER=parent", "AUTOMATOR_PROCESS_TEST_DIR="+dir)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }()
	wait := make(chan error, 1)
	go func() { wait <- cmd.Wait() }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, pidErr := os.Stat(filepath.Join(dir, "pid"))
		heartbeat, heartErr := os.ReadFile(filepath.Join(dir, "heartbeat"))
		if pidErr == nil && heartErr == nil && len(heartbeat) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("descendant did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	pidBytes, err := os.ReadFile(filepath.Join(dir, "pid"))
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(string(pidBytes))
	if err != nil {
		t.Fatal(err)
	}
	// Ensure a failed test cannot leave the heartbeat child running.
	defer func() { _ = syscall.Kill(pid, syscall.SIGKILL) }()
	cancel()
	select {
	case err := <-wait:
		if err == nil {
			t.Fatal("cancelled command succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("parent did not terminate")
	}
	first, err := os.ReadFile(filepath.Join(dir, "heartbeat"))
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)
	second, err := os.ReadFile(filepath.Join(dir, "heartbeat"))
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatalf("descendant survived cancellation: heartbeat %s -> %s", first, second)
	}
}

func TestExitWasCancelled(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []int{0, 1, 130, 143} {
		cmd := CommandContext(context.Background(), executable, "-test.run=^TestProcessHelper$")
		cmd.Env = append(os.Environ(), "AUTOMATOR_PROCESS_TEST_HELPER=exit", fmt.Sprintf("AUTOMATOR_PROCESS_TEST_EXIT=%d", code))
		err := cmd.Run()
		if got := ExitWasCancelled(fmt.Errorf("wrapped: %w", err)); got != (code == 130 || code == 143) {
			t.Errorf("code %d: cancelled=%v", code, got)
		}
	}
	cmd := CommandContext(context.Background(), executable, "-test.run=^TestProcessHelper$")
	cmd.Env = append(os.Environ(), "AUTOMATOR_PROCESS_TEST_HELPER=signal")
	if err := cmd.Run(); !ExitWasCancelled(err) {
		t.Fatalf("SIGTERM not recognized: %v", err)
	}
	if ExitWasCancelled(errors.New("launch failed")) || ExitWasCancelled(nil) {
		t.Fatal("non-exit error counted as cancellation")
	}
}
