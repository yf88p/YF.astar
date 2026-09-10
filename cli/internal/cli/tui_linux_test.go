//go:build linux

package cli

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

const tuiInitialMessage = "Changes save immediately. Use r to pick up edits from another terminal."

var tuiSGR = regexp.MustCompile(`\x1b\[[0-9;]*m`)
var tuiSelection = regexp.MustCompile(`> ([0-9a-f]{8})`)

type tuiPTYRead struct {
	text string
	err  error
}

type tuiPTY struct {
	master, slave *os.File
	original      syscall.Termios
	width, height int
	ctx           context.Context
	reads         chan tuiPTYRead
	readerDone    chan struct{}
	pending       string
	transcript    strings.Builder
	cmd           *exec.Cmd
	done          chan struct{}
	waitErr       error
	stderr        bytes.Buffer
}

func tuiIoctl(t *testing.T, file *os.File, request uintptr, data unsafe.Pointer) {
	t.Helper()
	conn, err := file.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var errno syscall.Errno
	if err := conn.Control(func(fd uintptr) {
		_, _, errno = syscall.Syscall(syscall.SYS_IOCTL, fd, request, uintptr(data))
	}); err != nil {
		t.Fatal(err)
	}
	if errno != 0 {
		t.Fatalf("PTY ioctl %#x: %v", request, errno)
	}
}

func tuiTermios(t *testing.T, file *os.File) syscall.Termios {
	t.Helper()
	var state syscall.Termios
	tuiIoctl(t, file, syscall.TCGETS, unsafe.Pointer(&state))
	return state
}

func newTUIPTY(t *testing.T, width, height int) *tuiPTY {
	t.Helper()
	// As in terminal_linux_test.go, use the kernel PTY API. Opening nonblocking
	// lets os.File's poller unblock the reader when cleanup closes the master.
	master, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY|syscall.O_NONBLOCK, 0)
	if err != nil {
		t.Skipf("PTY unavailable: %v", err)
	}
	t.Cleanup(func() { master.Close() })
	var unlock int32
	tuiIoctl(t, master, syscall.TIOCSPTLCK, unsafe.Pointer(&unlock))
	var number uint32
	tuiIoctl(t, master, syscall.TIOCGPTN, unsafe.Pointer(&number))
	slave, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", number), os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { slave.Close() })
	original := tuiTermios(t, slave)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	p := &tuiPTY{
		master: master, slave: slave, original: original,
		ctx: ctx, reads: make(chan tuiPTYRead, 64), readerDone: make(chan struct{}),
	}
	t.Cleanup(func() {
		cancel()
		if p.done != nil {
			select {
			case <-p.done:
			case <-time.After(5 * time.Second):
				t.Error("CLI process did not stop during cleanup")
			}
		}
		// Keep the slave open until termios has been compared; close it even on
		// failure. The application's blocking input goroutine dies with its process.
		slave.Close()
		master.Close()
		select {
		case <-p.readerDone:
		case <-time.After(5 * time.Second):
			t.Error("PTY reader did not stop during cleanup")
		}
	})
	go func() {
		defer close(p.readerDone)
		defer close(p.reads)
		var buf [4096]byte
		for {
			n, err := master.Read(buf[:])
			select {
			case p.reads <- tuiPTYRead{string(buf[:n]), err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	p.resize(t, width, height)
	return p
}

func (p *tuiPTY) resize(t *testing.T, width, height int) {
	t.Helper()
	size := [4]uint16{uint16(height), uint16(width), 0, 0}
	tuiIoctl(t, p.slave, syscall.TIOCSWINSZ, unsafe.Pointer(&size))
	p.width, p.height = width, height
}

func startTUICLI(t *testing.T, e cliE2E, width, height int, env []string, args ...string) *tuiPTY {
	t.Helper()
	p := newTUIPTY(t, width, height)
	cmd := exec.CommandContext(p.ctx, e.binary, args...)
	cmd.Dir = e.dir
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "KANBAN_DB", "NO_COLOR", "TERM", "COLUMNS", "HOME", "XDG_CONFIG_HOME":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "TERM=xterm-256color", "HOME="+e.dir, "XDG_CONFIG_HOME="+e.dir, "KANBAN_DB="+e.envDB)
	cmd.Env = append(cmd.Env, env...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = p.slave, p.slave, &p.stderr
	// A controlling terminal makes VINTR (Ctrl-C) signal only this child session,
	// rather than the test runner, which must not share app.tui's signal handlers.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	p.cmd, p.done = cmd, make(chan struct{})
	go func() {
		p.waitErr = cmd.Wait()
		close(p.done)
	}()
	return p
}

func (p *tuiPTY) read(t *testing.T) error {
	t.Helper()
	select {
	case result, ok := <-p.reads:
		if !ok {
			return io.EOF
		}
		p.pending += result.text
		p.transcript.WriteString(result.text)
		return result.err
	case <-p.ctx.Done():
		t.Fatalf("PTY timed out: %v\noutput: %q", p.ctx.Err(), p.transcript.String())
		return p.ctx.Err()
	}
}

func (p *tuiPTY) until(t *testing.T, text string) string {
	t.Helper()
	for {
		if i := strings.Index(p.pending, text); i >= 0 {
			end := i + len(text)
			result := p.pending[:end]
			p.pending = p.pending[end:]
			return result
		}
		if err := p.read(t); err != nil {
			t.Fatalf("PTY ended before %q: %v\noutput: %q", text, err, p.transcript.String())
		}
	}
}

func (p *tuiPTY) write(t *testing.T, keys string) {
	t.Helper()
	if _, err := io.WriteString(p.master, keys); err != nil {
		t.Fatal(err)
	}
}

func (p *tuiPTY) frame(t *testing.T, message string) string {
	t.Helper()
	// Consume a new frame and its final footer, not a match in stale output.
	p.until(t, "\x1b[H\x1b[2J")
	width := min(p.width-1, 180)
	if len(message) > width {
		message = message[:width-3] + "..."
	}
	frame := tuiSGR.ReplaceAllString(p.until(t, message), "")
	lines := strings.Split(frame, "\r\n")
	if len(lines) != p.height-1 {
		t.Errorf("frame has %d rows, want %d: %q", len(lines), p.height-1, frame)
	}
	for _, line := range lines {
		if len(line) > width {
			t.Errorf("ASCII frame row exceeds %d columns: %q", width, line)
		}
	}
	if !strings.Contains(p.transcript.String(), "\x1b[?1049h\x1b[?25l") {
		t.Error("TUI did not enter alternate screen and hide cursor")
	}
	return frame
}

func assertTUISelected(t *testing.T, frame, id string) {
	t.Helper()
	got := tuiSelection.FindAllStringSubmatch(frame, -1)
	if id == "" && len(got) == 0 {
		return
	}
	if len(got) != 1 || got[0][1] != id {
		t.Fatalf("selection = %v, want only %q:\n%s", got, id, frame)
	}
}

func (p *tuiPTY) finish(t *testing.T, wantCode int, diagnostic string) string {
	t.Helper()
	select {
	case <-p.done:
	case <-p.ctx.Done():
		t.Fatalf("CLI did not exit: %v\noutput: %q", p.ctx.Err(), p.transcript.String())
	}
	if got := p.cmd.ProcessState.ExitCode(); got != wantCode {
		t.Errorf("CLI exit = %d, want %d: %v\nstderr: %s", got, wantCode, p.waitErr, &p.stderr)
	}
	if diagnostic == "" {
		if p.stderr.Len() != 0 {
			t.Errorf("unexpected stderr: %s", &p.stderr)
		}
	} else {
		assertCLIContains(t, p.stderr.String(), "kanban:", diagnostic)
	}
	if strings.Contains(p.stderr.String(), "DATA RACE") {
		t.Errorf("subprocess race detector reported:\n%s", &p.stderr)
	}
	if got := tuiTermios(t, p.slave); got != p.original {
		t.Errorf("terminal attributes were not restored:\ngot  %+v\nwant %+v", got, p.original)
	}
	if err := p.slave.Close(); err != nil {
		t.Fatal(err)
	}
	// Closing the last slave yields EIO on Linux after all buffered output drains.
	for {
		err := p.read(t)
		if errors.Is(err, syscall.EIO) || errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	output := p.transcript.String()
	if enter := strings.Index(output, "\x1b[?1049h\x1b[?25l"); enter >= 0 {
		cleanup := "\x1b[?25h\x1b[?1049l"
		if strings.Count(output, cleanup) != 1 || strings.Index(output, cleanup) <= enter {
			t.Errorf("missing, repeated, or out-of-order screen cleanup: %q", output)
		}
	}
	return output
}

func TestTUIPTY(t *testing.T) {
	// e2e_test.go has no TestMain/shared build function. Build main once for this
	// suite and reuse cliE2E for external edits. Match the parent race setting
	// so ordinary go test needs neither CGO nor a C compiler.
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(t.TempDir(), "kanban")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	buildArgs := []string{"build", "-o", binary}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			if setting.Key == "-race" && setting.Value == "true" {
				buildArgs = append(buildArgs, "-race")
			}
		}
	}
	buildArgs = append(buildArgs, ".")
	build := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin", "go"), buildArgs...)
	build.Dir = root
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build CLI: %v\n%s", err, output)
	}
	fixture := func(t *testing.T, titles ...string) (cliE2E, *cliHarness) {
		t.Helper()
		h := newCLIHarness(t)
		h.mustRun(t, "init")
		for _, title := range titles {
			h.mustRun(t, "add", title, "--desc=Details only: first line\nSecond description line", "--priority=high")
		}
		return cliE2E{binary: binary, dir: filepath.Dir(h.path), envDB: h.path}, h
	}

	t.Run("TTY color policy", func(t *testing.T) {
		e, h := fixture(t, "Color policy task")
		before := readCLIBytes(t, h.path)
		for _, command := range []string{"board", "list"} {
			for _, tt := range []struct {
				name  string
				env   []string
				color bool
			}{
				{"default", nil, true},
				{"NO_COLOR", []string{"NO_COLOR=1"}, false},
				{"TERM dumb", []string{"TERM=dumb"}, false},
			} {
				t.Run(command+"/"+tt.name, func(t *testing.T) {
					p := startTUICLI(t, e, 120, 24, tt.env, command)
					output := p.finish(t, 0, "")
					assertCLIContains(t, output, "Color policy task", h.board(t).Tasks[0].ID)
					if tuiSGR.MatchString(output) != tt.color {
						t.Errorf("SGR color presence = %v, want %v: %q", tuiSGR.MatchString(output), tt.color, output)
					}
					if !tt.color && strings.Contains(output, "\x1b") {
						t.Errorf("plain output contains terminal escapes: %q", output)
					}
				})
			}
		}
		for _, format := range []string{"json", "markdown"} {
			t.Run("export/"+format, func(t *testing.T) {
				p := startTUICLI(t, e, 120, 24, nil, "export", "--format="+format)
				output := p.finish(t, 0, "")
				if strings.Contains(output, "\x1b") {
					t.Errorf("TTY export contains terminal escapes: %q", output)
				}
				if format == "json" {
					if got := decodeCLIBoard(t, []byte(output)); !reflect.DeepEqual(got, h.board(t)) {
						t.Error("TTY JSON export differs from persisted board")
					}
				} else {
					assertCLIContains(t, output, "# Kanban Board", "Color policy task", "Second description line")
				}
			})
		}
		assertCLIUnchanged(t, h.path, before)
	})

	t.Run("navigation moves details and reload", func(t *testing.T) {
		e, h := fixture(t, "First todo", "Second todo", "First doing", "Second doing", "Finished task")
		tasks := h.board(t).Tasks
		for _, task := range tasks[2:4] {
			h.mustRun(t, "move", task.ID, "doing")
		}
		h.mustRun(t, "done", tasks[4].ID)
		tasks = h.board(t).Tasks
		before := readCLIBytes(t, h.path)
		p := startTUICLI(t, e, 120, 30, nil, "tui")
		assertTUISelected(t, p.frame(t, tuiInitialMessage), tasks[0].ID)
		for _, step := range []struct {
			key string
			row int
		}{
			{"j", 1}, {"j", 1}, {"k", 0}, {"k", 0}, {"h", 0},
			{"l", 2}, {"j", 3}, {"h", 0}, {"l", 3},
			{"\x1b[A", 2}, {"\x1b[B", 3}, {"\x1b[C", 4}, {"l", 4}, {"\x1b[D", 3},
			{"\x1bOA", 2}, {"\x1bOB", 3}, {"\x1bOC", 4}, {"\x1bOD", 3}, {"h", 0}, {"j", 1},
		} {
			p.write(t, step.key)
			assertTUISelected(t, p.frame(t, tuiInitialMessage), tasks[step.row].ID)
		}
		assertCLIUnchanged(t, h.path, before)
		id := tasks[1].ID
		for _, step := range []struct{ key, status string }{{"2", "doing"}, {"3", "done"}, {"1", "todo"}, {"d", "done"}} {
			p.write(t, step.key)
			assertTUISelected(t, p.frame(t, "Moved "+id+" to "+step.status+"."), id)
			got := h.board(t).Tasks
			if !got[1].UpdatedAt.After(tasks[1].UpdatedAt) {
				t.Error("move did not advance UpdatedAt")
			}
			tasks[1].Status, tasks[1].UpdatedAt = step.status, got[1].UpdatedAt
			if !reflect.DeepEqual(got, tasks) {
				t.Fatalf("move lost fields or changed another task:\ngot  %+v\nwant %+v", got, tasks)
			}
		}
		message := "Moved " + id + " to done."
		p.write(t, "\r")
		details := p.frame(t, message)
		assertCLIContains(t, details, "TASK DETAILS", id, "Second todo", "Description:", "Details only: first line", "Second description line", "Enter: board")
		p.write(t, "\r")
		assertTUISelected(t, p.frame(t, message), id)
		e.mustRun(t, "edit", id, "--title=Externally edited")
		e.mustRun(t, "move", id, "todo")
		p.write(t, "r")
		frame := p.frame(t, "Refreshed from disk.")
		assertTUISelected(t, frame, id)
		assertCLIContains(t, frame, "Externally edited", "Todo (2)", "Doing (2)", "Done (1)", "Todo 2/2")
		e.mustRun(t, "delete", id, "--yes")
		p.write(t, "r")
		assertTUISelected(t, p.frame(t, "Refreshed from disk."), tasks[0].ID)
		before = readCLIBytes(t, h.path)
		p.write(t, "q")
		p.finish(t, 0, "")
		assertCLIUnchanged(t, h.path, before)
	})

	t.Run("empty columns", func(t *testing.T) {
		e, h := fixture(t)
		before := readCLIBytes(t, h.path)
		p := startTUICLI(t, e, 100, 24, []string{"NO_COLOR=1"}, "tui")
		frame := p.frame(t, tuiInitialMessage)
		assertCLIContains(t, frame, "Todo (0)", "Doing (0)", "Done (0)", "No tasks yet")
		message := tuiInitialMessage
		for _, key := range []string{"h", "j", "k", "l", "2", "l", "d", "l", "h", "3", "1", "\r", "r"} {
			p.write(t, key)
			switch key {
			case "1", "2", "3", "d":
				message = "No task in this column. Use h/l to change columns."
			case "r":
				message = "Refreshed from disk."
			}
			assertTUISelected(t, p.frame(t, message), "")
		}
		p.write(t, "q")
		if output := p.finish(t, 0, ""); tuiSGR.MatchString(output) {
			t.Error("NO_COLOR TUI emitted SGR styling")
		}
		assertCLIUnchanged(t, h.path, before)
	})

	t.Run("empty lane with task elsewhere", func(t *testing.T) {
		e, h := fixture(t, "Stay in todo")
		before := readCLIBytes(t, h.path)
		id := h.board(t).Tasks[0].ID
		p := startTUICLI(t, e, 100, 24, nil, "tui")
		assertTUISelected(t, p.frame(t, tuiInitialMessage), id)
		p.write(t, "l")
		frame := p.frame(t, tuiInitialMessage)
		assertTUISelected(t, frame, "")
		assertCLIContains(t, frame, "Doing 0/0")
		p.write(t, "d")
		message := "No task in this column. Use h/l to change columns."
		assertTUISelected(t, p.frame(t, message), "")
		p.write(t, "h")
		assertTUISelected(t, p.frame(t, message), id)
		p.write(t, "q")
		p.finish(t, 0, "")
		assertCLIUnchanged(t, h.path, before)
	})

	t.Run("interrupt cleanup", func(t *testing.T) {
		for _, mode := range []string{"q", "Ctrl-C", "SIGTERM"} {
			t.Run(mode, func(t *testing.T) {
				e, h := fixture(t, "Keep me")
				before := readCLIBytes(t, h.path)
				p := startTUICLI(t, e, 100, 24, nil, "tui")
				p.frame(t, tuiInitialMessage)
				raw := tuiTermios(t, p.slave)
				if raw.Lflag&(syscall.ECHO|syscall.ICANON) != 0 || raw.Lflag&syscall.ISIG == 0 || raw.Oflag&syscall.OPOST != 0 {
					t.Errorf("TUI did not enter unechoed, unbuffered signal-enabled raw mode: %+v", raw)
				}
				code, diagnostic := 130, "interrupted"
				switch mode {
				case "q":
					p.write(t, "q")
					code, diagnostic = 0, ""
				case "Ctrl-C":
					p.write(t, "\x03")
				case "SIGTERM":
					if err := p.cmd.Process.Signal(syscall.SIGTERM); err != nil {
						t.Fatal(err)
					}
				}
				p.finish(t, code, diagnostic)
				assertCLIUnchanged(t, h.path, before)
			})
		}
	})

	t.Run("terminal size", func(t *testing.T) {
		for _, size := range [][2]int{{19, 24}, {100, 7}} {
			t.Run(fmt.Sprintf("too small %dx%d", size[0], size[1]), func(t *testing.T) {
				e, h := fixture(t, "Keep me")
				before := readCLIBytes(t, h.path)
				p := startTUICLI(t, e, size[0], size[1], nil, "tui")
				output := p.finish(t, 1, "at least 20 columns by 8 rows")
				assertCLIContains(t, output, "\x1b[?1049h", "\x1b[?25h\x1b[?1049l")
				assertCLIUnchanged(t, h.path, before)
			})
		}
		t.Run("resize and viewport", func(t *testing.T) {
			e, h := fixture(t, "First task", "Second task", "Third task", "Fourth task")
			before := readCLIBytes(t, h.path)
			p := startTUICLI(t, e, 100, 24, nil, "tui")
			tasks := h.board(t).Tasks
			assertTUISelected(t, p.frame(t, tuiInitialMessage), tasks[0].ID)
			for _, size := range [][2]int{{45, 12}, {20, 8}, {120, 30}} {
				p.resize(t, size[0], size[1])
				// Wait for the application's size poll; no input or sleep triggers it.
				assertTUISelected(t, p.frame(t, tuiInitialMessage), tasks[0].ID)
			}
			p.resize(t, 45, 12)
			p.frame(t, tuiInitialMessage)
			for _, task := range tasks[1:] {
				p.write(t, "j")
				assertTUISelected(t, p.frame(t, tuiInitialMessage), task.ID)
			}
			for i := len(tasks) - 2; i >= 0; i-- {
				p.write(t, "k")
				assertTUISelected(t, p.frame(t, tuiInitialMessage), tasks[i].ID)
			}
			p.resize(t, 19, 7)
			p.finish(t, 1, "at least 20 columns by 8 rows")
			assertCLIUnchanged(t, h.path, before)
		})
	})

	t.Run("TERM dumb rejects TUI", func(t *testing.T) {
		e, h := fixture(t, "Keep me")
		before := readCLIBytes(t, h.path)
		p := startTUICLI(t, e, 100, 24, []string{"TERM=dumb"}, "tui")
		if output := p.finish(t, 1, "tui requires terminal stdin and stdout"); output != "" {
			t.Errorf("rejected TUI changed screen: %q", output)
		}
		assertCLIUnchanged(t, h.path, before)
		_, diagnostic := e.run(t, "q\n", 1, "tui")
		assertCLIContains(t, diagnostic, "tui requires terminal stdin and stdout", "kanban board")
	})

	t.Run("modified arrow must not mutate tasks", func(t *testing.T) {
		e, h := fixture(t, "Keep me")
		before := readCLIBytes(t, h.path)
		p := startTUICLI(t, e, 100, 24, nil, "tui")
		p.frame(t, tuiInitialMessage)
		// Shift-Right is CSI 1;2C. Unsupported escape sequences may be ignored,
		// but their numeric parameters must never execute task-moving shortcuts.
		// The refresh footer is an ordered barrier after every sequence byte.
		p.write(t, "\x1b[1;2Cr")
		p.until(t, "Refreshed from disk.")
		p.write(t, "q")
		p.finish(t, 0, "")
		assertCLIUnchanged(t, h.path, before)
	})
}

func TestTUIRejectNonTTY(t *testing.T) {
	h := newCLIHarness(t)
	h.mustRun(t, "add", "Keep me")
	before := readCLIBytes(t, h.path)
	t.Setenv("KANBAN_DB", h.path)
	t.Setenv("TERM", "xterm-256color")
	for _, mode := range []string{"stdin pipe", "stdout pipe", "non-file streams"} {
		t.Run(mode, func(t *testing.T) {
			p := newTUIPTY(t, 100, 24)
			r, w, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { r.Close(); w.Close() })
			var in io.Reader = p.slave
			var out io.Writer = p.slave
			var stdout, stderr bytes.Buffer
			switch mode {
			case "stdin pipe":
				in = r
			case "stdout pipe":
				out = w
			case "non-file streams":
				in, out = strings.NewReader("q\n"), &stdout
			}
			if code := Run([]string{"tui"}, in, out, &stderr); code != 1 {
				t.Errorf("non-TTY exit = %d, want 1", code)
			}
			assertCLIContains(t, stderr.String(), "kanban:", "tui requires terminal stdin and stdout", "kanban board")
			if got := tuiTermios(t, p.slave); got != p.original {
				t.Errorf("rejected TUI changed terminal attributes: %+v", got)
			}
			if stdout.Len() != 0 {
				t.Errorf("non-TTY wrote stdout: %q", &stdout)
			}
			assertCLIUnchanged(t, h.path, before)
		})
	}
}
