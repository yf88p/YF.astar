//go:build linux

package tui_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"

	"automator/internal/cli"
	"automator/internal/tui"

	"golang.org/x/sys/unix"
)

func TestPrivateTerminalHelper(t *testing.T) {
	mode := os.Getenv("AUTOMATOR_TEST_PRIVATE_TERMINAL")
	if mode == "" {
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result := ""
	if mode == "direct" {
		err := tui.Run(ctx)
		result = fmt.Sprint(err)
		if errors.Is(err, context.Canceled) {
			result = "canceled"
		}
	} else {
		// Exercise the actual no-argument CLI, using main's exact signal setup.
		result = fmt.Sprint(cli.Execute(ctx, nil, os.Stdout, os.Stderr))
	}
	fmt.Fprintln(os.Stdout, "TUI_RESULT="+result)
	os.Exit(0)
}

func TestPrivatePTYDefaultCLIAndSignalRestoration(t *testing.T) {
	for _, tc := range []struct {
		name, mode, result string
		signal             syscall.Signal
		editor             bool
	}{
		{name: "ctrl-c-is-stop-key-then-quit", mode: "cli", result: "0"},
		{name: "direct-SIGINT-is-context-canceled", mode: "direct", result: "canceled", signal: syscall.SIGINT},
		{name: "default-CLI-SIGTERM-is-130", mode: "cli", result: "130", signal: syscall.SIGTERM},
		{name: "SIGTERM-during-new-draft-editor", mode: "cli", result: "130", signal: syscall.SIGTERM, editor: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			master, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY|syscall.O_NONBLOCK, 0)
			if err != nil {
				t.Skipf("private PTY unavailable: %v", err)
			}
			defer master.Close()
			if err := unix.IoctlSetPointerInt(int(master.Fd()), unix.TIOCSPTLCK, 0); err != nil {
				t.Fatal(err)
			}
			number, err := unix.IoctlGetInt(int(master.Fd()), unix.TIOCGPTN)
			if err != nil {
				t.Fatal(err)
			}
			slave, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", number), os.O_RDWR|syscall.O_NOCTTY, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer slave.Close()
			before, err := unix.IoctlGetTermios(int(slave.Fd()), unix.TCGETS)
			if err != nil {
				t.Fatal(err)
			}
			if err := unix.IoctlSetWinsize(int(slave.Fd()), unix.TIOCSWINSZ, &unix.Winsize{Row: 30, Col: 100}); err != nil {
				t.Fatal(err)
			}
			home := t.TempDir()
			editor := filepath.Join(home, "fake-editor")
			if err := os.WriteFile(editor, []byte("#!/bin/sh\nprintf 'PRIVATE_EDITOR_READY\\n'\nexec /bin/sleep 60\n"), 0700); err != nil {
				t.Fatal(err)
			}
			exe, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, exe, "-test.run=^TestPrivateTerminalHelper$")
			// No inherited credentials, Herdr variables, or real user config.
			cmd.Env = []string{"HOME=" + home, "AUTOMATOR_HOME=" + filepath.Join(home, "automator"), "PATH=" + home,
				"TERM=screen-256color", "SHELL=/bin/sh", "EDITOR=" + editor, "AUTOMATOR_TEST_PRIVATE_TERMINAL=" + tc.mode}
			cmd.Stdin, cmd.Stdout, cmd.Stderr = slave, slave, slave
			cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
			cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			chunks := make(chan string, 128)
			go func() {
				defer close(chunks)
				buffer := make([]byte, 4096)
				for {
					n, err := master.Read(buffer)
					if n > 0 {
						select {
						case chunks <- string(buffer[:n]):
						case <-ctx.Done():
							return
						}
					}
					if err != nil {
						return
					}
				}
			}()
			var output strings.Builder
			waitText := func(text string) {
				t.Helper()
				for !strings.Contains(output.String(), text) {
					select {
					case chunk, ok := <-chunks:
						if !ok {
							t.Fatalf("PTY closed before %q: %s", text, output.String())
						}
						output.WriteString(chunk)
					case <-ctx.Done():
						t.Fatalf("waiting for %q: %s", text, output.String())
					}
				}
			}
			waitText("Drafts")
			if tc.editor {
				_, _ = master.Write([]byte("n"))
				waitText("PRIVATE_EDITOR_READY")
			}
			if tc.signal != 0 {
				if err := cmd.Process.Signal(tc.signal); err != nil {
					t.Fatal(err)
				}
			} else {
				_, _ = master.Write([]byte{3})
				waitText("select a model under Runs first")
				_, _ = master.Write([]byte("q"))
			}
			waitText("TUI_RESULT=" + tc.result)
			if err := <-done; err != nil {
				t.Fatalf("terminal helper: %v\n%s", err, output.String())
			}
			after, err := unix.IoctlGetTermios(int(slave.Fd()), unix.TCGETS)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("terminal raw/echo/signal flags were not restored")
			}
			if !strings.Contains(output.String(), "\x1b[?1049l") || !strings.Contains(output.String(), "\x1b[?25h") {
				t.Fatal("alternate screen/cursor not restored")
			}
		})
	}
}
