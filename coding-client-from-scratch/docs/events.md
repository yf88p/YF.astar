# JSONL Events

TypeScript consumers can import the version 1 discriminated `BuiltinEvent` union and `EventPayloads` from `dist/src/events.js` (declarations ship alongside it). Additional integration/extension events use the common envelope; consumers should ignore unknown event types they do not need.

`kiln run --json "request"` writes one JSON object per LF-terminated line to stdout. The linked executable works through its canonical-realpath entry guard; `node /absolute/path/to/kiln/dist/src/cli.js run --json ...` is an alternative. Avoid npm script wrappers when stdout must contain only JSONL. This is Kiln's version 1 application event stream, not provider SSE, session-export JSON, or the external process protocol.

Stdin supplies an optional prompt, **not approval replies or RPC messages**. Noninteractive approval requests use a deny callback. Grant reviewed, narrow rules with `--allow` or protected user config before launching; project trust uses `--trust-project` or remembered trust. Never infer permission from a successful process launch alone.

## Envelope

Normal events have these fields in addition to type-specific data:

```ts
interface EventEnvelope {
  version: 1;
  type: string;
  time: string;       // ISO 8601 UTC timestamp
  sessionId: string;  // Empty before a session exists / for command results
}
```

Optional fields are omitted, not necessarily `null`. There is no sequence number, run ID, turn ID, event replay endpoint, or globally unique event ID. `id` on a tool event is the provider's tool-call ID, not an envelope identifier. Preserve line order and correlate tools within the active model attempt/run, not across unrelated sessions. Ignore unfamiliar event types/fields rather than treating them as assistant prose; trusted extensions can emit their own events. `version` is a format version, not the package version.

Two early CLI responses are exceptions to the timestamp/session envelope:

```ts
type HelpResponse = { version: 1, type: 'help', text: string };
type VersionResponse = { version: 1, type: 'version', value: '0.1.0' };
```

`--json --help` and `--json --version` return those responses and exit 0 without a session. Argument/configuration/bootstrap failures instead produce the failure `agent.end` described below, potentially with `sessionId: ""` and no preceding start events.

## Lifecycle

A normal one-shot request broadly follows this order; this is not a promise of exact adjacency:

1. Extension loading and configured external-server launch/discovery happen first. Permission, integration error, and warning events can precede `session.start`.
2. `session.start`, `project.context`, optional untrusted-source warning, and `project.git` describe initialized state. A resumed session also emits `session.start`; it is not necessarily newly created.
3. Input attachment checks may request approval. `configuration` precedes `agent.start`, then `message.user`, `context`, and optional compaction. Interrupted-history repair may emit a warning before `agent.start`.
4. Each provider attempt emits `model.start`, followed by text/reasoning deltas, tool-argument counters, optional usage, and on an accepted complete turn `assistant.end`. Transient retries emit `retry` and another `model.start`.
5. A tool-use turn executes calls with `tool.start`, optional permission/progress/artifact events, and `tool.end`. Then the next model turn sees their results. Contiguous readonly calls can overlap in groups of eight; mutation barriers preserve declared order.
6. Undelivered inputs are saved individually; the terminal record is attempted and ordered `session.event` hooks are drained before warnings/errors and the outward `agent.end`. Git refresh and extension status callbacks follow while the client remains busy; shutdown can emit integration events before `session.end`. **`agent.end` is not necessarily the final line.** Read to EOF and inspect the process exit status too.

There is no `model.end`, `reasoning.end`, or streamed `checkpoint` event. An incomplete/error/output-limited turn need not emit `assistant.end`. SQLite record types and extension hook names are separate from this stream, even where names coincide. Abrupt process termination can prevent terminal events altogether.

## Session And Context

| Type | Additional Fields | Meaning |
| --- | --- | --- |
| `session.start` | `session: SessionMeta`, `ephemeral: boolean` | Client initialization completed far enough to create the agent and gather extension status. |
| `session.changed` | `session: SessionMeta` | Interactive client changed session or active branch; not a filesystem restore. |
| `session.end` | `session: SessionMeta` | Emitted during handled client close, before the store is closed. |
| `project.context` | `cwd: string`, `trusted: boolean`, `sources: Source[]`, `templates: string[]` | Loaded/skipped instruction and project-config paths, plus available template names. |
| `project.git` | `status: string` | Bounded Git status text, or an unavailable/not-a-repository description. Not a structured Git result. |
| `configuration` | `model: string`, `thinking: 'off' \| 'low' \| 'medium' \| 'high'`, `mode: 'plan' \| 'build'` | Selected settings saved before a new run or by a settings command; not the full config. |
| `context` | `tokens: number`, `window: number` | Local context-size estimate and configured model window. |
| `compaction.start` | `automatic: boolean`, `beforeTokens: number` | Extractive compaction is beginning. |
| `compaction.end` | `automatic: boolean`, `afterTokens: number`, `summary: string` | Bounded excerpts now form active context; original session records remain. |

`SessionMeta` has `id`, `cwd`, `name`, `createdAt`, `updatedAt`, optional `parentSession`, `activeLeaf: string | null`, and `labels: string[]`. `Source` is `{path: string, kind: string, loaded: boolean}`; current kinds are `instructions`, `config`, and `user instructions`. This source list does not include the user `config.json` itself; inspection separately provides `configDir`.

Context tokens are `ceil(UTF8-byte-length / 3)` over system text, serialized messages, and available tool schemas. They are not a provider tokenizer count. The normal `context` event precedes automatic compaction; use `compaction.end.afterTokens` for the revised estimate. Automatic compaction occurs above 85% of `contextWindow - maxOutput`; recognized overflow also gets one compact-and-retry, but only before any text, reasoning/signature, or tool output has arrived. The `summary` is an extractive checkpoint, **not an LLM summary or verified new facts**.

## Requests And Models

| Type | Additional Fields | Meaning |
| --- | --- | --- |
| `agent.start` | `model: string`, `mode: 'plan' \| 'build'` | A run starts with canonical `provider/id`. |
| `message.user` | `text: string`, optional `attachments: {path, kind, mediaType}[]` | Accepted user/queued input; attachment data is not included in this event. `kind` is `text` or `image`. |
| `message.queued` | `delivery: 'steer' \| 'follow-up'`, `queued: number`, `text: string` | Input accepted into an active run's queue, not yet delivered. |
| `message.delivered` | `count: number`, `queued: number`, `boundary: 'tool-batch' \| 'settled'` | Queued messages were saved as user messages at a safe boundary. |
| `model.start` | `model: string`, `attempt: number` | Provider invocation; transient retry counter starts at **0**. This is not a turn number. |
| `assistant.delta` | `text: string` | Incremental redacted assistant text. |
| `reasoning.delta` | `text: string` | Incremental reasoning text when the provider exposes it. No signature is emitted here. |
| `assistant.end` | `reason: 'stop' \| 'tool-use'`, `text: string` | Accepted completed assistant turn; `text` repeats the assembled text, not an extra delta. |
| `retry` | `attempt: number`, `delayMs: number`, `error: string`, optional `contextOverflow: true` | Scheduled transient retry, or one immediate overflow retry after compaction. |
| `usage` | `usage: Usage`, `total: Usage` | Latest usage snapshot for one attempt, accumulated once; cumulative session totals. |

Text and reasoning redactors may retain a suffix across chunks and flush it at attempt end. Do not append `assistant.end.text` to previously accumulated deltas. `tool.arguments` is likewise **not** executable partial JSON. Neither streamed text nor a queued input event proves that a turn committed successfully.

`retry.attempt` is one-based for scheduled retries; the subsequent `model.start.attempt` uses that retry count. It resets each model turn. The separate context-overflow path emits `attempt: 1`, `delayMs: 0`, `contextOverflow: true`, then starts a fresh turn attempt counter at 0. Transient retries are limited by `retries` (default 3), use exponential backoff from 500 ms and any larger provider `Retry-After`. **Both retry paths refuse replay after partial text, reasoning (including signature-only chunks), or tool chunks.** An overflow after partial output is a failure, not a compaction retry. Usage metadata alone does not mark a response as partially consumed. Failure/abort can leave usage and deltas without a completed assistant turn.

`Usage` contains `input: number`, `output: number`, and optional `reasoning`, `cacheRead`, `cacheWrite`, `cost`. Counts are normalized from provider metadata when supplied, not filled in from the local context estimate. Missing provider usage can mean no `usage` event at all. Cache read/write counts are subsets of input; reasoning is a subset of output. Do not add those subsets again. Anthropic's separate uncached/cache input counts are normalized into total input.

`cost` is a **USD estimate** using configured dollar-per-million pricing snapshots, with cache subsets charged at their rates and reasoning included in output. It is not a live price quote or a billed provider dollar amount. Missing model pricing currently results in zero, not a guarantee of free service. `total` includes stored usage records across the session's records, including abandoned branches, not just the current run/active context. The live event has no `estimated` field; the SQLite usage record separately stores one, currently based on cost being present.

## Approval

| Type | Additional Fields |
| --- | --- |
| `permission.request` | `request: PermissionRequest`, normally `secret: boolean` |
| `permission.decision` | `requestId: string`, `decision: 'once' \| 'session' \| 'pattern' \| 'deny'`, optional `pattern: string` |

```ts
interface PermissionRequest {
  id: string;
  tool: string;
  action: 'read' | 'write' | 'shell' | 'network' | 'extension' | 'secret';
  resource: string;
  reason: string;
  cwd: string;
  command?: string;
}
```

Paths/cwd are canonicalized for execution checks; shell requests include the exact command. Ordinary in-workspace reads and existing matching grants return without request/decision events. Interactive project-trust bootstrap requests use `id: "project-trust"`, `tool: "project_trust"`, action `extension`, empty envelope `sessionId`, and omit `secret`; that bootstrap dialog is not used by noninteractive JSONL mode.

Recognized shell risks prefix `request.reason` with a `Warning:` banner describing a `potentially destructive operation (data deletion or overwrite)` and/or `network-sensitive operation (network access, remote changes, or downloaded code)`. These are advisory text labels, not new fields/event types, exhaustive analysis, or an extra network permission. The action remains `shell`, and an existing grant does not force a new request event.

The manager can flag a canonical protected path with `secret: true` while the request's original action remains `read`/`write`. This includes registered config paths and state-directory contents, even under cwd; validated `read_output` artifacts are exempt from the broad state-directory restriction, not other registered/protected-path checks. Protected access only accepts `once`. Decisions are emitted **before** validating a supplied pattern or rejecting a reusable protected-path grant; a decision event is not proof of authorization or execution. Aborting a pending prompt can leave no decision event. Check `tool.end` or the final failure for the actual result.

## Tools And Artifacts

| Type | Additional Fields | Meaning |
| --- | --- | --- |
| `tool.arguments` | `index: number`, `id: string`, `name: string`, `bytes: number` | Cumulative UTF-8 argument bytes for a streamed call. ID/name may initially be empty. No argument fragments are exposed. |
| `tool.start` | `id: string`, `name: string`, `arguments: string` | Argument JSON parsed, recursively redacted, and serialized for presentation; invalid JSON is replaced with an omission object. Emitted before execution validation/permissions, not proof execution began. |
| `tool.progress` | `id: string`, `name: string`; shell also supplies `tool: 'shell'`, `stream: 'stdout' \| 'stderr'`, `text: string`, `bytes: number` | Shell's redacted stream text; byte counter is cumulative per stream. Other tools can emit their own progress fields. |
| `tool.output_saved` | `id: string`, `name: string`, `tool: 'shell'`, `outputPaths: {stdout?: string, stderr?: string}`, `bytes: {stdout: number, stderr: number}`, `complete: boolean`, `status: 'success' \| 'error' \| 'aborted'` | Shell artifact paths and redacted byte counts, including failure/abort cleanup when artifact setup reached this stage. |
| `tool.end` | `id: string`, `name: string`, `content: string`, `isError: boolean`, optional `metadata: object` | Normalized bounded tool result, including schema errors, denied permission, failed execution, or success. |

The built-in shell emits `tool.output` at its own tool API boundary. The **agent renames it to `tool.progress`** and adds call `id`/`name`, so CLI model-invoked shell runs do not normally expose `tool.output`. Extensions that emit through the host's `api.emit` bypass that per-call attribution.

For a model configured with `capabilities.tools: false`, requests omit all tool schemas. Unsolicited calls still receive `tool.start`/error `tool.end` results, but no tool execution or execution-approval callback occurs; allow rules cannot override this model gate.

Shell `metadata` on a normal exit includes `code`, `signal: string | null`, and `outputPaths`. Nonzero child exit is `isError: true`. Artifact `complete` describes output capture/finalization, not command success: it can be true after nonzero exit or abort. `status: "success"` is not enough to ignore `complete: false` or a later tool error. Early approval/setup failure can produce no artifact event at all.

Tool content is normally limited to 250 lines / 24,000 bytes; overflow is saved as a complete redacted `.txt` artifact in `<state-dir>/outputs` and its path included in the content marker. Shell always attempts separate stdout/stderr artifacts with bounded previews, without a total artifact disk quota. These are local files, not embedded JSONL attachments. `read_output` returns UTF-8-aligned byte ranges with metadata `{path, offset, nextOffset, hasMore}`; it only accepts direct, regular, single-link, non-symlink `.txt` output files. Persistent artifacts outlive session deletion; ephemeral artifacts are removed on handled close.

## Integration Events

| Type | Additional Fields |
| --- | --- |
| `extension.error` | Optional `extension: string`, `path: string`, `source: 'user' \| 'project'`, `error: string` (includes callback/startup stage). |
| `external.progress` | `server: string`, `requestId: number \| string`, plus server-supplied progress fields, commonly `message`, `progress`, `total`. |
| `external.stderr` | `server: string`, `bytes: number`. |
| `external.error` | `server: string`, `error: string`. |
| `lsp.status` | `server: string`, `status: 'starting' \| 'ready' \| 'unavailable'`, optional `error: string`. |
| `lsp.diagnostics` | `server: string`, `uri: string`, `diagnostics: object[]`; each diagnostic is also annotated with `uri`. |
| `lsp.stderr` | `server: string`, `bytes: number`. |

External progress IDs are RPC IDs local to a server generation, **not provider tool-call IDs**, and can repeat after restart. Additional progress fields are not a fixed progress schema. Process stderr events are per-chunk **discarded byte counts**, not cumulative counters and not text; sum them for activity. Raw external/LSP stderr is neither retained nor included in errors. Shell stderr is different: it is redacted and captured as described above.

`lsp.status: "ready"` describes a connection, not completed analysis. Not-yet-started servers can appear as unavailable in inspection without an initial status event. No configured LSP yields `[]`; an unmatched file may cause no event. Neither means a clean check. Failures clear diagnostic state, and restarting reopens known buffers; old explicitly versioned diagnostics are ignored. See [protocol details](protocol.md) and [extension boundaries](extensions.md).

## Completion And Diagnostics

| Type | Additional Fields |
| --- | --- |
| `notice` | `message: string` (for example a submitted slash-command result). |
| `warning` | `message: string` (skipped project resources, unavailable external server, recovery, abort, or undelivered queue, among others). |
| `error` | `message: string` (agent run error). |
| `agent.end` | `outcome: 'success' \| 'failure' \| 'aborted'`, `reason: string`, `turns: number`, optional `error: string`. |
| `command.result` | `command: string`, `value: unknown`; normal envelope with empty `sessionId`. |

For `run` or `--prompt`, normal outcomes are:

| Outcome | Reason | Exit Status | Interpretation |
| --- | --- | --- | --- |
| `success` | `stop` | 0 | The model settled without pending delivered work. Tool failures may still exist; inspect results and final text. |
| `failure` | `error` | 1 | Provider/protocol/output limit, turn limit, or other run failure. `error` describes it. |
| `aborted` | `aborted` | 130 | Agent cancellation; partial work may already have occurred. |

`turns` counts completed provider responses, including a response rejected for an output-limit stop, not HTTP attempts. Interrupted streaming attempts do not increment it. Reaching `maxTurns` is a failure, not success. Each undelivered queued message gets its own `queue.pending` session record with `{messages: [{message, delivery}]}`; inputs leave the queue only after their user-message record commits. They are not automatically resubmitted. A preservation warning is emitted only after successful persistence. Failure to save pending input or the terminal record produces a failure `agent.end` instead of claiming it was saved; later pending entries and the terminal record are still attempted.

The CLI's outer catch handles parsing, configuration, input preparation, initialization, and uncaught post-run errors. It writes `kiln: MESSAGE` to stderr and emits `agent.end` with `reason: "error"`, `turns: 0`, and `outcome: "failure"` or `"aborted"` (exit 1 or 130). This can have no preceding `agent.start`; an exceptional failure after an earlier completion can still emit another terminal event. Ordinary post-run Git refresh failures now emit `warning` without changing the agent result. Integration cleanup failures also emit warnings; an error escaping client close goes to stderr as `kiln cleanup: ...` and does not currently change an already selected exit status. A hard termination has no guaranteed end event. Interactive UI exit status describes the UI exit, not the last agent result.

`sessions`, `models`, and `inspect` produce `command.result` instead of starting an agent run. Fork/import values are metadata objects; list/model values are arrays; inspect returns `{config, cwd, trusted, sources, configDir, stateDir}`. **Session export's `value` is a JSON string**, not the parsed export document. `extensions` initializes/closes a client around its result, so it may also emit lifecycle/integration events; its value is the inspection JSON as a string.

Slash-only one-shot submissions can produce `notice` without running an agent and currently exit 1 because no successful `lastResult` exists. Use dedicated inspection/session commands for automation instead of expecting `run /config` to be a successful agent run.

In JSON mode the application keeps diagnostics and runtime warnings on stderr and events on stdout. Stderr is not versioned and need not be empty, including Node's SQLite warning. In non-JSON one-shot mode assistant text goes to stdout; tool details/progress, retries, warnings/errors, and final run status go to stderr. Do not parse the latter as an event protocol.

## Redaction And Trust

Client events recursively redact known configured credential strings in values and object keys, bare tokens extracted from Bearer headers, and common `sk-...` patterns. Completed tool-argument strings are parsed before recursive redaction and reserialized, so JSON escapes cannot hide a known secret. Invalid/incomplete arguments become `{"_omitted":"Incomplete or invalid tool arguments"}`. Sanitized copies are used for events, session records/hooks, compaction, and subsequent request history; approved execution still uses the original arguments. Display arguments are not a replay API. `inspect` removes inline provider keys and headers and clears `secrets`, while configured server/LSP environment values are redacted. Session and artifact persistence also use the redacting boundary; reasoning signatures and attachment data are not event payloads.

This is not a general data-loss-prevention system. Unknown secrets, image pixels, and arbitrary inherited environment values may not be recognized. Early bootstrap errors occur before the merged secret set exists. Trusted JavaScript can write directly to stdout, forge event-like output, block shutdown, or bypass these boundaries; do not load unreviewed extensions into an automation process that needs a clean stream. Treat event text, tool output, imports, and provider responses as untrusted data, and escape them before terminal/HTML rendering.

Implementation references: [`cli.ts`](../src/cli.ts), [`client.ts`](../src/client.ts), [`agent.ts`](../src/agent.ts), [`types.ts`](../src/types.ts), [`util.ts`](../src/util.ts), [`tools.ts`](../src/tools.ts), and the integration adapters. The [README](../README.md#verification) describes local verification; no live provider run is implied by this reference.
