package tui

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"automator/internal/util"
)

func TestMain(m *testing.M) {
	if os.Getenv(logHelperEnv) == "1" {
		if Run(context.Background()) != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestLogRedactorMatchesSharedRedactorAcrossChunks(t *testing.T) {
	inputs := []string{
		"API_KEY=supersecret123 echo ok", "TOKEN='abc def'; PASSWORD=x",
		"key=a|token=b&secret=c\npassword=d\tend", "export API_SECRET_KEY=abc=def; OK=x",
		"TOKEN=; PASSWORD=", "TOKEN=\"abc def\" TOKEN='unterminated", "TOKEN=\"abc\\\"def\"; ok",
		"TOKEN='a'\\''b'; ok", "TOKEN=a\\ b; ok", "APIKEY=visible AUTH_TOKEN_EXTRA=hidden",
		"PREFIX_" + strings.Repeat("A", 1000) + "_TOKEN='first\nsecond'\nafter=visible",
	}
	for _, text := range inputs {
		for _, size := range []int{1, 2, 5, 31, len(text)} {
			var out bytes.Buffer
			writer := &logRedactor{out: &out}
			for offset := 0; offset < len(text); offset += size {
				chunk := []byte(text[offset:min(len(text), offset+size)])
				if n, err := writer.Write(chunk); err != nil || n != len(chunk) {
					t.Fatal("stream write failed")
				}
			}
			if got, want := out.String(), util.RedactSecrets(text); got != want {
				t.Fatalf("chunk size %d: got %q want %q", size, got, want)
			}
		}
	}
}

func TestLogOutputHelper(t *testing.T) {
	if os.Getenv("AUTOMATOR_TEST_LOG_OUTPUT") != "1" {
		return
	}
	if os.Getenv(logHelperEnv) != "" {
		os.Exit(90)
	}
	_, _ = fmt.Fprint(os.Stdout, "TOKEN=")
	_, _ = fmt.Fprint(os.Stdout, "'first-secret\nsecond-secret'; visible output\n")
	_, _ = fmt.Fprint(os.Stderr, "PASSWORD=stderr-secret\n")
	os.Exit(7)
}

func TestSubprocessLogsRedactBeforePersistence(t *testing.T) {
	t.Setenv("AUTOMATOR_TEST_LOG_OUTPUT", "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	result := runLogged(exe, t.TempDir(), request{args: []string{"-test.run=^TestLogOutputHelper$", "--", "API_KEY=header-secret"}})
	if result.err == nil {
		t.Fatal("expected helper failure")
	}
	data, err := os.ReadFile(result.logPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"header-secret", "first-secret", "second-secret", "stderr-secret"} {
		if strings.Contains(string(data), secret) || strings.Contains(result.err.Error(), secret) {
			t.Fatal("secret persisted or returned")
		}
	}
	if !strings.Contains(string(data), "visible output") || strings.Count(string(data), "<redacted>") != 3 {
		t.Fatalf("lost diagnostic output: %s", data)
	}
	m := testModel(t)
	m.feedback("", errors.New("API_KEY=feedback-secret failed"))
	if strings.Contains(m.status, "feedback-secret") {
		t.Fatal("secret retained in status")
	}
}

func TestLogRedactorPropagatesStorageErrors(t *testing.T) {
	closed, err := os.CreateTemp(t.TempDir(), "closed")
	if err != nil {
		t.Fatal(err)
	}
	closed.Close()
	writer := &logRedactor{out: closed}
	if _, err := writer.Write([]byte("TOKEN=sensitive")); err == nil {
		t.Fatal("storage error hidden")
	}
}

func TestMissingReportDoesNotGenerateOne(t *testing.T) {
	m := testModel(t)
	m.section = runs
	m.data.runs[0].path = t.TempDir()
	consume(t, m, press(m, "o"))
	if m.externalBusy || !strings.Contains(m.status, "open report") {
		t.Fatal("missing report did not give recoverable feedback")
	}
}

func TestLogLauncherHelper(t *testing.T) {
	dir := os.Getenv("AUTOMATOR_TEST_LOG_LAUNCHER")
	if dir == "" {
		return
	}
	go func() {
		runLogged("/bin/sh", dir, request{args: []string{"-c", "printf 'TOKEN=launch-secret\\nready\\n'; i=0; while [ ! -f \"$1\" ]; do i=$((i+1)); [ \"$i\" -ge 400 ] && exit 1; /bin/sleep 0.01; done; printf 'PASSWORD=finish-secret\\nfinished\\n'", "helper", filepath.Join(dir, "release")}})
	}()
	select {}
}

func TestRedactedLoggingSurvivesDashboardProcessExit(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("requires /bin/sh")
	}
	dir := t.TempDir()
	t.Setenv("AUTOMATOR_TEST_LOG_LAUNCHER", dir)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestLogLauncherHelper$")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	waitLog := func(text string) string {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			entries, _ := os.ReadDir(dir)
			for _, entry := range entries {
				if !strings.HasSuffix(entry.Name(), ".log") {
					continue
				}
				data, _ := os.ReadFile(filepath.Join(dir, entry.Name()))
				if strings.Contains(string(data), "launch-secret") || strings.Contains(string(data), "finish-secret") {
					t.Fatal("plaintext secret was observable in an active log")
				}
				if strings.Contains(string(data), text) {
					return string(data)
				}
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("log did not contain %q", text)
		return ""
	}
	waitLog("\nready\n")
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	if err := os.WriteFile(filepath.Join(dir, "release"), []byte("go"), 0600); err != nil {
		t.Fatal(err)
	}
	if data := waitLog("\nfinished\n"); !strings.Contains(data, "PASSWORD=<redacted>") {
		t.Fatal("post-exit output lost or not redacted")
	}
}
