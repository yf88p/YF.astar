package util

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func isolatedShell(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("requires a POSIX shell")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("AUTOMATOR_HOME", filepath.Join(home, ".automator"))
	t.Setenv("SHELL", "/bin/sh")
	t.Setenv("PATH", "/usr/bin:/bin")
	return home
}

func TestExpandPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	for _, test := range []struct{ input, want string }{
		{"~", home}, {"~/runs", home + "/runs"}, {"~/a/../b", home + "/a/../b"},
		{"~someone/runs", "~someone/runs"}, {"$HOME/runs", "$HOME/runs"},
		{"relative/path", "relative/path"}, {"/absolute/path", "/absolute/path"}, {"", ""},
	} {
		if got := ExpandPath(test.input); got != test.want {
			t.Errorf("ExpandPath(%q) = %q, want %q", test.input, got, test.want)
		}
	}
	t.Setenv("HOME", "")
	t.Setenv("USERPROFILE", "")
	if got := ExpandPath("~/runs"); got != "~/runs" {
		t.Errorf("missing home: got %q", got)
	}
}

func TestSlug(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"Open Weight Models!", "open-weight-models"}, {" A___B...C-- ", "a-b-c"},
		{"fake-pi_1.2", "fake-pi-1-2"}, {"ABC123", "abc123"}, {"", ""}, {"---", ""},
		{"caf\u00e9 \u4e16\u754c model", "caf-model"}, {"a\x00b\nc", "a-b-c"},
	} {
		if got := Slug(test.input); got != test.want {
			t.Errorf("Slug(%q) = %q, want %q", test.input, got, test.want)
		}
	}
}

func TestShellQuote(t *testing.T) {
	isolatedShell(t)
	for _, input := range []string{"", "hello world", "a'b", "\n$(exit 7); `false` & \\ $HOME", "\u4e16\u754c"} {
		got, err := CommandOutput(context.Background(), "/bin/sh", "-c", "printf '%s' "+ShellQuote(input))
		if err != nil || got != strings.TrimSpace(input) {
			t.Errorf("quote roundtrip %q: got %q, err %v", input, got, err)
		}
	}
	if got := ShellQuote("a'b"); got != "'a'\\''b'" {
		t.Errorf("ShellQuote = %q", got)
	}
}

func TestPreferredShell(t *testing.T) {
	home := isolatedShell(t)
	t.Setenv("SHELL", "/fake/a shell's path")
	if got := PreferredShell(); got != "/fake/a shell's path" {
		t.Errorf("PreferredShell = %q", got)
	}
	if got := ExecPreferredShellCommand(); got != "exec '/fake/a shell'\\''s path'" {
		t.Errorf("ExecPreferredShellCommand = %q", got)
	}
	t.Setenv("SHELL", "")
	t.Setenv("PATH", home)
	want := "/bin/sh"
	if _, err := os.Stat("/bin/zsh"); err == nil {
		want = "/bin/zsh"
	}
	if got := PreferredShell(); got != want {
		t.Errorf("fallback = %q, want %q", got, want)
	}
	fake := filepath.Join(home, "zsh")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	if want != "/bin/zsh" {
		want = fake
	}
	if got := PreferredShell(); got != want {
		t.Errorf("PATH fallback = %q, want %q", got, want)
	}
	t.Setenv("SHELL", "\xff")
	if got := PreferredShell(); got != want {
		t.Errorf("invalid UTF-8 fallback = %q, want %q", got, want)
	}
}

func TestIsSafePathComponent(t *testing.T) {
	for _, value := range []string{"fake-pi_1.2", "a b", ".hidden", "...", "\u4e16\u754c"} {
		if !IsSafePathComponent(value) {
			t.Errorf("rejected safe component %q", value)
		}
	}
	for _, value := range []string{"", ".", "..", "../x", "a/b", "a\\b", "a\x00b", "/absolute"} {
		if IsSafePathComponent(value) {
			t.Errorf("accepted unsafe component %q", value)
		}
	}
	for _, value := range []string{"a:b", "C:", "C:relative"} {
		if got, want := IsSafePathComponent(value), runtime.GOOS != "windows"; got != want {
			t.Errorf("IsSafePathComponent(%q) = %v, want %v", value, got, want)
		}
	}
}

func TestRedactSecrets(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"API_KEY=supersecret123 echo ok", "API_KEY=<redacted> echo ok"},
		{"TOKEN='abc def'; PASSWORD=x", "TOKEN=<redacted>; PASSWORD=<redacted>"},
		{"MODEL_KEYSTONE=value NORMAL=value", "MODEL_KEYSTONE=value NORMAL=value"},
		{"key=a|token=b&secret=c\npassword=d\tend", "key=<redacted>|token=<redacted>&secret=<redacted>\npassword=<redacted>\tend"},
		{"export API_SECRET_KEY=abc=def; OK=x", "export API_SECRET_KEY=<redacted>; OK=x"},
		{"TOKEN=; PASSWORD=", "TOKEN=<redacted>; PASSWORD=<redacted>"},
		{"TOKEN=\"abc def\" TOKEN='unterminated", "TOKEN=<redacted> TOKEN=<redacted>"},
		{"TOKEN=\"abc\\\"def\"; ok", "TOKEN=<redacted>; ok"},
		{"TOKEN='a'\\''b'; ok", "TOKEN=<redacted>; ok"},
		{"TOKEN=a\\ b; ok", "TOKEN=<redacted>; ok"},
		{"\u4e16\u754c TOKEN=\u79d8\u5bc6 normal=\u00e9", "\u4e16\u754c TOKEN=<redacted> normal=\u00e9"},
		{"APIKEY=visible AUTH_TOKEN_EXTRA=hidden", "APIKEY=visible AUTH_TOKEN_EXTRA=<redacted>"},
		{"KEY =not-an-assignment =unchanged", "KEY =not-an-assignment =unchanged"},
		{"", ""},
	} {
		if got := RedactSecrets(test.input); got != test.want {
			t.Errorf("RedactSecrets(%q) = %q, want %q", test.input, got, test.want)
		}
	}
}

func TestRunShell(t *testing.T) {
	dir := isolatedShell(t)
	for _, test := range []struct {
		command string
		code    int
	}{
		{"test \"$PWD\" = " + ShellQuote(dir), 0},
		{"exit 23", 23},
		{"if read value; then exit 9; fi", 0},
		{"kill -TERM $$", 1},
	} {
		code, err := RunShell(context.Background(), dir, test.command)
		if err != nil || code != test.code {
			t.Errorf("RunShell(%q) = %d, %v; want %d, nil", test.command, code, err, test.code)
		}
	}
	if _, err := RunShell(context.Background(), filepath.Join(dir, "missing"), "true"); err == nil {
		t.Error("missing working directory succeeded")
	}
	t.Setenv("SHELL", filepath.Join(dir, "missing-shell"))
	if _, err := RunShell(context.Background(), dir, "true"); err == nil {
		t.Error("missing shell succeeded")
	}
}

func TestCommandsCancel(t *testing.T) {
	dir := isolatedShell(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := RunShell(ctx, dir, "exit 0"); !errors.Is(err, context.Canceled) {
		t.Errorf("RunShell cancellation: %v", err)
	}
	if _, err := CommandOutput(ctx, "/bin/sh", "-c", "exit 0"); !errors.Is(err, context.Canceled) {
		t.Errorf("CommandOutput cancellation: %v", err)
	}
	for _, run := range []func(context.Context) error{
		func(ctx context.Context) error { _, err := RunShell(ctx, dir, "exec sleep 10"); return err },
		func(ctx context.Context) error {
			_, err := CommandOutput(ctx, "/bin/sh", "-c", "exec sleep 10")
			return err
		},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		start := time.Now()
		err := run(ctx)
		cancel()
		if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 3*time.Second {
			t.Errorf("running command deadline: %v after %v", err, time.Since(start))
		}
	}
}

func TestCommandOutput(t *testing.T) {
	dir := isolatedShell(t)
	got, err := CommandOutput(context.Background(), "/bin/sh", "-c", "printf '  hello\\n'; printf 'ignored' >&2")
	if err != nil || got != "hello" {
		t.Errorf("CommandOutput = %q, %v", got, err)
	}
	got, err = CommandOutput(context.Background(), "/bin/sh", "-c", "printf '\\377'")
	if err != nil || got != "\ufffd" {
		t.Errorf("lossy UTF-8 = %q, %v", got, err)
	}
	got, err = CommandOutput(context.Background(), "/bin/sh", "-c", "printf 'discard'; exit 4")
	if err == nil || got != "" {
		t.Errorf("failed command = %q, %v", got, err)
	}
	if _, err := CommandOutput(context.Background(), filepath.Join(dir, "missing")); err == nil {
		t.Error("missing command succeeded")
	}
}
