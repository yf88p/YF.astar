//go:build unix

package util

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCommandCancellationStopsDescendants(t *testing.T) {
	for _, run := range []string{"shell", "output"} {
		t.Run(run, func(t *testing.T) {
			dir := isolatedShell(t)
			heartbeat := filepath.Join(dir, "heartbeat")
			pidFile := filepath.Join(dir, "pid")
			child := "while :; do printf x >> " + ShellQuote(heartbeat) + "; sleep 0.01; done"
			command := "/bin/sh -c " + ShellQuote(child) + " & printf '%s' $! > " + ShellQuote(pidFile) + "; wait"
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() {
				var err error
				if run == "shell" {
					_, err = RunShell(ctx, dir, command)
				} else {
					_, err = CommandOutput(ctx, "/bin/sh", "-c", command)
				}
				done <- err
			}()
			defer func() {
				if data, err := os.ReadFile(pidFile); err == nil {
					if pid, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil && pid > 0 {
						_ = syscall.Kill(pid, syscall.SIGKILL)
					}
				}
			}()
			deadline := time.Now().Add(5 * time.Second)
			for {
				data, err := os.ReadFile(heartbeat)
				if err == nil && len(data) > 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("descendant did not start")
				}
				time.Sleep(10 * time.Millisecond)
			}
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancellation error = %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("command did not stop")
			}
			first, err := os.ReadFile(heartbeat)
			if err != nil {
				t.Fatal(err)
			}
			time.Sleep(100 * time.Millisecond)
			second, err := os.ReadFile(heartbeat)
			if err != nil || string(first) != string(second) {
				t.Fatalf("descendant survived cancellation: %q -> %q, %v", first, second, err)
			}
		})
	}
}

func TestCommandOutputWaitsForPipeEOF(t *testing.T) {
	isolatedShell(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := CommandOutput(ctx, "/bin/sh", "-c", "(sleep 1.2; printf complete) & exit 0")
	if err != nil || got != "complete" {
		t.Fatalf("output after parent exit = %q, %v", got, err)
	}
}
