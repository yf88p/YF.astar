package cli

const version = "1.0.0"

const help = `kanban - a local board, a little less context switching.

Usage:
  kanban [--db <path>] <command> [options]

Commands:
  init                 Create a local board (safe to repeat)
  add <title>          Add a task to Todo
  list                 List tasks; filter with --status and --tag
  board                Display Todo / Doing / Done
  show <id>            Show a task's full details
  move <id> <status>   Move a task to todo, doing, or done
  done <id>            Mark a task done
  edit <id>            Edit a task's fields
  delete <id>          Delete with confirmation; --yes skips the prompt
  export               Export JSON or Markdown to stdout
  import <file|->      Merge a JSON export, preserving IDs
  tui                  Interactive board (Linux / macOS)
  help [command]       Show command-specific help

Global Options:
  --db <path>          Board file; overrides KANBAN_DB
  --help, -h           Show help
  --version            Print the version

Storage:
  --db > KANBAN_DB > .kanban/board.json in the current directory.
  add and import create a board if missing. No accounts or network calls.
  Task IDs are 8 lowercase hex characters; use the full ID shown in list.
  Priorities: low, medium (default), high, urgent. New tasks start in todo.
  Tags are case-sensitive. Repeated list --tag filters require all tags.
  Options may follow positional arguments. Use -- before literal arguments.
  Color is automatic on a TTY; NO_COLOR or TERM=dumb disables it.

Examples:
  kanban init
  kanban add "Ship API" --desc "Add pagination" --priority high --tag backend
  kanban add "Release v1" --tag urgent --due 2026-12-31
  kanban move a1b2c3d4 doing
  kanban list --status doing --tag backend
  kanban board
  kanban export --format json > backup.json
  kanban --db archive/board.json import backup.json

Run kanban <command> --help for options and more examples.
`

func commandHelp(name string) string {
	spec := commands[name]
	text := "Usage: kanban " + spec.usage + "\n\n" + spec.summary + "\n\n"
	if spec.details != "" {
		text += spec.details + "\n"
	}
	return text + "Global: --db <path>, --help (-h), --version\n"
}
