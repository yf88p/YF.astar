package tui

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"automator/internal/util"
)

const logHelperEnv = "AUTOMATOR_TUI_LOG_HELPER"

type logJob struct {
	Program string
	Args    []string
}

func runLogged(program, logDir string, request request) processResult {
	if err := os.MkdirAll(logDir, 0700); err != nil {
		return processResult{err: err}
	}
	prefix := "action-"
	if request.kind != actionProcess {
		prefix = "run-"
	}
	log, err := os.CreateTemp(logDir, prefix+time.Now().UTC().Format("20060102T150405")+"-*.log")
	if err != nil {
		return processResult{err: err}
	}
	defer log.Close()
	result := processResult{logPath: log.Name()}
	if _, err := fmt.Fprintf(log, "automator %s\n\n", util.RedactSecrets(strings.Join(request.args, " "))); err != nil {
		result.err = err
		return result
	}
	exe, err := os.Executable()
	if err != nil {
		result.err = err
		return result
	}
	read, write, err := os.Pipe()
	if err != nil {
		result.err = err
		return result
	}
	defer read.Close()
	defer write.Close()
	// The logger must outlive dashboard quit too. Keeping a redaction pipe in
	// the dashboard would break the child on exit (SIGPIPE) or lose its output.
	// This private, headless `tui` invocation receives its job through stdin,
	// never a plaintext job file or command-line secret. Standard handles also
	// work on Windows, where os/exec does not support ExtraFiles.
	cmd := exec.Command(exe, "tui")
	cmd.Env = append(logChildEnv(), logHelperEnv+"=1")
	cmd.Stdin, cmd.Stdout = read, log
	detachProcess(cmd)
	if err := cmd.Start(); err != nil {
		result.err = err
		return result
	}
	_ = read.Close()
	encodeErr := json.NewEncoder(write).Encode(logJob{Program: program, Args: request.args})
	_ = write.Close()
	result.err = errors.Join(encodeErr, cmd.Wait())
	if result.err != nil {
		if detail := lastLogLine(log); detail != "" {
			result.err = fmt.Errorf("%w: %s", result.err, detail)
		}
	}
	return result
}

func logChildEnv() []string {
	var env []string
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, logHelperEnv+"=") {
			env = append(env, value)
		}
	}
	return env
}

func runLogHelper(ctx context.Context) error {
	output := &logRedactor{out: os.Stdout}
	var job logJob
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20)).Decode(&job); err != nil {
		_, _ = fmt.Fprintln(output, "invalid TUI log job:", err)
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	cmd := exec.Command(job.Program, job.Args...)
	cmd.Env = logChildEnv()
	// Equal stdout/stderr writers share one pipe and serialized writes in exec.
	cmd.Stdout, cmd.Stderr = output, output
	err := cmd.Run()
	var exit *exec.ExitError
	if err != nil && !errors.As(err, &exit) {
		_, _ = fmt.Fprintln(output, "launch failed:", err)
	}
	return err
}

// Streaming equivalent of util.RedactSecrets. Its bounded state spans writes,
// escaped spaces and multiline quotes, so partial chunks never hit disk raw.
type logRedactor struct {
	out     io.Writer
	part    string
	secret  bool
	hiding  bool
	quote   byte
	escaped bool
}

func (w *logRedactor) Write(p []byte) (int, error) {
	var out strings.Builder
	sensitivePart := func() bool {
		return w.part == "KEY" || w.part == "TOKEN" || w.part == "SECRET" || w.part == "PASSWORD"
	}
	for _, c := range p {
		if w.hiding {
			if w.escaped {
				w.escaped = false
				continue
			}
			if c == '\\' && w.quote != '\'' {
				w.escaped = true
				continue
			}
			if w.quote != 0 || !strings.ContainsRune(" \t\n\r\v\f;|&", rune(c)) {
				if w.quote == 0 && (c == '\'' || c == '"') {
					w.quote = c
				} else if c == w.quote {
					w.quote = 0
				}
				continue
			}
			w.hiding = false
		}
		if c == '=' && (w.secret || sensitivePart()) {
			out.WriteString("=<redacted>")
			w.hiding = true
		} else {
			out.WriteByte(c)
		}
		switch {
		case c == '_':
			w.secret = w.secret || sensitivePart()
			w.part = ""
		case c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9':
			if len(w.part) <= len("PASSWORD") {
				if c >= 'a' && c <= 'z' {
					c -= 'a' - 'A'
				}
				w.part += string(c)
			}
		default:
			w.secret, w.part = false, ""
		}
	}
	if _, err := io.WriteString(w.out, out.String()); err != nil {
		return 0, err
	}
	return len(p), nil
}

func lastLogLine(file *os.File) string {
	info, err := file.Stat()
	if err != nil {
		return ""
	}
	start := max(int64(0), info.Size()-4096)
	data := make([]byte, info.Size()-start)
	if _, err := file.ReadAt(data, start); err != nil {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	return util.RedactSecrets(strings.TrimSpace(lines[len(lines)-1]))
}
