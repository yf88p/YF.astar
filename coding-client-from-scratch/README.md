# Kiln

A deliberate, local-first coding workbench for the terminal. Warm amber and copper on charcoal, with a persistent composer, inspectable tool results, and explicit approvals.

Kiln is an independent TypeScript application, not a wrapper around another coding CLI. It owns the agent loop, talks to Anthropic and OpenAI-compatible HTTP endpoints through native `fetch` and SSE, and stores session trees in Node's built-in SQLite. The terminal UI and one-shot JSONL interface share the same client and tools.

Version 0.1.0 includes real execution, persistence, cancellation, and recovery paths. It is not a sandbox or a claim of universal provider compatibility. See [Architecture](docs/architecture.md) for the implementation and its operational boundaries.

## Setup

Use **Node.js 24 or newer on Linux**, with npm, Git for Git tools, and a POSIX shell. The full-screen UI needs TTY stdin/stdout and a cursor-addressing terminal. Shell process-group handling targets Linux/macOS, but checkpoint preparation and undo/redo require Linux with `/proc/self/fd`: **the current client also cannot perform tracked `create_file`/`edit_file` writes on macOS**. Windows is not a supported end-to-end target.

There is no first-run configuration generator. A missing user config is allowed: built-in defaults select Sonnet when `ANTHROPIC_API_KEY` is set, otherwise GPT-4.1. Supply the corresponding `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the launching environment through your credential manager. Never put real keys in the examples or commit them to a project.

For an explicit starting configuration, from this checkout, on a new installation:

```sh
config_dir="${KILN_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kiln}"
install -d -m 700 "$config_dir"
install -m 600 examples/config.json "$config_dir/config.json"
chmod 600 "$config_dir/config.json"
```

Do not overwrite an existing config without reviewing it. The [user example](examples/config.json) selects **Sonnet in plan mode**; use `--model gpt` for OpenAI. User `config.json` must be owned by you with no group/other access; use mode `0600` even when it contains only environment-variable names. Configuration files must be regular, non-symlink files of at most 256 KiB. Invalid or unknown keys fail startup.

Start development mode:

```sh
npm install && npm run dev
```

Pass application arguments after `--`, for example `npm run dev -- --model gpt --cwd /absolute/path/to/project`. To build and install the executable name:

```sh
npm run build
npm link
```

The production build runs TypeScript compilation and `scripts/postbuild.mjs`, which makes `dist/src/cli.js` executable (`0755`). The entry guard resolves canonical real paths, so the `npm link` symlink works. Alternatively, invoke the compiled entry directly:

```sh
node dist/src/cli.js
```

From an arbitrary directory, use an absolute installation path and an explicit workspace:

```sh
node /absolute/path/to/kiln/dist/src/cli.js \
  --cwd /absolute/path/to/project \
  --config-dir /absolute/path/to/user-config \
  --state-dir /absolute/path/to/private-state
```

The linked `kiln` executable and the direct Node entry accept the same arguments.

## Daily Use

| Command | Behavior |
| --- | --- |
| `kiln` | Interactive terminal workbench. |
| `kiln run "Explain the architecture" --mode plan` | One request, then exit when the agent settles. |
| `kiln run --json "Review @src/main.ts"` | Version 1 JSONL on stdout, not a terminal UI. |
| `kiln run < request.txt` | Read a prompt from stdin when no nonempty prompt argument is supplied. |
| `kiln -p "Explain this repository"` | `--prompt` also selects one-shot operation. |
| `kiln models` / `kiln models qwen` | List/search configured, enabled model metadata; no remote discovery. |
| `kiln inspect` | Inspect redacted merged config, instruction sources, trust, and directories without a model request. |
| `kiln extensions` | Initialize the client and inspect extension resources/errors; this can execute trusted extensions and request configured process launches. |

`--mode build` enables mutation tools, but does not approve them. Built-in defaults use build mode; the supplied examples deliberately use plan mode. Plan removes mutating tools from the model's tool list and rejects writes, shell execution, external tools, and undo/redo at execution boundaries. It is **not filesystem isolation**: trusted extension activation/hooks and approved language/server processes can still execute code in plan mode.

For a narrowly authorized noninteractive edit:

```sh
kiln run --mode build \
  --allow 'edit_file:src/*.ts' \
  --allow 'shell:npm test' \
  'Fix the failing test without changing other files'
```

Add `--trust-project` only after reviewing that workspace's instruction files, `.kiln/config.json`, extensions, and configured executables. Trust is not an execution grant for every tool.

Other run controls are `--model`/`-m`, `--provider` (scope an unqualified model ID), `--thinking off|low|medium|high`, `--max-turns 1..1000`, `--resume ID|latest`, and `--ephemeral`. Ephemeral sessions use an in-memory database and a temporary artifact directory removed on handled exit; they cannot resume or manage persistent sessions. A crash or `SIGKILL` can leave temporary files, and ephemeral mode does not disable configuration/trust persistence.

JSONL is an output stream, not a bidirectional approval protocol. Use `kiln` or the direct Node entry rather than npm script wrappers when stdout must contain only JSONL. See [Events](docs/events.md) for fields, ordering, and exit codes: `0` for a settled successful run, `1` for failure, `130` for abort. A successful agent stop is not proof that every tool succeeded or the requested work is correct.

## Terminal

Enter submits or steers an active run; Alt+Enter queues a follow-up. Steering is delivered after the current tool batch, while follow-ups wait until the model settles. Neither silently cancels an in-flight request. State-changing commands are busy-gated for their full async lifetime, and a new run cannot overlap post-run Git/status finalization. Esc aborts an active run or dismisses a dialog; Ctrl+c aborts when busy and quits when idle. Ctrl+j inserts a newline.

Ctrl+p selects models, Ctrl+o sessions, Ctrl+k slash commands, Ctrl+g the session tree, and Tab searches files for `@file` references. Alt+p toggles plan/build; Alt+t and Alt+r expand tool output and reasoning. Ctrl+e opens the draft in `$VISUAL`, then `$EDITOR`, then `vi`. The UI adapts to narrow terminals and keeps a bounded display cache, not the authoritative session history.

Set `NO_COLOR` for monochrome ASCII, or `KILN_ASCII=1` for ASCII chrome. `TERM=dumb` also disables bracketed-paste negotiation and OSC52, but full-screen operation still needs cursor addressing. Clipboard access is internal-only unless `KILN_CLIPBOARD=1` opts into terminal OSC52. Review [Terminal Keys](docs/keys.md), including safe multiline paste and permission dialogs.

## Permissions

- Ordinary reads inside the canonical workspace are allowed. Writes, shell commands, out-of-workspace reads, and extension/process actions require a matching rule or approval. File traversal skips protected paths, symlinks, dependency/generated directories, and ignored files.
- Interactive dialogs default to **deny**. Choices are once, session-exact, explicit pattern, or deny. Session-exact covers one command/resource, tool, action, and cwd, not every invocation of an executable.
- `--allow 'TOOL:PATTERN'` is repeatable. Rules are tool/action/cwd-scoped; use exact commands and narrow path patterns. `edit_file:src/*.ts` does not grant `create_file`. Shell prefix patterns are restricted; they are not a shell parser or containment mechanism. There is **no `--yes`**.
- Noninteractive requests needing approval are denied. Already allowed workspace reads and matching configured/CLI rules do not prompt. Invalid permission patterns do not grant access.
- Protected paths, including `.env`, `.env.local`, credential directories, private keys, and secret-named files, bypass reusable grants and require explicit **one-time** approval. State-dir contents and application-registered config paths stay protected even inside cwd; validated `read_output` artifacts have a narrow exception. Protected access cannot be preapproved with `--allow` or user permission rules.
- UI session/pattern execution grants stay in memory, reset on permission-manager changes, and are not written to disk. Persistent `permissions` rules belong only in protected user config, as `{ "tool": "shell", "action": "shell", "pattern": "npm test" }`. Project config cannot contain nonempty permission rules.

Shell approval reasons flag recognized **potentially destructive** and **network-sensitive** commands. These advisory patterns are not exhaustive, do not change the `shell` action or force a new prompt for existing grants, and are not a sandbox. An approved command runs through `$SHELL -c` (fallback `/bin/sh`) with your inherited environment and account access. JavaScript extensions and configured processes have that authority too. Provider requests use the configured endpoint without a separate network-approval dialog. Use OS isolation for untrusted code.

## Configuration

| Location/Setting | Resolution |
| --- | --- |
| Workspace | `--cwd`, otherwise the launching cwd; resolved to its real absolute path. |
| User config directory | `--config-dir`, then `KILN_CONFIG_DIR`, then `$XDG_CONFIG_HOME/kiln`, otherwise `~/.config/kiln`. |
| State directory | `--state-dir`, then `KILN_STATE_DIR`, then `$XDG_STATE_HOME/kiln`, otherwise `~/.local/state/kiln`. |
| User configuration | `<config-dir>/config.json`; user instructions in `<config-dir>/instructions.md`. |
| Project configuration | Only `<cwd>/.kiln/config.json`, and only when trusted. Ancestor project configs are not merged. |
| Project instructions | `AGENTS.md`, then `CLAUDE.md`, at every directory from filesystem root through cwd, not just to the Git root. Loaded only when trusted. |

Prefer absolute directory flags/environment values: relative config/state paths resolve against the **launching process cwd**, not `--cwd`. User extension paths resolve against config-dir; project extension paths against workspace cwd. Configured processes run in workspace cwd with structured `command`/`args`, inherited environment plus literal `env` overrides. JSON strings do not expand `$VARIABLE` or `~`; `apiKeyEnv` is a variable **name**, not a key value.

Configuration merges **built-ins < user < trusted project**. Scalars and ordinary arrays replace earlier values. `providers`, `aliases`, and `templates` merge by key; a provider entry replaces the whole earlier entry, not individual fields. `models` merge by `provider/id`, replacing the whole matching model. `secrets` concatenate user and project values. User and project extension lists are loaded separately with their original sources, even though the merged config's `extensions` field reflects ordinary array replacement. CLI model/mode/thinking overrides win; on CLI resume they precede the active branch's last saved configuration, which precedes disk defaults. `--max-turns` overrides config.

Instruction assembly is user `instructions.md`, user config `instructions`, ancestor-to-nearest project files (`CLAUDE.md` after `AGENTS.md`), then project config `instructions`. The built-in system text tells the model to prioritize safety rules, current user request, user instructions, then project instructions, with nearer project directories overriding ancestors and project-config instructions last. This textual precedence is not a security boundary. Combined instructions are capped at 256 KiB.

First interactive startup asks whether to trust discovered project resources. Denial leaves project instructions/config unloaded. Trust-once and `--trust-project` apply to that launch; choosing session/pattern in the **project trust** dialog remembers a content fingerprint in protected `<config-dir>/trust.json`. The fingerprint and loaded project instructions/config use the same captured snapshot, even if files change during approval. Changes are reconsidered on the next load; extension source contents are not fingerprinted. This is distinct from in-memory tool grants. Noninteractive startup uses remembered trust or the explicit flag, otherwise ignores project resources with a warning on client initialization.

The [project example](examples/project-config.json) is intended as `<cwd>/.kiln/config.json`. Its extension paths refer to this checkout's `examples/extensions` directories; for another workspace, adjust them to reviewed installed resources or set `extensions` to `[]`. Project config rejects inline provider `apiKey` values. Review endpoints, headers, `apiKeyEnv`, and process configuration too: a trusted project can redirect requests or launch code.

Supported top-level keys are `model`, `models`, `aliases`, `enabledModels`, `providers`, `mode`, `thinking`, `maxTurns`, `retries`, `steering`, `instructions`, `templates`, `extensions`, `servers`, `lsp`, `secrets`, and user-only permission grants in `permissions`. Defaults are 40 turns, 3 transient retries, `thinking: "off"`, and `steering: "steer"`; retries accept 0..10. Templates are named prompt text invoked with `/template NAME additional text`, not an automatic skill-discovery system. `secrets` supplies additional exact strings to redact, not credentials to send.

### Providers And Models

| Provider type | Default endpoint | Default credential environment |
| --- | --- | --- |
| `anthropic` | `https://api.anthropic.com/v1/messages` | `ANTHROPIC_API_KEY` |
| `openai` | `https://api.openai.com/v1/chat/completions` | `OPENAI_API_KEY` |

`baseURL` should normally include `/v1`, for example `http://127.0.0.1:8080/v1`. Kiln appends `/messages` or `/chat/completions` unless already present. An empty URL path defaults to `/v1`; any other nonempty path is used as supplied, not automatically versioned. URLs must be HTTP(S), without embedded credentials; configuration rejects recognized credential query parameters such as `api_key`, `token`, and `password`. Use `apiKeyEnv` or protected headers instead, HTTPS for nonlocal traffic, and never put secrets in URLs. Redirects are rejected.

Provider entries accept `type`, `baseURL`, `apiKeyEnv`, optional user-only `apiKey`, and `headers`. Inline `apiKey` takes precedence over the named environment key; custom headers apply last. With any explicit `baseURL`, authentication requires explicit `apiKey`, `apiKeyEnv`, or headers: the adapter does **not** implicitly forward `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`. Only an implicit built-in endpoint gets that fallback. The OpenAI adapter implements streaming **Chat Completions**, including `max_completion_tokens` and usage requests, not the Responses API. Compatible services must implement the actual wire subset.

The user example has two model entries: a Sonnet metadata/price override and illustrative `local/qwen` (select with `--model local/qwen` or alias `--model qwen`). It also retains the other built-ins through model merging. **`qwen` is not discovered or guaranteed to be a deployed model ID**: replace its ID, context/output limits, and capabilities with your server's actual values, updating aliases/scopes to match. The local example explicitly requires `KILN_LOCAL_API_KEY` via `apiKeyEnv`; a missing named key fails before the request. For a deliberately unauthenticated local endpoint, keep its `baseURL` but omit `apiKeyEnv`, `apiKey`, and authentication headers. No default provider key will be sent.

| Built-In Key (Alias) | Context / Max Output | Reasoning | USD Per Million Input / Output |
| --- | --- | --- | --- |
| `anthropic/claude-sonnet-4-5` (`sonnet`) | 200,000 / 16,384 | Yes | 3 / 15 |
| `openai/gpt-4.1` (`gpt`) | 1,047,576 / 16,384 | No | 2 / 8 |
| `openai/o4-mini` (`mini`) | 200,000 / 16,384 | Yes | 1.1 / 4.4 |

All three declare tools and images. Model metadata is configured, not queried from a catalog. `enabledModels` accepts canonical `provider/id`, an alias, a bare ID, or `provider/*`; it restricts selection, not credentials or network access. Omitting it enables all valid configured models; an empty list enables none. Aliases resolve one level. `maxOutput` must be positive and smaller than `contextWindow`.

Image capability gates image attachments; reasoning capability gates thinking request options. **`capabilities.tools: false` omits all tool schemas and rejects unsolicited tool execution**, regardless of allow rules. Anthropic thinking requests budgets of 1,024/4,096/8,192 tokens for low/medium/high, capped below `maxOutput`; OpenAI-compatible requests use `reasoning_effort`. Support and returned reasoning text depend on the endpoint. `off` omits the option; it does not prove a reasoning model does no internal reasoning.

Prices are **editable snapshots, not live quotes**. `pricing.input`, `output`, `cacheRead`, and `cacheWrite` are dollars per million tokens. Built-in cache-read rates are 0.3/0.5/0.275 respectively; Sonnet's cache-write rate is 3.75. Usage counts come from provider metadata when present: cache counts are subsets of total input, reasoning is a subset of output. Costs apply cache rates without double-counting and charge reasoning within output. Missing pricing currently yields a zero estimate, **not proof of free usage**. Override snapshots for your endpoint, tier, and current prices.

## Sessions And Recovery

| Command | Result |
| --- | --- |
| `kiln sessions [search]` | Search ID, name, cwd, or labels; most recently updated first. |
| `kiln resume [ID]` | Resume ID, or latest across the state store, in its original cwd. |
| `kiln run --resume ID "Continue the review"` | Resume with a new one-shot request. |
| `kiln sessions fork ID` | Copy active ancestry to a new session; print its metadata, including the new ID. |
| `kiln sessions export ID > session.json` | Export version 1 JSON history. Keep this file private. |
| `kiln sessions import session.json` | Validate and import inert history with a new ID; print metadata. |
| `kiln sessions delete ID` | Delete that session from SQLite without a confirmation prompt. |

Resume rejects a conflicting `--cwd`; trust is checked for the original workspace. A live owner locks a session against concurrent writers. In the UI, `/new`, `/resume ID`, `/fork`, `/tree`, `/branch RECORD_ID` (or `root`), `/name TITLE`, and `/label LABEL` manage history. UI resume/fork/import restore the destination active branch's saved model/mode/thinking; missing saved fields retain the current selection, as does a new session. `/branch` changes history without restoring settings. CLI resume follows the precedence above. `/export PATH`, `/import PATH`, and `/delete ID` are also available; the active session cannot be deleted through `/delete`.

Persistent state lives in `<state-dir>/sessions.sqlite`, with SQLite WAL and `synchronous=FULL`. Original tracked writes prepare durable checkpoint intent **before** publishing file changes, then finalize the record. Undo/redo also use write-ahead intent and content/directory identity checks; interrupted recovery reconciles observed state rather than blindly replaying writes. This is not a single atomic transaction across SQLite and the filesystem.

**`/undo` and `/redo` are explicit build-mode actions on tracked checkpoints only. Shell changes are NOT tracked and cannot be undone by Kiln.** Extension/process side effects are not automatically checkpointed either. Branching and forking change history, not workspace files. Restores refuse conflicting external edits, replaced directories, linked files, or missing local checkpoint authority. Imported checkpoints are documentary and never authorize file writes. A checkpoint containing content that would be secret-redacted is rejected rather than saving a lossy undo copy.

Exports contain all branches but not private checkpoint authority or artifact file contents. Imports do not replay tools, restore permissions, or launch recorded resources, though imported text remains untrusted model context. Deleting a session does not undo files, remove standalone output artifacts, or securely erase SQLite/WAL storage. Protect the state directory and exports; they are not encrypted.

## Tools And Limits

Built-ins are `read_file`, `read_output`, `list_directory`, `find_files`, literal-text `search`, `create_file`, exact-match `edit_file`, `shell`, `git_status`, and `git_diff`; the client adds `diagnostics`. Create never overwrites and requires an existing parent directory. Edit replaces exactly one occurrence and preserves CRLF convention. Git inspection uses structured arguments with hooks, executable filters, external diff/textconv, and optional locks disabled; it is not a grant to run arbitrary Git commands.

| Boundary | Current Limit/Behavior |
| --- | --- |
| Text read/create/edit | Regular UTF-8, no NUL; 2 MiB per file, including edited result. A read range does not bypass the whole-file cap. |
| Prompt / text attachment | 128 KiB each. `@file`, `@"path with spaces"`, and `@'path with spaces'` use read permissions. |
| Images | PNG, JPEG, GIF, WebP with signature checks; 2 MiB each and model image support required. Image contents are not OCR-redacted. |
| Attachments together | At most 8 references before deduplication; 3 MiB combined encoded attachment data, including base64 expansion. |
| Model response | Configured `maxOutput`; also 4 MiB combined assistant text/reasoning, at most 128 tool calls, 2 MiB arguments per call, 8 MiB argument fragments per provider response. |
| Provider transport | 1 MiB per SSE event; 120-second network-idle deadline. Malformed or incomplete streams fail rather than execute uncertain calls. |
| Tool result context | Normally 250 lines / 24,000 bytes, plus a truncation marker pointing to a complete redacted artifact. |
| Shell | Default 120 seconds, configurable tool `timeout_ms` up to 600 seconds. Separate redacted stdout/stderr artifacts; previews capped at 100 lines / 8,000 bytes per stream. Artifact disk growth is not quota-limited. |
| Output recovery | `read_output` reads only non-symlink, single-link `.txt` files directly in state `outputs/`; zero-based byte `offset`, up to 24,000 bytes, with `nextOffset`/`hasMore`. |
| Search/traversal | Up to 1,000 results; traversal stops beyond 20,000 visited entries. Search is literal, not regex. |
| Session serialization | 4 MiB per serialized record, 32 MiB export/import document, at most 10,000 imported records. JSON overhead and before/after snapshots can make effective content limits lower. UI `/import` additionally uses the 128 KiB text-attachment limit. |

Known configured credential strings, bare tokens extracted from Bearer headers, and common `sk-...` patterns are redacted in client events, stored history, tool results, and output artifacts. Completed tool arguments are parsed and recursively redacted before display/persistence; incomplete JSON is replaced with an omission marker. Approved execution still receives the original arguments. Config inspection removes provider keys/headers and clears `secrets`; configured process environment values are redacted. This is not comprehensive secret detection: arbitrary inherited environment values, unknown credentials, image pixels, or trusted code writing directly to stdout are not covered. Review exported data before sharing.

`context.tokens` and the UI context meter estimate UTF-8 bytes divided by three over system text, serialized messages, and tool schemas; they are not tokenizer counts or provider billing metadata. Automatic compaction triggers above 85% of `contextWindow - maxOutput`, with one extra compact-and-retry on recognized context overflow **only before partial output**. `/compact` does it manually. Compaction is **extractive**, retaining bounded excerpts of first intent and recent messages, not an LLM-generated or verified summary. Full original records remain in SQLite; omitted details may need rereading. Neither transient nor overflow retries replay a response after text, reasoning/signatures, or tool chunks have arrived; output-limit stops fail without executing incomplete calls.

## Integrations

Trusted JavaScript extensions register tools, slash commands, templates, lifecycle hooks, and status text under `ext__<extension>__<resource>`. User paths load as explicitly trusted code; project paths require project trust. Even readonly model-invoked extension tools require their own execution approval, for example `--allow 'ext__whitespace__audit:whitespace/audit'`. Commands/hooks are trusted application callbacks, not separately permission-gated tool calls. `/extensions` reports path, source, loaded state, resources, and errors. See [Extensions](docs/extensions.md), the [review](examples/extensions/review) and [whitespace](examples/extensions/whitespace) examples, and the [actual hook payloads](docs/architecture.md#extension-hooks).

Import/activation has a five-second wait deadline; hooks/status/commands have two-second waits, and shutdown shares a two-second budget. These are **not forced cancellation**: synchronous malicious JavaScript can block the event loop, and timed-out async work can still have side effects. No sandbox, hot reload, or containment is promised.

For a separate process, configure `servers: [{ "name": "local", "command": "node", "args": ["/absolute/path/server.mjs"] }]`. This uses **`kiln-tools/1`, a custom JSONL JSON-RPC protocol, not MCP**. Discovery negotiates the protocol and validates synchronous object schemas; published tools are `external__<server>__<tool>` and always mutating. Launch approval (`--allow 'external_server:local'`) and execution approval (for a listed `echo` tool, `--allow 'external__local__echo:local/echo'`) are separate. Failed discovery is unavailable, not successful. A previously discovered wrapper can restart/re-negotiate after transport failure; failed calls are never automatically replayed. An initial discovery failure requires client restart to register tools.

LSP configuration adds matching suffixes, for example `lsp: [{ "name": "typescript", "command": "typescript-language-server", "args": ["--stdio"], "extensions": [".ts", ".tsx"] }]`. Install the server separately. Launch is lazy on a matching `/diagnostics PATH`, `/format PATH`, model diagnostics call, or post-edit update, with `language_server:typescript` approval and file-read checks. The client uses its bounded text-attachment path, so LSP input is limited to 128 KiB. `unavailable` and unconfigured `[]` are **not clean diagnostic results**; even `ready` does not prove analysis completed. Formatting returns edit previews only; server-initiated edits are refused. See [Local Process Protocols](docs/protocol.md) for schemas, framing, cancellation, restart, and status semantics.

## Verification

After dependencies are installed, run one local verification command:

```sh
npm run verify
```

It type-checks, builds, and runs the Node test suite, including provider loopback HTTP/SSE fixtures, temporary Git/filesystem operations, session recovery, permissions, terminal input, extensions, and process/LSP fixtures. No provider credentials, internet access, or installed third-party language/tool server is required; local sockets and subprocesses are required. Dependency installation itself may need registry access.

The end-to-end regression in [`test/cli.test.ts`](test/cli.test.ts) launches the **compiled CLI in a temporary Git repository**: it reads source/tests, makes a wrong addition edit, runs real `node --test` assertions and observes failure, corrects the edit, then reruns the assertions and observes success before stopping. Only the provider responses are scripted by a credential-free loopback SSE fixture; file edits, shell execution, exit codes, persisted history, and output artifacts use the real implementation.

**No live model verification was performed for this documentation update.** Fixture coverage is not proof that every deployed provider accepts the configured IDs, reasoning options, limits, or price snapshots.

MIT licensed. See [LICENSE](LICENSE).
