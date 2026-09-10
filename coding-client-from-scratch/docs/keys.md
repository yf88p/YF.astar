# KILN Terminal Keys

The composer stays available while a model or tool is running. Enter sends a new
request when idle and steers the current run when busy. Alt+Enter explicitly queues
a follow-up. The client owns the full session; the terminal keeps only a bounded
display cache. Display excerpts are marked, and collapsing output does not modify
the saved session.

Live user messages show attachment provenance: the attached path, text/image kind,
and media type, without dumping attachment contents. Saved tool-output paths stay
visible even when tools are collapsed or finish with an error or abort. The UI
distinguishes complete from incomplete captures and identifies stdout/stderr;
ask KILN to use `read_output` to inspect an artifact. These display references do
not automatically read files or bypass permissions.

| Key | Action |
| --- | --- |
| Enter | Submit, or steer an active run |
| Alt+Enter | Submit as a follow-up |
| Ctrl+j | Insert a newline; reliable alternative to Shift+Enter |
| Left / Right / Home / End | Move in the current line |
| Up / Down | Move between lines; recall history at the first / last line |
| Alt+Up / Alt+Down | Recall previous / next submitted draft |
| Shift+Left / Right / Home / End / Up / Down | Extend selection |
| Ctrl+a | Start of line |
| Ctrl+w | Cut selection, or the preceding word, to an internal buffer |
| Ctrl+v | Insert the internal buffer |
| Ctrl+p | Search configured models |
| Ctrl+o | Search saved sessions |
| Ctrl+k | Search slash commands; selection inserts a command for editing |
| Ctrl+g | Search the session tree and branch from a selected record |
| Tab | Fuzzy-search files and insert an `@file` reference |
| Alt+p | Toggle plan / build |
| Alt+t | Expand / collapse verbose tools |
| Alt+r | Expand / collapse reasoning |
| PgUp / PgDn | Scroll output, or the complete permission request |
| Ctrl+End | Return to live output |
| Ctrl+e | Edit the draft in `$VISUAL`, then `$EDITOR`, falling back to `vi` |
| Ctrl+y | Copy the latest assistant display text |
| Esc | Close a selector, deny a permission, or abort the active run |
| Ctrl+c | Abort an active run; otherwise quit |
| Ctrl+d | Quit |

Selectors use a text query, Up/Down, and Enter. Esc restores the unchanged
composer. File selection quotes paths using the client's literal `@"path"` or
`@'path'` syntax. Filenames that need quoting and contain both quote styles are rejected without
changing the draft rather than inserting an ambiguous attachment reference.
Bracketed paste is inserted atomically, including multiline content;
embedded Enter and control keys cannot submit, approve permissions, or quit.
Terminals must support bracketed paste to distinguish pasted newlines from typed
keys. On terminals without it, use Ctrl+e for safely importing multiline text.

Slash commands are supplied by the client, including `/model key`,
`/mode plan|build`, `/resume id`, `/branch leaf`, `/new`, `/fork`, `/compact`,
`/undo`, `/redo`, `/name`, `/label`, and `/thinking`. Command results appear in
the transcript. Use Ctrl+k to discover available arguments and descriptions.

## Permissions

Permission dialogs work before a client is attached, including initial workspace
trust. They show the exact command, cwd, resource, and reason in a scrollable
view. PgUp/PgDn reviews the whole request. Left/Right or Tab changes the choice;
Enter confirms. **Deny is the default.** Concurrent prompts are serialized.
Control characters in requests are displayed visibly as `\uXXXX`, not executed
or silently hidden. Small terminals show the currently selected decision in full.

- **Allow once** authorizes just this request.
- **Allow session (exact)** covers this exact command/resource in this cwd, not
  arbitrary commands from the same executable.
- **Pattern** requires typing an explicit, narrow pattern. There is no prefilled
  wildcard. The permission manager validates the pattern and scopes it to the
  requesting tool, action, and cwd. Invalid patterns are denied.
- Protected resources only offer deny or one-time approval.

Esc cancels pattern entry or denies the current request. Aborting a run closes
its prompts; quitting denies every outstanding prompt.

## External Editor

KILN runs the trusted local `$VISUAL` / `$EDITOR` command with `$SHELL` (or
`/bin/sh`), passing a safely quoted path inside a private OS temporary directory.
The file is mode `0600`. The full-screen UI is suspended and raw input is disabled
while the editor owns the terminal. A successful edit replaces the draft; failed
launches, nonzero exits, symlinks, and results over 128 KiB preserve it. Temporary
files are removed and the screen is restored on success and failure. Editor
configuration is a local shell command, not text supplied by a model or tool.

## Clipboard And Display

By default, Ctrl+y copies into KILN's internal buffer only. Ctrl+v inserts that
buffer into the composer. KILN never invokes a clipboard helper or writes OSC52
unless you explicitly set `KILN_CLIPBOARD=1`. With that opt-in, Ctrl+y sends OSC52
to the terminal clipboard. Terminal support and clipboard security settings vary;
the internal buffer remains available. Copying uses the latest bounded assistant
display text, so a marked excerpt is not a full-session export.

KILN uses amber and copper on charcoal with restrained cyan status. Set
`KILN_ASCII=1` for ASCII chrome. `NO_COLOR` disables color and selects ASCII;
`TERM=dumb` selects a monochrome ASCII fallback and disables bracketed-paste mode
negotiation and OSC52. A full-screen UI still requires cursor-addressing support.
Long composer lines scroll horizontally; multiline drafts scroll vertically.
Untrusted terminal control sequences and Blessed tags cannot style the UI or
execute terminal commands.
