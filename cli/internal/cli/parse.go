package cli

import (
	"fmt"
	"strconv"
	"strings"
)

type flagKind int

const (
	valueFlag flagKind = iota
	boolFlag
	repeatFlag
)

type commandSpec struct {
	usage   string
	summary string
	flags   map[string]flagKind
	details string
}

var commands = map[string]commandSpec{
	"init": {"init", "Create a local board without overwriting an existing one.", nil, ""},
	"add": {"add <title> [options]", "Create a task in Todo.", map[string]flagKind{
		"desc": valueFlag, "priority": valueFlag, "tag": repeatFlag, "due": valueFlag,
	}, `Options:
  --desc <text>       Description (default: empty)
  --priority <value>  low, medium, high, urgent (default: medium)
  --tag <tag>         Attach a tag; repeat for multiple tags
  --due <YYYY-MM-DD>  Optional due date

Example:
  kanban add "Ship API" --priority high --tag backend --due 2026-12-31
`},
	"list": {"list [options]", "List tasks in creation order, optionally filtered.", map[string]flagKind{
		"status": valueFlag, "tag": repeatFlag,
	}, `Options:
  --status <value>  todo, doing, done
  --tag <tag>       Require this tag; repeat to require all given tags

Example:
  kanban list --status doing --tag backend
`},
	"board": {"board", "Display Todo, Doing, and Done side by side (stacked on narrow terminals).", nil, ""},
	"show":  {"show <id>", "Show every field of a task, including its full description.", nil, ""},
	"move":  {"move <id> <todo|doing|done>", "Move a task to another column.", nil, "Example:\n  kanban move a1b2c3d4 doing\n"},
	"done":  {"done <id>", "Mark a task done.", nil, ""},
	"edit": {"edit <id> [options]", "Edit only the fields you specify; preserve the ID and creation time.", map[string]flagKind{
		"title": valueFlag, "desc": valueFlag, "priority": valueFlag,
		"due": valueFlag, "tag": repeatFlag, "clear-tags": boolFlag,
	}, `Options:
  --title <text>      Replace the title
  --desc <text>       Replace the description; --desc "" clears it
  --priority <value>  low, medium, high, urgent
  --due <YYYY-MM-DD>  Replace the due date; --due "" clears it
  --tag <tag>         Replace all tags; repeat for multiple tags
  --clear-tags       Remove all tags (cannot combine with --tag)

Example:
  kanban edit a1b2c3d4 --title "Ship v2" --priority medium --due 2027-01-15
`},
	"delete": {"delete <id> [--yes]", "Delete a task after confirmation.", map[string]flagKind{
		"yes": boolFlag,
	}, "Options:\n  --yes, -y  Skip the confirmation prompt (for scripts)\n"},
	"export": {"export [--format json|markdown]", "Write an export to stdout, without status messages or color.", map[string]flagKind{
		"format": valueFlag,
	}, "Options:\n  --format <value>  json (default, re-importable) or markdown\n\nExample:\n  kanban export --format json > backup.json\n"},
	"import": {"import <file|->", "Merge tasks from a JSON export; use - to read stdin.", nil,
		"New IDs are added, identical tasks are skipped, and conflicting IDs abort\nthe entire import without changing the board. IDs and timestamps are preserved.\n\nExample:\n  kanban --db archive/board.json import backup.json\n"},
	"tui": {"tui", "Open the keyboard-driven board (Linux and macOS terminals).", nil,
		"Keys:\n  h/l or Left/Right  Change column\n  j/k or Down/Up     Select task (scroll in details)\n  1 / 2 / 3         Move selected task to Todo / Doing / Done\n  d                 Mark selected task done\n  Enter             Toggle full task details\n  r                 Refresh from disk\n  q or Ctrl-C       Quit\n\nChanges are saved immediately. Requires terminal stdin and stdout.\n"},
	"help": {"help [command]", "Show help for a command.", nil, ""},
}

type invocation struct {
	command string
	args    []string
	flags   map[string][]string
}

func (p invocation) has(name string) bool { return len(p.flags[name]) > 0 }

func (p invocation) value(name string) string {
	if !p.has(name) {
		return ""
	}
	return p.flags[name][0]
}

func (p invocation) enabled(name string) bool { return p.value(name) == "true" }

// Parse options in place, rather than extracting globals first: a description
// containing "--db" must never be mistaken for a storage-path override.
func parse(args []string) (invocation, error) {
	p := invocation{flags: make(map[string][]string)}
	literal := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !literal && arg == "--" {
			literal = true
			continue
		}
		if !literal && len(arg) > 1 && arg[0] == '-' {
			name, val, inline := strings.Cut(arg, "=")
			switch name {
			case "-h":
				name = "--help"
			case "-y":
				name = "--yes"
			}
			if !strings.HasPrefix(name, "--") {
				return p, fmt.Errorf("unknown option %q; use --help", arg)
			}
			name = strings.TrimPrefix(name, "--")
			kind, known := commands[p.command].flags[name]
			switch name {
			case "db":
				kind, known = valueFlag, true
			case "help", "version":
				kind, known = boolFlag, true
			}
			if !known {
				return p, fmt.Errorf("unknown option %q; use %q", arg, strings.TrimSpace("kanban "+p.command)+" --help")
			}
			if kind != repeatFlag && p.has(name) {
				return p, fmt.Errorf("option --%s may only be specified once", name)
			}
			if kind == boolFlag {
				if !inline {
					val = "true"
				}
				b, err := strconv.ParseBool(val)
				if err != nil {
					return p, fmt.Errorf("--%s expects true or false, got %q", name, val)
				}
				val = strconv.FormatBool(b)
			} else if !inline {
				if i+1 == len(args) || strings.HasPrefix(args[i+1], "--") || args[i+1] == "-h" || args[i+1] == "-y" {
					return p, fmt.Errorf("--%s requires a value (use --%s=<value> for text starting with --)", name, name)
				}
				i++
				val = args[i]
			}
			if name == "db" && strings.TrimSpace(val) == "" {
				return p, fmt.Errorf("--db requires a nonempty file path")
			}
			p.flags[name] = append(p.flags[name], val)
			continue
		}
		if p.command == "" {
			if _, ok := commands[arg]; !ok {
				return p, fmt.Errorf("unknown command %q; use \"kanban --help\"", arg)
			}
			p.command = arg
		} else {
			p.args = append(p.args, arg)
		}
	}
	return p, nil
}

func (p invocation) requireArgs(n int) error {
	if len(p.args) != n {
		return fmt.Errorf("usage: kanban %s (expected %d positional argument(s), got %d)", commands[p.command].usage, n, len(p.args))
	}
	return nil
}
