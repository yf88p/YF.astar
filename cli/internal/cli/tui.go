package cli

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	"unicode"

	"kanban/internal/model"
	"kanban/internal/render"
	"kanban/internal/store"
	"kanban/internal/terminal"
)

var errInterrupted = errors.New("interrupted")

type cursor struct {
	column int
	rows   [3]int
}

func (c *cursor) selected(board model.Board) (*model.Task, [3][]model.Task) {
	var lanes [3][]model.Task
	for _, task := range board.Tasks {
		column := 0
		switch task.Status {
		case "doing":
			column = 1
		case "done":
			column = 2
		}
		lanes[column] = append(lanes[column], task)
	}
	c.column = min(2, max(0, c.column))
	for i := range lanes {
		c.rows[i] = min(max(0, len(lanes[i])-1), max(0, c.rows[i]))
	}
	if len(lanes[c.column]) == 0 {
		return nil, lanes
	}
	return &lanes[c.column][c.rows[c.column]], lanes
}

func (c *cursor) follow(board model.Board, id string) {
	_, lanes := c.selected(board)
	for column, lane := range lanes {
		for row, task := range lane {
			if task.ID == id {
				c.column, c.rows[column] = column, row
				return
			}
		}
	}
}

// cleanMessage keeps filesystem errors safe even if a path contains terminal
// control characters. Rendering task content has its own display sanitization.
func cleanMessage(text string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '\u2028' || r == '\u2029' {
			return ' '
		}
		return r
	}, text)
}

func (a *app) tui(db *store.Store) (err error) {
	in, inOK := a.in.(*os.File)
	out, outOK := a.out.(*os.File)
	if !inOK || !outOK || !terminal.IsTerminal(in) || !terminal.IsTerminal(out) || a.getenv("TERM") == "dumb" {
		return fmt.Errorf("tui requires terminal stdin and stdout on Linux or macOS; use \"kanban board\" for plain output")
	}
	board, err := load(db)
	if err != nil {
		return err
	}
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGQUIT)
	defer signal.Stop(interrupts)
	restore, err := terminal.Raw(in)
	if err != nil {
		return err
	}
	defer func() {
		_, screenErr := io.WriteString(out, "\x1b[?25h\x1b[?1049l")
		err = errors.Join(err, screenErr, restore())
	}()
	if _, err := io.WriteString(out, "\x1b[?1049h\x1b[?25l"); err != nil {
		return err
	}
	type input struct {
		key byte
		err error
	}
	keys := make(chan input)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		var b [1]byte
		for {
			n, err := in.Read(b[:])
			if n == 0 && err == nil {
				continue
			}
			select {
			case keys <- input{b[0], err}:
			case <-stop:
				return
			}
			if err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	c := cursor{}
	details, dirty := false, true
	top, escape, lastWidth, lastHeight := 0, 0, 0, 0
	message := "Changes save immediately. Use r to pick up edits from another terminal."
	for {
		width, height := terminal.Size(out)
		if width < 20 || height < 8 {
			return fmt.Errorf("tui needs a terminal at least 20 columns by 8 rows; use \"kanban board\"")
		}
		if width != lastWidth || height != lastHeight {
			dirty = true
			lastWidth, lastHeight = width, height
		}
		selected, lanes := c.selected(board)
		if dirty {
			opts := a.display
			opts.Width = min(width-1, 180)
			if selected != nil {
				opts.SelectedID = selected.ID
			}
			view := ""
			if details && selected != nil {
				view = render.Details(*selected, opts)
			} else {
				view = render.Board(board.Tasks, opts)
			}
			lines := strings.Split(strings.TrimSuffix(view, "\n"), "\n")
			available := height - 4
			if !details && selected != nil {
				for row, line := range lines {
					if strings.Contains(line, "> "+selected.ID) && (row < top || row+5 >= top+available) {
						top = row
						break
					}
				}
			}
			top = min(max(0, len(lines)-available), max(0, top))
			var frame strings.Builder
			frame.WriteString("\x1b[H\x1b[2J")
			for row := top; row < top+available; row++ {
				if row < len(lines) {
					frame.WriteString(lines[row])
				}
				frame.WriteString("\r\n")
			}
			footer := func(text string) {
				// ASCII substitution keeps wide or invisible path characters from
				// breaking the fixed-height footer on an error.
				text = cleanMessage(text)
				var b strings.Builder
				for _, r := range text {
					if r > 126 {
						r = '?'
					}
					b.WriteRune(r)
				}
				text = b.String()
				if len(text) > opts.Width {
					text = text[:opts.Width-3] + "..."
				}
				frame.WriteString(text)
			}
			help := "h/l: column  j/k: task  Enter: details  q: quit"
			if details {
				help = "j/k: scroll  Enter: board  q: quit"
			} else if width < 60 {
				help = "h/l j/k: select  Enter: view  q: quit"
			}
			footer(help)
			frame.WriteString("\r\n")
			position := 0
			if selected != nil {
				position = c.rows[c.column] + 1
			}
			footer(fmt.Sprintf("1/2/3: move  d: done  r: refresh | %s %d/%d", []string{"Todo", "Doing", "Done"}[c.column], position, len(lanes[c.column])))
			frame.WriteString("\r\n")
			footer(message)
			if _, err := io.WriteString(out, frame.String()); err != nil {
				return err
			}
			dirty = false
		}
		select {
		case <-interrupts:
			return errInterrupted
		case <-ticker.C:
			continue
		case event := <-keys:
			if event.err != nil {
				if errors.Is(event.err, io.EOF) {
					return nil
				}
				return fmt.Errorf("read terminal: %w", event.err)
			}
			key := event.key
			if key == 27 {
				escape = 1
				continue
			}
			if escape == 1 {
				escape = 0
				if key == '[' || key == 'O' {
					escape = 2
				}
				continue
			}
			if escape == 2 {
				// Consume the whole CSI/SS3 sequence. Modifier digits in keys
				// such as Shift-Right (ESC [ 1 ; 2 C) are not move shortcuts.
				if key >= 0x20 && key <= 0x3f {
					continue
				}
				escape = 0
				switch key {
				case 'A':
					key = 'k'
				case 'B':
					key = 'j'
				case 'C':
					key = 'l'
				case 'D':
					key = 'h'
				default:
					continue
				}
			}
			if key == 'q' || key == 4 {
				return nil
			}
			dirty = true
			switch key {
			case 'h':
				if !details {
					c.column--
				}
			case 'l':
				if !details {
					c.column++
				}
			case 'j', 'k':
				delta := 1
				if key == 'k' {
					delta = -1
				}
				if details {
					top += delta
				} else {
					c.rows[c.column] += delta
				}
			case '\r', '\n':
				if selected != nil {
					details = !details
					top = 0
				}
			case '1', '2', '3', 'd':
				if selected == nil {
					message = "No task in this column. Use h/l to change columns."
					continue
				}
				status := "done"
				if key == '1' {
					status = "todo"
				} else if key == '2' {
					status = "doing"
				}
				if err := a.updateTask(db, selected.ID, func(task *model.Task) error {
					task.Status = status
					return nil
				}); err != nil {
					message = "Error: " + err.Error()
					continue
				}
				message = fmt.Sprintf("Moved %s to %s.", selected.ID, status)
				fallthrough
			case 'r':
				fresh, err := load(db)
				if err != nil {
					message = "Error: " + err.Error()
					continue
				}
				board = fresh
				if selected != nil {
					c.follow(board, selected.ID)
				}
				if key == 'r' {
					message = "Refreshed from disk."
				}
			}
		}
	}
}
