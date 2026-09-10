# Kanban

A local-first Go command-line board for **Todo / Doing / Done**. Keep tasks,
descriptions, priorities, tags, and due dates in one JSON file. Built with Go's
standard library and no third-party dependencies. Runtime is entirely local:
no external services, accounts, or network calls.

## Install

Requires **Go 1.22 or newer**. From the repository root:

```sh
go build
./kanban --help
go install .
```

`go build` produces `kanban` (`kanban.exe` on Windows); `go install .` installs it.
Add Go's binary directory (`GOBIN`, or `$(go env GOPATH)/bin` by default) to your
`PATH`. Examples below use the installed `kanban`; use `./kanban` instead when
running the local build. See [platform limits](#storage-and-platforms) below.

## Quickstart

Run from the directory where you want to keep your board:

```sh
kanban init
kanban add "Ship API" --desc "Add pagination" --priority high --tag backend --due 2026-12-31
kanban add "Write release notes" --tag docs
kanban list
```

`add` prints the new task's ID. In the examples below, **`a1b2c3d4` is a
placeholder**: replace it with the actual eight-character lowercase hexadecimal
ID printed by `add` or shown by `list`. IDs must be supplied in full, not as prefixes.

```sh
kanban move a1b2c3d4 doing
kanban show a1b2c3d4
kanban list --status doing --tag backend
kanban board
kanban done a1b2c3d4
```

New tasks start in `todo` with priority `medium`, an empty description, no tags,
and no due date. Statuses are `todo`, `doing`, and `done`; priorities are `low`,
`medium`, `high`, and `urgent`. Due dates must be real dates in `YYYY-MM-DD` form.

## Commands

Angle-bracketed values are placeholders; square brackets indicate optional input.
Quote titles and other values containing spaces.

| Command | Purpose | Command-specific flags |
| --- | --- | --- |
| `init` | Create an empty board; safe to repeat, never overwrites an existing board. | None |
| `add <title>` | Add a task to Todo. | `--desc <text>`, `--priority <value>`, repeatable `--tag <tag>`, `--due <YYYY-MM-DD>` |
| `list` | List tasks in creation order, optionally filtered. | `--status <value>`, repeatable `--tag <tag>` |
| `board` | Show columns side by side, stacked on narrow terminals. | None |
| `show <id>` | Show every field, including the full description. | None |
| `move <id> <status>` | Move to `todo`, `doing`, or `done`. | None |
| `done <id>` | Mark a task done. | None |
| `edit <id>` | Change only the specified fields. | `--title <text>`, `--desc <text>`, `--priority <value>`, `--due <YYYY-MM-DD>`, repeatable `--tag <tag>`, `--clear-tags` |
| `delete <id>` | Delete after confirmation. | `--yes`, `-y` |
| `export` | Write JSON (default) or Markdown to stdout. | `--format json`, `--format markdown` |
| `import <file>` or `import -` | Merge a JSON board from a file or stdin. | None |
| `tui` | Keyboard-driven interactive board on Linux/macOS. | None |
| `help [command]` | Show general or command-specific help. | None |

Global flags are `--db <path>`, `--help` (or `-h`), and `--version`.
Use `kanban help edit` or `kanban edit --help` for focused help.

Globals work before or after the command, including after positional arguments.
Command-specific flags follow the command and may surround positional arguments.
Value options accept `--flag value` or `--flag=value`. Only `--tag` may be repeated.
Put all options before `--`, which makes subsequent arguments literal:

```sh
kanban list --db ./work/board.json --status todo
kanban add --tag docs -- "--literal task title"
kanban edit a1b2c3d4 --desc="--text starting with dashes"
```

### Tags And Editing

Tags match exactly and are **case-sensitive**: `backend` and `Backend` differ.
CLI tag values are trimmed and duplicates removed. Repeated list filters use
**AND**, not OR: `kanban list --tag backend --tag urgent` requires both tags.
A `--status` filter must also match when supplied.

`edit` requires at least one field. Omitted fields are retained; the task ID and
creation timestamp never change. Use empty values to clear description or due
date. Supplying `--tag` **replaces the entire tag list**, rather than appending.
`--clear-tags` removes all tags and cannot be combined with `--tag`.

```sh
kanban edit a1b2c3d4 --title "Ship API v2" --priority urgent
kanban edit a1b2c3d4 --desc "" --due ""
kanban edit a1b2c3d4 --tag backend --tag release
kanban edit a1b2c3d4 --clear-tags
```

`delete` prompts on stderr with `[y/N]`; only `y` or `yes` confirms, ignoring case.
Empty input, EOF, or another answer cancels. If the task changes while confirmation
is pending, deletion fails so you can review it again. Use `--yes` (or `-y`) only
when you intend to skip confirmation, such as in a script.

## Board Location

The board file is selected in this order:

1. `--db <path>`
2. Nonempty `KANBAN_DB`
3. `.kanban/board.json` in the **current working directory**

There is **no parent-directory auto-discovery**. Running in a subdirectory uses
that subdirectory's default board, not the project's parent board. Use an
explicit path or an absolute `KANBAN_DB` to share one board across directories.

`add` and `import` automatically create a missing board. `init` explicitly creates
one and validates an existing one without replacing it. Other board commands
require an existing board and task, as applicable; missing data returns an error
with guidance to run `kanban init` or find a full ID with `kanban list`.

This repository ignores only its root `/.kanban/` directory. In projects where
you use Kanban, add `.kanban/` to their `.gitignore` to keep local board data and
lock files out of Git. Custom `--db` locations need their own ignore rules.

## Export And Import

JSON is the default, round-trippable format. A successful JSON export writes
**only JSON to stdout**, with no status messages or color; errors go to stderr.
Markdown is for reading or sharing and **cannot be re-imported**.

```sh
kanban export --format json > board-backup.json
kanban export --format markdown > board.md
kanban --db ./restored/board.json import board-backup.json
kanban --db ./another/board.json import - < board-backup.json
```

Import is a merge, not a replacement or overwrite:

- New IDs are added with their fields, IDs, and timestamps preserved.
- Identical tasks with existing IDs are skipped. Tag order matters; timestamps
  are compared by instant, not timezone spelling.
- Any conflicting existing ID fails the entire import without changing the board.
- Invalid input leaves the existing board unchanged. There is no overwrite flag.

**Never redirect an export to the active database file**, including through an
alias or symlink. The shell truncates the destination *before* Kanban runs, so
`kanban export > .kanban/board.json` destroys the input before it can be read.
Export to a separate backup file elsewhere, as above. For a full replacement,
import into a separate board, inspect it, then optionally swap it into place
with all writers stopped and a backup of the previous board retained. Protect
exports separately: shell-created files do not inherit the store's permissions.

## JSON Schema

The on-disk board and JSON export use the same version 1 schema:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "a1b2c3d4",
      "title": "Ship API",
      "description": "Add pagination",
      "status": "todo",
      "priority": "high",
      "tags": ["backend"],
      "due": "2026-12-31",
      "created_at": "2026-09-07T10:00:00Z",
      "updated_at": "2026-09-07T10:00:00Z"
    }
  ]
}
```

All shown keys are required except `due`, which is omitted when unset. Empty
collections are arrays (`"tasks": []`, `"tags": []`), not `null`. IDs are unique
eight-character lowercase hex strings. Timestamps use RFC 3339 with optional
fractional seconds; exports normalize them to UTC without changing their instants.
`updated_at` must not precede `created_at`.

Loads and imports reject corrupted JSON, invalid task data, unknown schema
versions, unknown or incorrectly cased fields, duplicate fields or IDs, missing
required fields, and null fields. Board JSON and import input are limited to
**32 MiB**; writes are verified against the same decoder before publication.
An invalid existing board is not silently reset.

## Storage And Platforms

Use a **trusted local filesystem**. Linux and macOS updates publish a complete
same-directory temporary file by atomic rename, so readers see the old or new
board, not a partially written one. Files are fsynced before publication; the
containing directory and newly created directory entries are synced where supported.

- Temporary, board, and lock files use `0600`; new directories use `0700` (subject
  to umask). Existing directory permissions are left unchanged.
- Writers lock the full read-modify-write operation using an advisory `flock` on
  Linux/macOS. The sibling `<board-path>.lock` file is persistent, not a stale-lock
  marker. **Do not delete it**; the OS releases the lock on close or process exit.
- `init` uses a same-directory hard link for atomic create-without-overwrite,
  so its filesystem must support hard links.
- A post-publication sync failure reports that the change committed but durability
  is uncertain. Inspect the board before retrying. A crash may leave a temporary file.
- Windows builds support core noninteractive commands and use an exclusive file
  handle for writer locking. Permissions follow directory ACLs; directory fsync is
  unavailable, and Go does not guarantee atomic rename there. Crash/durability
  guarantees are weaker than on Linux/macOS. TUI and color are currently unsupported.
- Other platforms refuse writes when safe locking is unsupported. Network or
  synchronized filesystems are not promised local-filesystem locking or durability.

## Interactive Board

Run `kanban tui` on Linux/macOS with both stdin and stdout attached to terminals.
The board adapts to terminal resizes, scrolls to the selected task, and saves
changes immediately, not waiting until quit. Use a terminal at least 20 columns
by 8 rows. The footer identifies the active column, including empty columns.

| Key | Action |
| --- | --- |
| `h` / `l`, Left / Right | Change column. |
| `j` / `k`, Down / Up | Select a task; scroll while viewing details. |
| `1` / `2` / `3` | Move the selected task to Todo / Doing / Done. |
| `d` | Mark the selected task done. |
| Enter | Toggle full task details. |
| `r` | Refresh from disk. |
| `q`, Ctrl-C | Quit. |

On Linux/macOS, CLI color is automatic on a terminal. Set a nonempty `NO_COLOR`
or `TERM=dumb` to disable it; redirected output is uncolored.

## Development

```sh
go test ./...
go test -race ./...
```

Run tests from the repository root. `main.go` is the entry point; `internal/cli`
handles parsing and commands; `internal/model` defines tasks and validation;
`internal/store` owns persistence and locking; `internal/exchange` handles JSON,
Markdown, and merging. `internal/render` formats views, and `internal/terminal`
provides platform-specific terminal detection, sizing, and raw input support.
