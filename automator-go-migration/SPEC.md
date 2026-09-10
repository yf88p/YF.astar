# Automator SPEC

## Goal

Automate model comparison runs for coding agents. Automator creates one independent project per selected model, runs setup scripts, launches the real agent tool, preserves the native tool session, and produces a compact comparison report.

This is the behavior contract for native Go Automator: CLI, persisted data, orchestration, recovery, metrics, reports, and dashboard workflows. Where older prose differs from the original executable, the executable's observable behavior is preserved. The Source discrepancies section records those compatibility decisions.

## Core decisions

- Single native Go binary: `automator`, built with Go 1.24 or newer.
- Canonical production build: `go build -trimpath -ldflags='-s -w' -o automator ./cmd/automator`.
- Production executes native Go code. It must not embed, invoke, locate, or fall back to a reference executable, provenance artifacts, or Rust implementation. An optional comparison reference belongs only in development tests.
- Default UX: terminal TUI dashboard.
- Default execution mode: headful via Herdr.
- Optional execution mode: headless.
- Draft concurrency defaults to `6`; resolution clamps explicit `0` to `1`. The initialized `config.yaml` contains `default_concurrency: 6`, but resolution does not use that setting.
- Local machine only.
- No SDKs. Automator invokes real tools: Pi, OpenCode, and Claude Code.
- Authentication is solely tool-owned. Automator does not collect, store, manage, or provide credentials. Tools use their existing auth/config.
- Config is YAML-first, but edited through the TUI.
- Every model gets a totally independent project directory. No base workspace copying.
- Every model directory is initialized as a git repo.
- Tool sessions must remain browsable in the original tool.
- No embedded live log view or mandatory separate per-agent stdout/stderr files. Herdr/native tool sessions remain the primary inspection surface. TUI launcher/action logs and Herdr server startup logs are exceptions and must expose dispatch failures.

## Non-goals

- Remote machines.
- GUI app.
- SDK integrations.
- Timeout enforcement.
- Per-model prompt overrides.
- Shared base workspace copying.
- Automatic template installation.
- Portable/shareable run definitions.

## Main concepts

### Provider

A named external model provider, e.g. `anthropic`, `openrouter`, `google`, `openai`.

Providers do **not** store credentials.

### Model entry

A named selectable model configuration. It includes:

- display name
- tool: `pi`, `opencode`, or `claude`
- provider
- model id
- structured tool-specific args

### Template

A named project creation preset. Templates are user-provided shell commands, for example:

```bash
npx create-next-app@latest . --ts --tailwind --eslint --yes
```

Template commands must be non-interactive.

### Draft run

A saved, editable run configuration. The TUI edits the selected draft YAML in place, including after execution; it does not automatically create a new version. Users can retain revisions as separate numeric `vN.yaml` files, with the highest version used for execution. Editing a draft does not alter an existing executed snapshot. Drafts may set `heavy: true` to create all model states as paused so expensive models can be started one at a time. Drafts contain no model selection; models and presets are selected at runtime.

### Executed run

A concrete snapshot of a draft. Once started, Automator writes a resolved `run.yaml` snapshot into the run folder. Models, pricing, template steps, prompt, mode, concurrency, and hooks are copied, not looked up afresh by workers. Runtime Herdr metadata, explicit historical repricing, and model deletion can update the snapshot; editing a registry does not silently alter an existing execution.

### Model worker

A per-model execution process. In headful mode, each worker runs inside a Herdr tab/pane. In headless mode, workers run as child processes of the same Go executable.

## Filesystem layout

### Automator home

App config/history defaults to `~/.automator/`; `AUTOMATOR_HOME` overrides that directory:

```text
~/.automator/
  config.yaml
  providers.yaml
  models.yaml
  model-presets.yaml
  templates.yaml
  drafts/
    open-weight-models/
      v1.yaml
      v2.yaml
  runs-index.yaml
  logs/                  # TUI run/action dispatch logs
  herdr/                 # Automator Herdr server startup logs
```

### Benchmark output

The user chooses a root path. Run folders use human names.

If the folder already exists, Automator auto-versions it:

```text
~/benchmarks/
  open-weight-models/
  open-weight-models-v2/
  open-weight-models-v3/
```

A run folder contains:

```text
open-weight-models-v2/
  run.yaml              # exact resolved snapshot
  prompt.md             # exact prompt used for all models
  report.md
  .automator/
    state/
      claude-sonnet-pi.yaml
      qwen-openrouter.yaml
    cancel/              # per-model cancellation requests
    deleted/             # tombstones protecting deleted models from dispatch
    retry-backups/       # previous projects moved aside by fresh retry
  claude-sonnet-pi/
    .git/
    ...project files...
  qwen-openrouter/
    .git/
    ...project files...
```

Versioned draft files use numeric `vN` selection: `v10` is newer than `v9`. CLI run/validate and the Drafts list use only the latest version. Run lookup accepts an existing path or a registered run name, searching newest index entries first.

Keep schema version `1`, existing snake-case YAML names, lowercase tools/modes/statuses, and nullable metrics/session fields. In particular, retain legacy `tmux_session` and `tmux_attach` fields for existing files without reintroducing tmux execution. Unknown metrics are null/blank, not invented zeroes. Configuration initialization creates missing files only, never overwrites user registries, and starts with an empty model registry and an `empty` template. A missing preset registry is seeded once with an `open-models` preset inferred from existing model metadata.

Writes use unique same-directory temporary files, fsync contents, atomically rename, and fsync the parent directory before success. Existing permissions are preserved; new YAML/state files are private. Concurrent run/index/report/model mutations use advisory locks, with run-before-model transition lock ordering. Each worker also holds a distinct lifetime lock for its entire execution, through terminal-state persistence. Actions and deletion probe that lock nonblocking, so a live worker remains protected even if its state file is stale. Locks live outside deletable run directories under the output root's `.automator-locks/` and are not unlinked during deletion.

Model deletion removes its project/state and snapshot entry and records a tombstone; deleting the final model removes the run too. Whole-run deletion removes the run and its index entries. External run tombstones prevent reallocation of paths still referenced by old queued processes. Running models and runs containing them are protected, with identity/status/lock checks repeated under locks. Delayed workers and report refreshes do not recreate deleted data.

Keys must be safe path components. Model keys additionally reject case-insensitive reserved metadata names: `.automator`, `.automator-locks`, `run.yaml`, `prompt.md`, `report.md`, `report.json`, and `report.html`. Trusted configured parent aliases are resolved; run/model targets and managed metadata, state, cancel, backup, index, and lock mutation paths reject symlinks below those parents, including dangling links. Deletion verifies index membership and snapshot/root/project containment. Direct hidden workers validate the whole snapshot and recheck managed paths between pipeline stages, not just at initial CLI resolution.

## TUI

Default command:

```bash
automator
```

Dashboard sections:

```text
Drafts | Runs | Stats | Models | Templates
```

TUI behavior:

- Shows model status (paused/queued/running/done/failed/cancelled) and persisted run metadata rather than streaming agent output.
- No embedded live log view.
- Selecting a model and pressing Enter attaches to its Herdr tab/session, with a captured native reopen command as fallback when Herdr is unavailable. Never execute a placeholder session ID.
- `s` starts a paused/queued model, `k` or `Ctrl+C` stops the selected running model, `u` continues/nudges an existing native session, and `R` fresh-retries it. Continue recovers an OpenCode session ID from exact run/model metadata when possible; otherwise it reports the failure and directs the user to retry.
- `n` is the global new-draft shortcut; there is no redundant New Run tab. Drafts shows only each test's latest version, matching CLI execution.
- Runs is one stable model-run list across all statuses, so continuing one model never hides its sibling models. `d` deletes the selected model's project/state after `y` confirmation; `D` deletes the entire run and all files. Queued/paused models and runs are deletable, but running ones are protected.
- Models, presets, and providers share one Models section with three panes; Tab/Shift+Tab changes the active pane and `e` edits its YAML registry.
- Background start/continue/retry actions write logs and surface dispatch failures in the TUI instead of discarding stderr.
- TUI edits YAML registries for providers, models, model presets, templates, and drafts.
- `x` on a draft opens a presets-and-models multi-select. Typing filters by model or preset metadata, Backspace edits the filter, Space toggles entries, and Enter launches the run.
- Tab in the model selector toggles immediate launch and sequential mode. Sequentially queued draft runs use FIFO order; the next starts whenever the prior run process exits, whether it succeeded or failed. Sequential launch executes `heavy: true` drafts normally instead of creating paused model states.
- Drafts/tests never contain models; every run gets an explicit runtime model selection.
- Past runs can be opened to view report, paths, session IDs, and attach/reopen commands.
- Stats sums recorded positive finite costs and recorded durations by model across indexed runs, omitting rows with neither positive cost nor elapsed time. These aggregates do not fill in missing per-model state metrics.
- Sequential queue admission also waits for discovered queued/running model states and active run launchers, not just the last sequential child. Paused states do not block. The queue is in memory, not a durable scheduler; quitting with waiting entries needs confirmation. Launched runs continue independently of the dashboard.
- External editors, pagers, and native sessions temporarily own the terminal; the TUI must restore raw mode, cursor, and alternate screen correctly on return, errors, resize, and shutdown.
- Signal/context cancellation requests a graceful Bubble Tea Quit, allowing its input reader and terminal cleanup to finish. External commands retain the original context so an active editor or attachment is also stopped; normal handoff restores the dashboard's interaction state.
- A detached logging helper redacts launcher output before persistence and outlives dashboard exit. Its streaming redactor retains state across chunk boundaries, quoted newlines, and escaped spaces; displayed status/error text and worker errors also use shared redaction. Redaction is limited to recognized sensitive assignments, not a general guarantee about arbitrary tool output.

Keybindings (outside modal dialogs):

| Keys | Action |
|---|---|
| Left/Right, `h`/`l` | Change section |
| Tab/Shift+Tab | Change section, or active Models/Presets/Providers pane in Models |
| Up/Down, `j` for down | Move selection; `k` is stop, not up |
| PageUp/PageDown, Home/End, `g`/`G` | Page or jump through entries |
| Ctrl+U/Ctrl+D, Shift+Up/Shift+Down | Scroll details |
| `r`, `?` | Refresh; open keyboard help |
| `n` | Create a draft and open the editor |
| `e`, Enter outside Runs | Edit the selected draft or registry YAML |
| `x` on Drafts | Select runtime models/presets and launch |
| Enter on Runs, `t` | Attach selected model; attach its run's Herdr session |
| `o`, `c` on Runs | Open report in pager; copy native reopen command |
| `s`, `k`/Ctrl+C, `u`, `R` on Runs | Start, stop, continue, fresh retry |
| `d`, `D` on Runs | Confirm deletion of model; confirm deletion of entire run |
| `q`, Esc | Quit; confirm first if sequential requests are waiting |

In the selector, typing/Backspace edits the filter, arrows/page keys/Home/End move, Space toggles, Tab/Shift+Tab toggles immediate/sequential launch, and Enter submits. Delete/Ctrl+U clears the filter; Esc clears it first, then closes; Ctrl+C closes. Delete confirmation accepts `y`/`Y`; `n`/`N`, Esc, `q`, or Ctrl+C cancels. Help is scrollable and closes with `?`, Esc, `q`, or Enter.

## CLI

The binary must expose both TUI and direct commands:

```bash
automator                         # open TUI dashboard
automator tui                     # explicit dashboard command
automator init                    # initialize missing config files only
automator run <draft-name> [--model <key>] [--preset <key>] [--run-heavy]  # execute latest draft version
automator validate <draft-name> [--model <key>] [--preset <key>] [--run-heavy]  # dry-run validation
automator attach <run> <model>     # attach Herdr to a model tab/session
automator start <run> <model> [--force]  # start a paused/queued model in an existing run
automator stop <run> <model>       # stop a running model
automator retry <run> <model> [--force]  # fresh-retry one model in the same run folder
automator continue <run> <model> [--force] [message...]  # continue a native session
automator report <run>             # print report path or render summary
automator models                   # list model registry
automator presets                  # list model preset registry
automator reprice [run]             # recalculate configured costs from supported session usage
```

`--model`/`-m` and `--preset`/`-p` accept repeated or comma-separated keys. Expand presets and deduplicate models; an empty effective selection is an error. There is no default model fallback or selection from draft YAML. `--run-heavy` overrides only the draft's paused creation behavior. `--help`/`-h` and `help [command]` describe commands; `--version`/`-V` reports the binary version. CLI exit classes are success `0`, operational error `1`, usage error `2`, and cancellation `130`. Individual failed/cancelled models do not make a normally completed run orchestrator fail; inspect states/report for model outcomes.

Hidden internal commands (not alternative public scheduling APIs):

```bash
automator worker --run <run-dir> --model <model-key>
automator worker-failed --run <run-dir> --model <model-key> --error <message>
automator continue-worker --run <run-dir> --model <model-key> --message <message>
automator report-refresh --run <run-dir>
```

`worker` runs the fresh pipeline and writes state; `continue-worker` runs only native continuation. `worker-failed` synthesizes a failure when a child exits before terminal state without clobbering an active worker or captured metadata. `report-refresh` regenerates Markdown after manual actions. All dispatch paths invoke the current executable, not another `automator` found in PATH. Optional developer reference execution is confined to tests and is not registered by the production CLI.

For background logs, the TUI invokes the same executable's `tui` command with the private `AUTOMATOR_TUI_LOG_HELPER=1` marker. This headless helper receives a bounded JSON job over stdin, streams redacted combined stdout/stderr to the already-open log, and removes its marker before launching the job. It uses no plaintext job file and remains alive after dashboard exit. The marker is internal, not a user configuration option or additional public command.

## Execution flow

For each run:

1. Load draft and registries.
2. Resolve runtime models from the required CLI/TUI selection and selected presets.
3. Validate configuration, selected model/provider/template/preset identities, pricing, argument names, and path safety; require selected tool binaries and Herdr for headful launch. Shell steps are executed later, not exhaustively dependency-checked here.
4. Warm up OpenCode's shared state when selected, then allocate an unused output folder under an allocation lock, adding `-vN` if needed.
5. Write `run.yaml` snapshot and `prompt.md`.
6. Create one workspace for the run in Herdr's `Automator` session in headful mode.
7. If resolved `heavy: true`, create paused states/tabs, write a report, and return; models are started manually with `automator start <run> <model>`. There is no remaining run scheduler to execute `post_all` later.
8. Otherwise schedule fresh model workers up to the resolved draft concurrency, in deterministic model-key order. Skip tombstoned models rather than resurrecting them.
9. Continue other models even if one fails. If a launcher/worker exits before recording terminal state, record failure rather than leaving it queued/running indefinitely.
10. Run `post_all` from the run directory after the normal scheduler finishes, including model failures/cancellations, unless the whole run was cancelled. These hooks are best-effort: their exit failures do not turn successful model states into failures.
11. Write `report.md`.

Each fresh model worker performs this pipeline:

1. Create the independent model directory.
2. Run template steps inside it.
3. Run `pre` steps there, in order.
4. Initialize git, stage the project, and attempt the baseline commit with the exit-status behavior described under Git behavior.
5. Launch the configured agent as argv, with the exact shared prompt and project working directory.
6. Wait for exit or cancellation; no model execution timeout is imposed.
7. Best-effort close Playwright CLI browser sessions whose workspace matches this project only. Missing `playwright-cli` is not fatal.
8. Collect native session ID, duration, token breakdown, cost, tool version, and status via the adapter, including after interruption where recoverable.
9. Run `post_each` when not cancelled, including after setup/agent failure; preserve the primary error and any hook error. A failed hook makes the model fail.
10. Atomically write final state without recreating a deleted model/run.

Before launching OpenCode workers, Automator warms local tool state with `opencode session list`; failed warm-up fails run launch. The warm-up holds `~/.automator-opencode-warmup.lock`, shared across output roots and different Automator homes using the same user home. Only this tool-state initialization is serialized. The lock is released before model execution, and independent same-provider workers still run concurrently under their run's scheduler limit.

Template/hook commands use the preferred shell with `-lc`, are non-interactive, and are user-controlled executable code. They are not sandboxed or automatically installed.

## Per-model recovery

- `automator start <run> <model>` starts a paused/queued model without creating a new run folder. `--force` also permits other non-running states; it never permits a running model and does not move aside the project. Prefer retry for a clean restart.
- `automator retry <run> <model>` fresh-retries exactly one model in the same run. The previous model project is moved under `.automator/retry-backups/` before the worker starts clean.
- `automator continue <run> <model> [message...]` reuses the captured native session ID and asks OpenCode or Claude to continue from current files/session. A missing/blank message becomes `continue`. Running/queued states are rejected; other states still require a recoverable session. A missing OpenCode ID is recovered from exact project and run/model title correlation, never an arbitrary recent session. Failure directs the user to retry. Pi continuation is unsupported, preserving the original executable's explicit rejection rather than launching a fresh session disguised as continuation.
- Retry rejects running models. Both retry and continue accept `--force` but do not use it to override their guards.
- Continuation skips template, `pre`, git baseline, `post_each`, and `post_all`. It refreshes native metrics, preserves earlier values when new metrics are unavailable, and records timing/status for the continuation attempt rather than adding durations.
- In headful mode these actions reuse the model's Herdr tab/pane, replacing a stale target if dispatch fails. In headless mode they spawn a background worker.
- Manual start/retry/continue dispatch directly, outside the run scheduler's concurrency budget. They refresh reports but do not execute `post_all`, even after the last paused model finishes. Do not imply heavy/manual runs automatically get run-level hooks or globally enforced concurrency.

## Herdr model

- One named Herdr session, `Automator`, with one workspace per run.
- One tab/root pane per model; the first model can reuse the workspace's initial tab.
- The server is checked with `HERDR_SESSION=Automator herdr status server` and started if needed. Readiness retries are bounded; this is not an agent execution timeout.
- Persist session, workspace label/ID, root tab/pane IDs, and per-model tab/pane IDs. Live IDs may become stale; check workspace existence and replace stale dispatch targets instead of assuming they remain valid.
- Create workspaces/tabs without stealing focus. Attach focuses the recorded workspace/tab best-effort and opens the named session.
- Worker wrappers record premature failure, refresh the report, and keep an interactive shell open after worker exit. The session remains inspectable after completion or cancellation.

Example names:

```text
session:   Automator
workspace: open-weight-models-v2
tab:       claude-sonnet-pi
tab:       qwen-openrouter
```

Attach command format:

```bash
herdr session attach Automator
```

Model-specific attach selects the recorded tab via `automator attach <run> <model>`. Historical tmux fields are persisted-data compatibility only, not a supported current backend.

## Git behavior

Default per-model sequence:

1. Run template.
2. Run pre-scripts.
3. `git init`.
4. `git add -A`.
5. `git -c user.email=automator@example.invalid -c user.name=Automator commit --allow-empty -m 'Automator baseline'`.
6. Run agent.
7. Run post-scripts.

When created, the baseline commit records that model's independently prepared project before the agent runs. Projects are generated separately; no shared workspace is copied.

The identity is supplied only for this commit command, not written to user git configuration. `git init` and `git add` failures are fatal. A nonzero baseline commit exit status is historically ignored, and native Go preserves that behavior; command launch errors and cancellation still propagate. A successful worker therefore does not guarantee that a baseline commit was created.

## Config examples

### `~/.automator/config.yaml`

```yaml
schema_version: 1
default_concurrency: 6
```

This setting is initialized but unused by resolution. Set `concurrency` in the draft; omission there defaults independently to `6`.

### `~/.automator/providers.yaml`

```yaml
schema_version: 1
providers:
  anthropic:
    display_name: Anthropic
    auth: external
  openrouter:
    display_name: OpenRouter
    auth: external
  google:
    display_name: Google
    auth: external
```

### `~/.automator/models.yaml`

```yaml
schema_version: 1
models:
  claude-sonnet-pi:
    display_name: Claude Sonnet via Pi
    tool: pi
    provider: anthropic
    model: claude-sonnet-4-5
    args:
      thinking: high
      approve: true

  qwen-openrouter-opencode:
    display_name: Qwen via OpenCode/OpenRouter
    tool: opencode
    provider: openrouter
    model: qwen/qwen3-coder
    pricing:
      input_per_million: 3.0
      output_per_million: 15.0
      cache_read_per_million: 0.3
      cache_write_per_million: 3.0
    args:
      agent: build
      variant: high
      dangerously_skip_permissions: true

  claude-sonnet-cli:
    display_name: Claude Sonnet via Claude Code
    tool: claude
    provider: anthropic
    model: sonnet
    args:
      effort: high
```

Optional model pricing is USD per million tokens; all four rates are required, finite, and non-negative. Cost is `(input * input_rate + (output + reasoning) * output_rate + cache_read * cache_read_rate + cache_write * cache_write_rate) / 1_000_000`. Do not subtract cache counts from native input again. Pricing is copied into `run.yaml`.

When OpenCode usage includes provider/model identities, configured pricing replaces only matching contributions and preserves other models' native costs, including child agents. If identities exist but none match, no override is applied. Without identities, use the aggregate token breakdown. Missing usage must not invent a cost.

`reprice [run]` recovers native usage before applying pricing, updates states and reports, and does not launch agents. Omit the run to process all indexed runs, deduplicating paths. It supports OpenCode and Claude, not Pi; running/queued models and models with active lifetime locks are skipped. Import current registry pricing only if the snapshot has no pricing and model key, tool, provider, and model identity match. Existing snapshot pricing is not silently replaced by new registry rates. Paused states are not excluded by the status guard, but still need recoverable usage.

### `~/.automator/model-presets.yaml`

```yaml
schema_version: 1
presets:
  open-models:
    display_name: Open models
    models:
      - qwen-openrouter-opencode
      - deepseek-openrouter-opencode
```

### `~/.automator/templates.yaml`

```yaml
schema_version: 1
templates:
  nextjs:
    display_name: Fresh Next.js app
    steps:
      - shell: "npx create-next-app@latest . --ts --tailwind --eslint --yes"

  empty:
    display_name: Empty directory
    steps: []
```

### Draft run

```yaml
schema_version: 1
name: open-weight-models
root: ~/benchmarks
concurrency: 6
mode: headful
heavy: false

template: nextjs

prompt: |
  Build the requested feature. Keep the implementation production-grade.

pre:
  - shell: "corepack enable"

post_each:
  - shell: "pnpm test"

post_all:
  - shell: "echo Run complete"
```

## Structured tool adapters

Adapters own tool-specific command construction and parsing.

Adapter responsibilities:

- validate model/provider args
- build command
- launch tool
- detect completion by process exit
- find native session ID
- collect tokens/cost
- build reopen command
- record installed tool version

Supported structured arguments are Pi `thinking`, `approve`, `session_dir`; OpenCode `agent`, `variant`, `thinking`, `format`, `dangerously_skip_permissions`; Claude `effort`, `dangerously_skip_permissions`. Unknown argument names are errors. String options accept strings or boolean-to-string values; boolean switches require actual YAML booleans. This preserves the original executable's coercion rather than adding deeper tool-specific value validation. In particular, OpenCode `format` is accepted in configuration but not emitted as `--format` in either fresh or continuation commands.

### Pi adapter

Historical CLI observation: `pi 0.79.8`, not an enforced version pin. Record the actual installed version at execution.

Headless persistent command shape:

```bash
pi --print \
  --provider <provider> \
  --model <model> \
  --name <session-title> \
  @prompt.md
```

Useful Pi flags:

- `--provider <name>`
- `--model <id>`
- `--thinking <level>`
- `--name <name>`
- `--session <path|id>`
- `--session-id <id>`
- `--session-dir <dir>`
- `--print` / `-p`
- `--approve`

Session storage:

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<session-id>.jsonl
```

Metrics source:

- JSONL assistant messages can include `message.usage`.
- Usage fields observed: `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `cost.total`.

Reopen command shape:

```bash
cd <project-dir> && pi --session <session-id-or-file>
```

Discovery uses `PI_CODING_AGENT_SESSION_DIR` or `~/.pi/agent/sessions`; the configured `session_dir` argument is passed to Pi but does not change Automator's discovery root by itself. Live JSONL collection correlates project/title and recent files. Historical recovery/repricing and Automator continue/nudge are unsupported for Pi. Interactive native reopening is distinct from Automator continuation.

### OpenCode adapter

Historical CLI observation: `opencode 1.15.13`, not an enforced version pin.

Headless command shape:

```bash
opencode run \
  --model <provider>/<model> \
  --title <session-title> \
  --dir <project-dir> \
  <prompt>
```

Useful OpenCode flags:

- `opencode run [message..]`
- `--model <provider>/<model>`
- `--agent <agent>`
- `--variant <variant>`
- `--thinking`
- `--format default|json`
- `--title <title>`
- `--dir <path>`
- `--session <id>`
- `--continue`
- `--dangerously-skip-permissions`

Session storage observed:

```text
~/.local/share/opencode/opencode.db
~/.local/share/opencode/storage/
```

Metrics source observed in SQLite:

- `message.data.cost`
- `message.data.tokens.input` (cache miss)
- `message.data.tokens.cache.read` (cache hit)
- `message.data.tokens.cache.write`
- `message.data.tokens.output`
- `message.data.tokens.reasoning`
- `message.data.tokens.total`
- `part.data` entries with `type: step-finish`, `tokens`, and `cost`

Metrics include the root session and all descendant subagent sessions. Prefer message usage; use step-finish part usage when message usage is absent, never add both for the same session. Configured pricing overrides only matching model contributions as described above; without configured pricing, native cost is preserved.

Session IDs look like:

```text
ses_...
```

Reopen command shape:

```bash
cd <project-dir> && opencode --session <session-id>
```

The adapter reads local SQLite and falls back to JSON/JSONL storage/exports; it does not invoke `opencode export`. SQLite access uses a read-only pure-Go driver, without requiring a `sqlite3` executable. Discovery uses fixed home-relative OpenCode roots; XDG overrides are not used for this lookup.

Live collection can use recent directory/title matches. Historical recovery requires exact directory and title in SQLite. When a known session ID is supplied, require it to match as well and do not fall back to unrelated exports. Without an ID, JSON recovery requires both project and title correlation. Missing or malformed storage is best-effort missing metrics, not proof of a successful or failed agent task.

Continuation command shape (plus configured arguments):

```bash
opencode run --session <session-id> --model <provider>/<model> --dir <project-dir> <message>
```

### Claude Code adapter

Fresh command shape, executed in the model's project directory:

```bash
claude --print --model <model> --name <session-title> <prompt>
```

Append configured `--effort <value>` and/or `--dangerously-skip-permissions` before the prompt. Provider registry membership is required, but provider is not emitted as a Claude flag. Automator does not establish Claude authentication.

Continuation and interactive reopening:

```bash
claude --print --resume <session-id> --model <model> <message>
cd <project-dir> && claude --resume <session-id>
```

Continuation also retains configured effort/permission arguments. Discover JSONL sessions under `CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`. Require exact event `cwd`, exclude sidechains, and filter a known session ID when provided; session title is not a correlation key here. Deduplicate assistant usage updates by message ID, then UUID, then line index, retaining the latest update. Sum input, output, cache-read and cache-creation tokens; total includes all four. Reasoning and native cost are unknown, not zero; configured pricing can supply cost. Recover from the same project/session for historical repricing and continuation.

## Report

Each run writes:

```text
report.md
```

Required fields per model:

- model name
- provider
- tool
- status
- duration
- cache-miss input tokens
- cache-hit input tokens
- cache-write tokens
- output tokens
- reasoning tokens
- total tokens
- cost
- project path
- Herdr attach command (legacy tmux fields remain readable)
- native tool session ID
- native tool reopen command

Example:

```md
# open-weight-models-v2

| Model | Provider | Tool | Status | Duration | Input (cache miss) | Cache hit | Cache write | Output | Reasoning | Total Tokens | Cost | Project | Session |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| claude-sonnet-pi | anthropic | pi | Done | 12m 31s | 12000 | 0 | 0 | 3400 | | 15400 | $0.4200 | ./claude-sonnet-pi | 019e... |

## Reopen

- herdr: `herdr session attach Automator`
- claude-sonnet-pi tool session: `cd /path/to/claude-sonnet-pi && pi --session 019e...`
```

Rows are sorted by model key. Render unknown numeric values as empty cells, durations as minutes/seconds, cost with four decimal places, and project paths relative to the run when possible. Preserve the legacy `Input*` label and explanatory note when input exists without separate cache-read/reasoning fields; do not relabel old inclusive input as a measured cache miss. Tool version and errors remain available in model state/details even though they are not table columns. `report` prints the report path and existing contents; `report-refresh` regenerates from snapshot/state.

## Validation / dry-run

`automator validate <draft>` shows:

- resolved run folder path
- selected models
- template steps
- pre/post steps
- generated tool commands, redacting secrets if any env appears
- concurrency
- Herdr session and workspace names
- missing selected tool/Herdr binaries
- model/provider config errors

Runtime selection is required here too. Missing selected tool binaries, or missing Herdr for headful mode, are advisory lines in `validate` output, not a nonzero validation result. Invalid YAML/schema, missing model/provider/template/preset, unsafe keys, invalid pricing, and unsupported argument names are errors. Actual `run` requires selected tool binaries and working Herdr for headful execution.

Dry-run computes a candidate folder and prints shell steps without executing them or checking every script dependency, `git`, shell availability, or root writability. It can initialize missing preset/config files for a legacy Automator home, but creates no benchmark run and launches no agents. These are preserved preview semantics: a successful validation is not a guarantee that the execution environment is ready. Users install dependencies and choose a writable output root before running.

## Cancellation/failure

- Cancelling one model does not stop others.
- Failed model does not stop others.
- Cancelled model keeps its Herdr tab/session and project/native session for inspection.
- `post_each` is skipped for cancelled models.
- `post_all` runs after all model workers finish unless the whole run is cancelled.

The `post_all` rule applies to scheduler-owned normal execution, not paused-run creation or manual start/retry/continue. A stop request records a cancellation marker and interrupts only the selected model's process tree, with Herdr Ctrl+C when available. Unix agent/shell children run in dedicated process groups; cancellation terminates those groups. Linux worker shutdown also discovers descendant groups, including children that opened a new session. Cancellation applies during setup, agent execution, and hooks without targeting sibling model workers. Terminal cancellation/failure preserves captured session metadata. No timeout is added to the model pipeline.

## Source discrepancies

The original executable, not stale prose, defines the behavior preserved here. These discrepancies are reflected in `internal/cli`, `internal/config`, `internal/executor`, `internal/worker`, `internal/adapter`, `internal/tui`, and `internal/report`, and are checked with native fixtures and optional executable-reference comparisons. The former Rust source and Cargo build are no longer part of the project.

| Earlier wording or assumption | Preserved actual behavior |
|---|---|
| Headful means tmux, one session per run | Current execution is Herdr: shared `Automator` session, one workspace per run, model tabs. Keep old YAML fields only for persisted data. |
| Tools are only Pi and OpenCode | Claude is supported, including resume, JSONL metrics, and historical repricing through `reprice`. |
| Drafts choose models, or selection can be omitted | Models/presets are selected at runtime and expanded/deduplicated. Empty selection fails; drafts have no models field. |
| Global config supplies concurrency | Draft omission defaults to `6`; explicit zero resolves to `1`. `config.yaml`'s `default_concurrency` is unused. |
| Successful validate means binaries/scripts/root are ready | Missing agent/Herdr binaries are advisory. Shell steps are displayed, not executed or exhaustively dependency-checked; root writability is not tested. |
| OpenCode `format` config changes emitted argv | Its name is accepted but neither fresh nor continue emits `--format`; the setting has no effect on generated commands. |
| Manual start participates in scheduler limits and final hooks | It dispatches directly, as do retry/continue. Manual/heavy completion has no automatic `post_all`; draft concurrency is not a global limit. |
| `--force` overrides retry/continue state restrictions | Both accept the flag but ignore it. Start alone uses it for non-running states. |
| Continue reruns setup or post hooks | Continuation uses the existing session/files, skips all hooks and baseline creation, and replaces attempt timing. |
| Any native tool can continue | Pi continuation is explicitly rejected. Pi interactive reopen still works with a captured ID; historical Pi recovery/repricing is also unsupported. |
| Editing an executed draft automatically versions it | The selected YAML is edited in place. Separate numeric draft revisions are user-created; executed run snapshots remain independent. |
| Every successful fresh worker has a baseline commit | Git init/add are checked. A baseline commit is attempted, but a nonzero commit exit status is historically ignored and remains so. |
| No disk logs are written | TUI run/action launch logs and Herdr server startup logs exist. Native sessions remain the primary agent history. |

## Implementation stack

Use mature Go libraries rather than local replacements for YAML, locking, command parsing, terminal lifecycle, or SQLite:

- Go 1.24+; `cmd/automator` is the production entry point and owns signal context/process exit.
- Cobra (`github.com/spf13/cobra`) in `internal/cli` for commands, flags, help/version, hidden worker dispatch, and exit/error handling.
- Bubble Tea, Bubbles, and Lip Gloss for the dashboard, widgets, styling, and terminal handoff.
- `go.yaml.in/yaml/v3` for YAML parsing/serialization, preserving required/default/null schema behavior.
- `github.com/gofrs/flock` for advisory cross-process locks.
- `modernc.org/sqlite` for read-only native SQLite access without CGO or an external SQLite CLI.
- Standard `context`, `os/exec`, goroutines, and bounded scheduling, with platform-specific process-tree cancellation where needed.

The canonical build works without CGO, Cargo, a Rust toolchain, a reference binary, or provenance files. Runtime verification has been performed on Linux. macOS/Windows cross-compilation is a portability check to run, not evidence of native runtime testing on those systems.

## Verification

Required commands:

```bash
go build -trimpath -ldflags='-s -w' -o automator ./cmd/automator
go test ./...
go test -race ./...
go vet ./...
```

Tests must isolate HOME, AUTOMATOR_HOME, tool session roots, XDG directories, PATH, and Herdr routing. Use temporary YAML/JSONL/SQLite fixtures and fake tool executables. Default tests must not inspect real user history, connect to Herdr, invoke real coding agents, access credentials, or require model/network access. Dependency download during setup is separate from runtime test isolation. Optional reference comparisons may run only from development tests, under the same isolation. A missing reference skips comparison unless parity was explicitly required; it must never block production builds or native fixture tests.

The integrated root `go test ./...`, `go test -race ./...`, and `go vet ./...` checks have passed on Linux. The mandatory Rust-reference differential suite has also passed with `AUTOMATOR_REQUIRE_PARITY=1`, including native fixture scenarios; private-PTY tests and real Go CLI TUI workflows verify terminal/context restoration and user actions with isolated fake tools. This does not claim live provider testing or native macOS/Windows execution.

CI performs the Go 1.24 Linux build/tests/race/vet checks and schedules CGO-disabled macOS amd64/arm64 and Windows amd64 cross-builds from Linux. See [DEVELOPMENT.md](DEVELOPMENT.md) for commands, regression coverage, and the test-only `AUTOMATOR_RUST_REFERENCE`/`AUTOMATOR_REQUIRE_PARITY` interface. Original provenance files and the optional reference remain ignored local artifacts, not tracked source or production dependencies.
