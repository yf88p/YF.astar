# Automator

Automator runs coding-agent model comparisons on your local machine. Each selected model gets an independent project, the same prompt, git initialization with a baseline commit attempt, and its real tool's native session. A terminal dashboard manages drafts and runs; Markdown reports compare status, duration, token usage, and cost.

Automator is a native Go application. [SPEC.md](SPEC.md) documents its behavior, including preserved executable behavior where older prose differed. [DEVELOPMENT.md](DEVELOPMENT.md) covers architecture, isolated tests, and optional reference comparisons.

## Build

Install **Go 1.24 or newer**, then run the canonical production build from the repository root:

```bash
go build -trimpath -ldflags='-s -w' -o automator ./cmd/automator
```

The production binary does not need a Rust toolchain, reference executable, or provenance files. Its SQLite reader is pure Go: neither CGO nor a `sqlite3` executable is required. Tests, race checks, vet, mandatory reference comparisons, and private-PTY TUI/real-CLI workflows have passed on Linux. [CI](.github/workflows/ci.yml) provides Linux verification and macOS/Windows cross-compilation; native macOS and Windows runtime testing has not been performed.

To execute benchmarks, install `git`, a POSIX-compatible shell, and the selected coding-agent tools (`pi`, `opencode`, and/or `claude`). Headful runs also require `herdr`. Templates and hooks may need their own tools, such as Node.js or a package manager; Automator does not install them. Use `mode: headless` to run without Herdr.

Authentication is **solely owned by each coding-agent tool**. Automator does not accept, collect, store, or manage credentials. Configure and authenticate the tools using their own supported workflows. Provider entries are names and display metadata, not credential containers.

## First Run

```bash
./automator init
./automator
```

`init` creates missing configuration under `~/.automator/` without overwriting existing files. Set `AUTOMATOR_HOME` to use a different Automator config/history directory; it does not redirect the coding tools' own session storage. Initialization creates an empty model registry, an `empty` template, and a model preset registry. It does not install or authenticate agents.

1. Open **Models**, press `e`, and define models supported by your installed tools. Tab switches between Models, Presets, and Providers; `e` edits the active registry.
2. Press `n` to create a draft in the external editor. Set its output root, prompt, template, mode, concurrency, and optional hooks. The draft contains no model list.
3. On **Drafts**, press `x`, select models and/or presets with Space, then Enter to launch. Typing filters entries. Tab switches immediate launch to sequential FIFO launch.
4. Open **Runs** to inspect each model's status and paths. Enter attaches to its Herdr/native session; `o` opens its report.

The editor is `$EDITOR` (default `vi`); the report pager is `$PAGER` (default `less`). These settings are shell command strings, so editor/pager arguments are supported. The dashboard hands the terminal to them and restores its screen/input state afterward. Signal/context cancellation closes an active editor and restores the terminal through a graceful dashboard shutdown.

### Minimal Configuration

For a Claude Code model, an entry in `~/.automator/models.yaml` can look like:

```yaml
schema_version: 1
models:
  sonnet:
    display_name: Sonnet via Claude Code
    tool: claude
    provider: anthropic
    model: sonnet
    args:
      effort: high
```

`anthropic` must exist in `providers.yaml`; it is one of the initial provider entries. Model availability and accepted model IDs belong to the installed tool. See [SPEC.md](SPEC.md#config-examples) for Pi, OpenCode, templates, presets, and optional token pricing.

A draft at `~/.automator/drafts/example/v1.yaml`:

```yaml
schema_version: 1
name: example
root: ~/automator-runs
concurrency: 6
mode: headless
heavy: false
template: empty
prompt: |
  Implement a small command-line calculator with tests and usage documentation.
pre: []
post_each: []
post_all: []
```

The direct CLI equivalent is:

```bash
./automator models
./automator validate example --model sonnet
./automator run example --model sonnet
./automator report example
```

Review `validate` output before running. Missing agent/Herdr binaries are **advisory in validation**, not validation errors; actual run launch requires them. Validation prints shell steps but does not prove their dependencies or the output root are usable. Templates and hooks are executable user-supplied shell code, not a sandbox.

Run directories are versioned automatically (`example`, `example-v2`, ...), never overwritten. Each contains `run.yaml`, the exact `prompt.md`, `report.md`, per-model project directories, and `.automator/state/<model>.yaml`. The snapshot copies model/template/hook settings so later registry edits do not change an existing run. Herdr IDs and explicit repricing can update snapshot metadata.

## CLI Reference

Use `automator --help`, `automator help <command>`, or `automator <command> --help` for syntax, and `automator --version`/`-V` for the binary version. Examples assume the built executable is on PATH; use `./automator` otherwise. CLI exit codes are `0` for success, `1` for operational errors, `2` for usage errors, and `130` for cancellation. A failed model remains isolated: a completed run command can succeed while its report contains failed models.

| Command | Behavior |
|---|---|
| `automator` or `automator tui` | Open the dashboard. |
| `automator init` | Initialize missing config/history files without replacing existing registries. |
| `automator models` | List model keys, display names, tools, and provider/model identities. |
| `automator presets` | List preset keys, display names, and member model keys. |
| `automator validate <draft> [-m <key>] [-p <key>] [--run-heavy]` | Resolve the latest draft and selection; print candidate paths, commands, hooks, concurrency, and binary checks without launching agents. |
| `automator run <draft> [-m <key>] [-p <key>] [--run-heavy]` | Snapshot and execute the latest draft, or create paused states for a heavy draft. |
| `automator attach <run> <model>` | Focus/attach the recorded Herdr model session; a captured native reopen command is the fallback when Herdr is unavailable. |
| `automator start <run> <model> [--force]` | Dispatch a paused/queued model in place. Force permits other non-running states, but does not make a clean project or allow a duplicate running worker. |
| `automator stop <run> <model>` | Request cancellation of the selected running model, not its siblings. |
| `automator retry <run> <model> [--force]` | Move the previous project into `.automator/retry-backups/`, reset state, and run the fresh pipeline in the same run folder. Running models are rejected; force does not override this. |
| `automator continue <run> <model> [--force] [message...]` | Continue an existing OpenCode/Claude session and current files. The default message is `continue`. Running/queued models are rejected; force does not override this. |
| `automator report <run>` | Print the report path and existing Markdown contents. |
| `automator reprice [run]` | Recover supported historical usage and recalculate costs/report for one run or all indexed runs. It does not launch an agent. |

`-m`/`--model` and `-p`/`--preset` can be repeated or comma-separated:

```bash
automator run example --model sonnet,other-model --preset comparison-set
automator validate example -m sonnet -m other-model --run-heavy
automator continue example sonnet "Finish the tests and explain any failures."
```

Presets expand into model keys; duplicate models run once. Empty effective selections fail. Draft names select the latest numeric `vN` file, not an arbitrary YAML path. Run arguments accept an existing run path or indexed name; use a full path to disambiguate repeated human names.

### Hidden Commands

These are the internal subprocess interface, intentionally hidden from ordinary help. They operate on an existing snapshot; they are not a replacement for `run` or recovery commands:

```text
automator worker --run <run-dir> --model <key>
automator worker-failed --run <run-dir> --model <key> --error <message>
automator continue-worker --run <run-dir> --model <key> --message <message>
automator report-refresh --run <run-dir>
```

`worker` executes template -> pre -> git baseline -> agent -> post_each and persists state. `continue-worker` resumes a captured session without setup or hooks. `worker-failed` records premature child failure without overwriting a live worker or terminal state. `report-refresh` regenerates Markdown from snapshot/state. Herdr/headless dispatch invokes the same executable that launched the run.

The TUI also uses a private headless `tui` invocation with `AUTOMATOR_TUI_LOG_HELPER=1` to retain redacted launcher logs after the dashboard exits. Its job arrives over an internal stdin pipe; this is not a user-facing launch mode, and the variable should not be set in your shell.

There is no production reference/provenance command or fallback. Optional reference execution is confined to the [development test workflow](DEVELOPMENT.md#optional-reference).

## Dashboard Keys

The five sections are **Drafts**, **Runs**, **Stats**, **Models**, and **Templates**. Runs is one stable model-run list across paused, queued, running, done, failed, and cancelled states. It does not hide siblings when one model continues. Stats aggregates recorded cost and time. The dashboard shows state and metadata, not embedded live agent output.

| Keys | Action |
|---|---|
| Left/Right or `h`/`l` | Previous/next section. |
| Tab/Shift+Tab | Next/previous section; within Models, switch Models/Presets/Providers panes. |
| Up/Down, `j` | Select entries (`j` moves down; `k` means stop). |
| PageUp/PageDown, Home/End or `g`/`G` | Page/jump through entries. |
| Ctrl+U/Ctrl+D, Shift+Up/Shift+Down | Scroll the detail pane. |
| `n` | Create a draft from any section, then edit it. |
| `e` or Enter outside Runs | Edit the draft or active registry YAML. |
| `x` on Drafts | Open the runtime model/preset selector. |
| Enter on Runs | Attach selected model session. |
| `t`, `o`, `c` on Runs | Attach run Herdr session; open report; copy native reopen command. |
| `s`, `k` or Ctrl+C, `u`, `R` on Runs | Start; stop; continue; fresh retry. |
| `d`, `D` on Runs | Delete selected model; delete whole run, after confirmation. |
| `r`, `?` | Refresh; open scrollable keyboard help. |
| `q`, Esc | Quit; confirm if sequential requests are waiting. |

In the selector, type to filter, Backspace to edit, Space to toggle, arrows/page keys/Home/End to navigate, Tab/Shift+Tab to switch launch mode, and Enter to submit. Delete/Ctrl+U clears the filter. Esc clears a nonempty filter first, then closes; Ctrl+C cancels the selector. Deletion requires `y`/`Y`; `n`/`N`, Esc, `q`, or Ctrl+C cancels. Help closes with `?`, Esc, `q`, or Enter.

Clipboard copying uses an installed `wl-copy`, `xclip`, `xsel`, or `pbcopy`. Missing session IDs are reported instead of copying/executing a placeholder.

## Run Workflows

**Normal run:** workers execute up to the draft concurrency, with independent projects and native sessions. One failure does not stop siblings. `post_each` runs after a fresh attempt, including failures, but is skipped on cancellation. Scheduler-owned `post_all` runs from the run directory after completion unless the whole run was cancelled. No model execution timeout is imposed.

OpenCode startup first runs `opencode session list` under a user-home lock shared across output roots and Automator homes. Only this shared-state warm-up is serialized. Independent workers, including models using the same provider, still run concurrently up to each run's scheduler limit.

**Headful inspection:** Herdr uses one named session, `Automator`, one workspace per run, and tabs/panes for models. Worker wrappers leave a shell open after completion. `automator attach` or `herdr session attach Automator` opens that session. The current backend is not tmux; old tmux YAML fields only preserve existing data.

**Heavy/manual run:** set `heavy: true` to create paused states and return, then start selected models with `s` or `automator start`. `--run-heavy` executes the draft normally instead. Manual start/retry/continue dispatch outside the original scheduler, so draft concurrency does not cap them and they do not trigger `post_all`, even when the last model finishes.

**Sequential comparison:** press Tab in the selector to queue whole draft runs FIFO. It passes `--run-heavy`, so heavy drafts execute normally. The next request starts after the previous run launcher exits successfully or unsuccessfully and no discovered queued/running models block it. Paused models do not block. Waiting requests exist only in the dashboard's memory; keep it open to drain them. Already launched runs outlive dashboard quit.

**Recovery:** use continue for an existing OpenCode/Claude session; it skips templates, pre/post hooks, and git baseline. If no matching session is recoverable, retry instead. Pi supports native interactive reopening with a captured ID, but **Automator Pi continuation is unsupported**, preserving the original executable's behavior. Retry is a fresh attempt with a backup, not a continuation. `--force` is accepted by retry/continue but does not override their state guards.

**Deletion:** `d` removes the selected model's project/state and snapshot entry, with a tombstone to prevent queued dispatch from recreating it. Deleting the last model also removes the run. `D` removes the entire run and index entry. Both are destructive and require confirmation. Paused/queued models may be deleted; running models, or runs containing them, may not. Live worker locks are checked as well as status files. Deleting project data is not a tool-owned native-history cleanup command.

**Costs:** reports preserve input/cache/output/reasoning/total fields when present, leaving unavailable values blank. Optional registry pricing is copied into the snapshot and replaces matching provider/model contributions, not unrelated subagent costs. Historical `reprice` supports OpenCode and Claude, skips running/queued models, and imports registry rates only into unpriced identity-matching snapshots. Pi historical repricing is unsupported. Claude native cost is unknown unless pricing supplies it.

## Operational Notes

- Set `concurrency` in the draft. Omission defaults to `6`, zero resolves to `1`; the initialized global `default_concurrency` setting is unused.
- OpenCode accepts `args.format` in YAML but does not emit `--format`. Do not rely on that field to change tool output.
- Drafts support versioned filenames and latest-version execution, but the TUI edits the selected file in place, even after execution. To retain a separate draft revision, create the next `vN.yaml` before editing it. Existing executed snapshots are unchanged by draft edits.
- `git init` and `git add -A` failures stop the fresh pipeline. The baseline commit is attempted with a command-local identity; its nonzero exit status is historically ignored and remains so. A completed worker therefore does not guarantee a baseline commit exists.
- Run/model actions reject reserved metadata keys, path escapes, and symlinks in managed targets. State/report writes use atomic replacement and fsync; full-lifetime worker locks prevent duplicate work and protect live projects from deletion. Cancellation stops the selected worker's descendant process groups, not sibling models.
- Launcher failures appear in the dashboard with log paths under `$AUTOMATOR_HOME/logs` (default `~/.automator/logs`). A detached helper redacts sensitive assignment values before writing launcher stdout/stderr, including values split across output chunks. Herdr startup logs are under the Automator home's `herdr/` directory. Inspect model state errors and native sessions as well; the dashboard does not stream logs.
- Redaction is not credential management or a guarantee that arbitrary tool output contains no sensitive data. Keep credentials in the tools' own authentication stores, not prompts, registries, or hooks.
- Use isolated fake-tool fixtures for development, never personal sessions or credentials. The [source discrepancy ledger](SPEC.md#source-discrepancies) explains preserved actual behavior.
