package adapter

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"automator/internal/config"
)

func TestCredentialStoresAreNeverOpened(t *testing.T) {
	home := isolatedHome(t)
	openRoot := filepath.Join(home, ".local", "share", "opencode")
	piRoot := os.Getenv("PI_CODING_AGENT_SESSION_DIR")
	claudeRoot := filepath.Join(os.Getenv("CLAUDE_CONFIG_DIR"), "projects")
	credentialPaths := []string{
		filepath.Join(openRoot, "auth.json"),
		filepath.Join(openRoot, ".credentials.json"),
		filepath.Join(openRoot, "auth.db"),
		filepath.Join(openRoot, "credentials", "otherwise-normal.json"),
		filepath.Join(home, ".opencode", "auth.json"),
		filepath.Join(piRoot, "auth.jsonl"),
		filepath.Join(claudeRoot, ".credentials.jsonl"),
		filepath.Join(home, ".ssh", "otherwise-normal.json"),
		filepath.Join(home, ".env"),
	}
	// Synthetic credential files deliberately resemble correlated session exports.
	// Rejecting their metrics after reading would still be a privacy violation.
	for _, path := range credentialPaths {
		writeFixture(t, path, `{"directory":"/project","title":"title","cwd":"/project","sessionID":"ses_private","role":"assistant","tokens":{"input":999},"usage":{"input":999}}`)
	}
	aliases := []struct{ target, path string }{
		{credentialPaths[0], filepath.Join(openRoot, "aliased-session.json")},
		{credentialPaths[2], filepath.Join(openRoot, "aliased-session.db")},
		{filepath.Dir(credentialPaths[3]), filepath.Join(openRoot, "aliased-sessions")},
		{credentialPaths[7], filepath.Join(openRoot, "aliased-ssh-session.json")},
		{credentialPaths[8], filepath.Join(openRoot, "aliased-env-session.json")},
	}
	for _, alias := range aliases {
		if err := os.Symlink(alias.target, alias.path); err != nil {
			t.Fatal(err)
		}
	}
	writeFixture(t, filepath.Join(openRoot, "session.jsonl"), `{"directory":"/project","title":"title","sessionID":"ses_public","role":"assistant","tokens":{"input":1}}`)
	writeFixture(t, filepath.Join(piRoot, "public.jsonl"), `{"cwd":"/project","usage":{"input":1}}`)
	writeFixture(t, filepath.Join(claudeRoot, "public.jsonl"), `{"cwd":"/project","type":"assistant","message":{"usage":{"input_tokens":1}}}`)

	watch, err := syscall.InotifyInit1(syscall.IN_NONBLOCK | syscall.IN_CLOEXEC)
	if err != nil {
		t.Skipf("inotify unavailable: %v", err)
	}
	defer syscall.Close(watch)
	for _, path := range append(credentialPaths, filepath.Dir(credentialPaths[3])) {
		if _, err := syscall.InotifyAddWatch(watch, path, syscall.IN_OPEN|syscall.IN_ACCESS); err != nil {
			t.Fatal(err)
		}
	}

	for _, tool := range []config.Tool{config.Pi, config.Opencode, config.Claude} {
		model := config.Model{Tool: tool}
		m, err := CollectMetrics(context.Background(), model, "/project", "title", time.Now())
		if err != nil || value(m.InputTokens) != 1 {
			t.Fatalf("eligible %s session was not collected: %#v, %v", tool, m, err)
		}
		if tool != config.Pi {
			m, err = RecoverMetrics(context.Background(), model, "/project", "title", time.Now(), "")
			if err != nil || value(m.InputTokens) != 1 {
				t.Fatalf("eligible %s session was not recovered: %#v, %v", tool, m, err)
			}
		}
	}
	// The uncorrelated newest-JSON fallback must not consider credential files either.
	if err := os.Remove(filepath.Join(openRoot, "session.jsonl")); err != nil {
		t.Fatal(err)
	}
	m, err := CollectMetrics(context.Background(), config.Model{Tool: config.Opencode}, "/project", "title", time.Now())
	if err != nil || m.NativeSessionID != nil {
		t.Fatalf("credential file used as last-resort JSON: %#v, %v", m, err)
	}
	for _, path := range append(credentialPaths, aliases[0].path, aliases[1].path) {
		if _, ok := readText(path); ok {
			t.Errorf("readText accepted credential path %s", path)
		}
		if _, err := BuildCommand(config.Model{Tool: config.Claude}, "/project", path, "title"); err == nil {
			t.Errorf("prompt reader accepted credential path %s", path)
		}
		if _, err := opencodeMetricsFromDB(context.Background(), path, "/project", "title", time.Unix(0, 0), true, ""); err == nil {
			t.Errorf("SQLite reader accepted credential path %s", path)
		}
	}
	buf := make([]byte, 4096)
	if n, err := syscall.Read(watch, buf); n > 0 || !errors.Is(err, syscall.EAGAIN) {
		t.Fatalf("credential file/directory was opened or read: %d event bytes, error %v", n, err)
	}
}
