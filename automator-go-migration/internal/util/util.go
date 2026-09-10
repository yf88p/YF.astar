// Package util contains path, shell, and display helpers.
package util

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"automator/internal/process"
)

func ExpandPath(s string) string {
	if s == "~" || strings.HasPrefix(s, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return home + strings.TrimPrefix(s, "~")
		}
	}
	return s
}

func Slug(s string) string {
	var out strings.Builder
	dash := false
	for _, c := range s {
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' {
			out.WriteRune(c)
			dash = false
		} else if !dash && out.Len() > 0 {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(out.String(), "-")
}

func ShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func PreferredShell() string {
	if shell := os.Getenv("SHELL"); shell != "" && utf8.ValidString(shell) {
		return shell
	}
	if _, err := os.Stat("/bin/zsh"); err == nil {
		return "/bin/zsh"
	}
	if path, err := exec.LookPath("zsh"); err == nil {
		return path
	}
	return "/bin/sh"
}

func ExecPreferredShellCommand() string {
	return "exec " + ShellQuote(PreferredShell())
}

func IsSafePathComponent(s string) bool {
	return s != "" && s != "." && s != ".." && !strings.ContainsAny(s, "/\\\x00") && filepath.VolumeName(s) == ""
}

// RedactSecrets masks shell-style assignments whose underscore-delimited key
// contains KEY, TOKEN, SECRET, or PASSWORD. It is not a general shell parser.
func RedactSecrets(s string) string {
	var out strings.Builder
	for i := 0; i < len(s); {
		if s[i] == '=' {
			start := i
			for start > 0 {
				c := s[start-1]
				if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_') {
					break
				}
				start--
			}
			secret := false
			for _, part := range strings.Split(strings.ToUpper(s[start:i]), "_") {
				if part == "KEY" || part == "TOKEN" || part == "SECRET" || part == "PASSWORD" {
					secret = true
					break
				}
			}
			if secret {
				out.WriteString("=<redacted>")
				i++
				var quote byte
				for i < len(s) {
					c := s[i]
					if quote == 0 && strings.ContainsRune(" \t\n\r\v\f;|&", rune(c)) {
						break
					}
					if c == '\\' && quote != '\'' && i+1 < len(s) {
						i += 2
						continue
					}
					if quote == 0 && (c == '\'' || c == '"') {
						quote = c
					} else if c == quote {
						quote = 0
					}
					i++
				}
				continue
			}
		}
		out.WriteByte(s[i])
		i++
	}
	return out.String()
}

// RunShell inherits stdout/stderr, supplies EOF on stdin, and returns ordinary
// nonzero exit codes without an error. Start failures and cancellation are errors.
func RunShell(ctx context.Context, dir, shell string) (int, error) {
	cmd := process.CommandContext(ctx, PreferredShell(), "-lc", shell)
	cmd.Dir = dir
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return 1, fmt.Errorf("run shell: %w", ctx.Err())
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		if code := exit.ExitCode(); code >= 0 {
			return code, nil
		}
		return 1, nil
	}
	if err != nil {
		return 1, fmt.Errorf("run shell: %w", err)
	}
	return 0, nil
}

func CommandOutput(ctx context.Context, name string, args ...string) (string, error) {
	cmd := process.CommandContext(ctx, name, args...)
	out, err := cmd.Output()
	if ctx.Err() != nil {
		return "", fmt.Errorf("run %s: %w", name, ctx.Err())
	}
	if err != nil {
		return "", fmt.Errorf("run %s: %w", name, err)
	}
	return strings.TrimSpace(strings.ToValidUTF8(string(out), "\ufffd")), nil
}
