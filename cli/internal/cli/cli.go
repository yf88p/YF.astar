// Package cli implements the command-line application with injectable I/O.
package cli

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"

	"kanban/internal/exchange"
	"kanban/internal/model"
	"kanban/internal/render"
	"kanban/internal/store"
	"kanban/internal/terminal"
)

type app struct {
	in      io.Reader
	out     io.Writer
	errOut  io.Writer
	getenv  func(string) string
	now     func() time.Time
	display render.Options
}

// Run returns an exit status without exiting the process. Normal output goes to
// stdout; prompts and errors go to stderr, keeping exports safe for pipelines.
func Run(args []string, in io.Reader, out, errOut io.Writer) int {
	a := app{in: in, out: out, errOut: errOut, getenv: os.Getenv, now: time.Now}
	a.display.Width = 80
	if f, ok := out.(*os.File); ok && terminal.IsTerminal(f) {
		a.display.Width, _ = terminal.Size(f)
		a.display.Color = os.Getenv("NO_COLOR") == "" && os.Getenv("TERM") != "dumb"
	}
	if width, err := strconv.Atoi(os.Getenv("COLUMNS")); err == nil && width > 0 && width <= 500 {
		a.display.Width = width
	}
	if err := a.run(args); err != nil {
		fmt.Fprintf(errOut, "kanban: %s\n", cleanMessage(err.Error()))
		if errors.Is(err, errInterrupted) {
			return 130
		}
		return 1
	}
	return 0
}

func (a *app) print(format string, args ...any) error {
	_, err := fmt.Fprintf(a.out, format, args...)
	return err
}

func (a *app) run(args []string) error {
	p, err := parse(args)
	if err != nil {
		return err
	}
	if p.enabled("version") {
		return a.print("kanban %s\n", version)
	}
	if p.command == "help" {
		if len(p.args) > 1 {
			return fmt.Errorf("usage: kanban help [command]")
		}
		if len(p.args) == 0 {
			return a.print("%s", help)
		}
		if _, ok := commands[p.args[0]]; !ok {
			return fmt.Errorf("unknown command %q; use \"kanban --help\"", p.args[0])
		}
		return a.print("%s", commandHelp(p.args[0]))
	}
	if p.command == "" || p.enabled("help") {
		if p.command == "" {
			return a.print("%s", help)
		}
		return a.print("%s", commandHelp(p.command))
	}
	path := p.value("db")
	if !p.has("db") {
		path = a.getenv("KANBAN_DB")
		if path == "" {
			path = ".kanban/board.json"
		}
	}
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("KANBAN_DB must be a nonempty file path")
	}
	db := &store.Store{Path: path}
	count := 0
	switch p.command {
	case "add", "show", "done", "edit", "delete", "import":
		count = 1
	case "move":
		count = 2
	}
	if err := p.requireArgs(count); err != nil {
		return err
	}
	switch p.command {
	case "init":
		created, err := db.Init()
		if err != nil {
			return err
		}
		if !created {
			return a.print("Board already initialized at %q.\n", path)
		}
		return a.print("Initialized board at %q.\n", path)
	case "add":
		return a.add(db, p)
	case "list":
		if p.has("status") {
			if err := model.ValidateStatus(p.value("status")); err != nil {
				return err
			}
		}
		tags, err := model.NormalizeTags(p.flags["tag"])
		if err != nil {
			return err
		}
		board, err := load(db)
		if err != nil {
			return err
		}
		tasks := make([]model.Task, 0, len(board.Tasks))
		for _, task := range board.Tasks {
			if p.has("status") && task.Status != p.value("status") {
				continue
			}
			if !slices.ContainsFunc(tags, func(tag string) bool { return !slices.Contains(task.Tags, tag) }) {
				tasks = append(tasks, task)
			}
		}
		if len(tasks) == 0 && (p.has("status") || len(tags) > 0) {
			return a.print("No tasks match these filters. Run \"kanban list\" to see all tasks.\n")
		}
		return a.print("%s", render.List(tasks, a.display))
	case "board", "show":
		board, err := load(db)
		if err != nil {
			return err
		}
		if p.command == "board" {
			return a.print("%s", render.Board(board.Tasks, a.display))
		}
		i, err := taskIndex(&board, p.args[0])
		if err != nil {
			return err
		}
		return a.print("%s", render.Details(board.Tasks[i], a.display))
	case "move", "done":
		status := "done"
		if p.command == "move" {
			status = p.args[1]
		}
		if err := model.ValidateStatus(status); err != nil {
			return err
		}
		if err := a.updateTask(db, p.args[0], func(task *model.Task) error {
			task.Status = status
			return nil
		}); err != nil {
			return err
		}
		return a.print("Moved %s to %s.\n", p.args[0], status)
	case "edit":
		return a.edit(db, p)
	case "delete":
		return a.delete(db, p)
	case "export":
		format := "json"
		if p.has("format") {
			format = p.value("format")
		}
		if format != "json" && format != "markdown" {
			return fmt.Errorf("invalid export format %q (want json or markdown)", format)
		}
		board, err := load(db)
		if err != nil {
			return err
		}
		if format == "markdown" {
			return exchange.Markdown(a.out, board)
		}
		return exchange.JSON(a.out, board)
	case "import":
		return a.importBoard(db, p.args[0])
	case "tui":
		return a.tui(db)
	}
	return fmt.Errorf("unknown command %q", p.command)
}

func load(db *store.Store) (model.Board, error) {
	board, err := db.Load()
	if errors.Is(err, store.ErrNotInitialized) {
		return model.Board{}, fmt.Errorf("board at %q is not initialized; run \"kanban init\" or add a task", db.Path)
	}
	return board, err
}

func taskIndex(board *model.Board, id string) (int, error) {
	for i := range board.Tasks {
		if board.Tasks[i].ID == id {
			return i, nil
		}
	}
	return 0, fmt.Errorf("task %q not found; use the full ID from \"kanban list\"", id)
}

func (a *app) add(db *store.Store, p invocation) error {
	if p.has("priority") {
		if err := model.ValidatePriority(p.value("priority")); err != nil {
			return err
		}
	}
	newTask := func() (model.Task, error) {
		return model.NewTask(p.args[0], p.value("desc"), p.value("priority"), p.flags["tag"], p.value("due"), a.now())
	}
	task, err := newTask()
	if err != nil {
		return err
	}
	if err := db.Update(func(board *model.Board) error {
		// Resolve even a rare random ID collision while holding the writer lock.
		for attempts := 0; attempts < 16; attempts++ {
			if !slices.ContainsFunc(board.Tasks, func(existing model.Task) bool { return existing.ID == task.ID }) {
				board.Tasks = append(board.Tasks, task)
				return nil
			}
			task, err = newTask()
			if err != nil {
				return err
			}
		}
		return fmt.Errorf("could not allocate a unique task ID; try again")
	}); err != nil {
		return err
	}
	return a.print("Added %s to todo: %q\n", task.ID, task.Title)
}

func (a *app) updateTask(db *store.Store, id string, change func(*model.Task) error) error {
	return db.Update(func(board *model.Board) error {
		i, err := taskIndex(board, id)
		if err != nil {
			return err
		}
		task := &board.Tasks[i]
		if err := change(task); err != nil {
			return err
		}
		now := a.now().UTC()
		// Imported timestamps or a clock adjustment must not move time backward.
		if !now.After(task.UpdatedAt) {
			now = task.UpdatedAt.Add(time.Nanosecond)
		}
		task.UpdatedAt = now
		return model.ValidateTask(*task)
	})
}

func (a *app) edit(db *store.Store, p invocation) error {
	if !p.has("title") && !p.has("desc") && !p.has("priority") && !p.has("due") && !p.has("tag") && !p.enabled("clear-tags") {
		return fmt.Errorf("edit requires at least one field; use \"kanban edit --help\"")
	}
	if p.has("tag") && p.enabled("clear-tags") {
		return fmt.Errorf("--tag and --clear-tags cannot be combined")
	}
	tags, err := model.NormalizeTags(p.flags["tag"])
	if err != nil {
		return err
	}
	if err := a.updateTask(db, p.args[0], func(task *model.Task) error {
		for _, field := range []struct {
			name string
			dest *string
		}{{"title", &task.Title}, {"desc", &task.Description}, {"priority", &task.Priority}, {"due", &task.Due}} {
			if p.has(field.name) {
				*field.dest = p.value(field.name)
			}
		}
		if p.has("tag") || p.enabled("clear-tags") {
			task.Tags = tags
		}
		if err := model.ValidateTask(*task); err != nil {
			return err
		}
		task.Title = strings.TrimSpace(task.Title)
		return nil
	}); err != nil {
		return err
	}
	return a.print("Updated %s.\n", p.args[0])
}

func (a *app) delete(db *store.Store, p invocation) error {
	id := p.args[0]
	var confirmed *model.Task
	if !p.enabled("yes") {
		board, err := load(db)
		if err != nil {
			return err
		}
		i, err := taskIndex(&board, id)
		if err != nil {
			return err
		}
		confirmed = &board.Tasks[i]
		if _, err := fmt.Fprintf(a.errOut, "Delete %s %q? [y/N] ", id, confirmed.Title); err != nil {
			return err
		}
		scanner := bufio.NewScanner(a.in)
		scanner.Buffer(make([]byte, 256), 4096)
		answer := ""
		if scanner.Scan() {
			answer = strings.ToLower(strings.TrimSpace(scanner.Text()))
		}
		if err := scanner.Err(); err != nil {
			return fmt.Errorf("read confirmation: %w", err)
		}
		if answer != "y" && answer != "yes" {
			return a.print("Deletion cancelled.\n")
		}
	}
	if err := db.Update(func(board *model.Board) error {
		i, err := taskIndex(board, id)
		if err != nil {
			return err
		}
		if confirmed != nil && !reflect.DeepEqual(*confirmed, board.Tasks[i]) {
			return fmt.Errorf("task %s changed while awaiting confirmation; review it and retry", id)
		}
		board.Tasks = append(board.Tasks[:i], board.Tasks[i+1:]...)
		return nil
	}); err != nil {
		return err
	}
	return a.print("Deleted %s.\n", id)
}

func (a *app) importBoard(db *store.Store, path string) error {
	var source model.Board
	var err error
	if path == "-" {
		source, err = exchange.Decode(a.in)
	} else {
		info, statErr := os.Stat(path)
		if statErr != nil {
			return fmt.Errorf("open import %q: %w", path, statErr)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("import %q must be a regular JSON file (or use - for stdin)", path)
		}
		f, openErr := os.Open(path)
		if openErr != nil {
			return fmt.Errorf("open import %q: %w", path, openErr)
		}
		source, err = exchange.Decode(f)
		err = errors.Join(err, f.Close())
	}
	if err != nil {
		return fmt.Errorf("import %q: %w", path, err)
	}
	added, skipped := 0, 0
	if err := db.Update(func(board *model.Board) error {
		var err error
		added, skipped, err = exchange.Merge(board, source)
		return err
	}); err != nil {
		return err
	}
	return a.print("Imported %d task(s); skipped %d identical task(s).\n", added, skipped)
}
