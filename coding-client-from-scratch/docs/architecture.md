# Architecture

Kiln is a single-user TypeScript/Node 24 terminal application with its own agent loop, provider adapters, tools, and local persistence. This describes the implemented production code paths, not a hosted service, a sandbox, or a claim that every external model/server has been verified.

```text
cli.ts ---- tui.ts / editor.ts
   |          | InteractiveClient callbacks + KilnEvent subscription
   +------ client.ts
               |-- config.ts / permissions.ts
               |-- agent.ts ---- providers.ts ---- HTTP(S) / native SSE
               |      |-- tools.ts ---- filesystem / Git / approved shell
               |      +-- sessions.ts ---- node:sqlite / checkpoint intent
               |-- extensions.ts ---- trusted in-process JavaScript
               +-- external.ts / lsp.ts ---- rpc.ts ---- configured processes
```

## Ownership

| Module | Responsibility |
| --- | --- |
| [`cli.ts`](../src/cli.ts) | Argument parsing, environment/directory selection, original-cwd resume, bootstrap project trust, UI versus one-shot selection, stdout/stderr, signal and exit handling. |
| [`client.ts`](../src/client.ts) | Owns the session, permissions, provider/model selection, tools, integrations, attachment preparation, slash commands, queued submissions, and application lifecycle. |
| [`agent.ts`](../src/agent.ts) | Request/tool loop, complete-call validation, safe retry conditions, usage, compaction, steering boundaries, and result persistence. |
| [`providers.ts`](../src/providers.ts) | Native `fetch`, incremental bounded UTF-8 SSE decoding, Anthropic Messages/OpenAI Chat Completions translation, stop/tool identity validation, metadata normalization, estimated cost. No coding-agent SDK or child coding CLI. |
| [`tools.ts`](../src/tools.ts) / [`permissions.ts`](../src/permissions.ts) | Schema-checked built-ins, canonical-path permission checks, bounded text access, serialized exact edits, Git inspection, process-group cancellation, redacted artifacts. |
| [`sessions.ts`](../src/sessions.ts) | SQLite session trees, per-session owner locks, export/import validation, local checkpoint authority, durable mutation intent and recovery. |
| [`tui.ts`](../src/tui.ts) / [`editor.ts`](../src/editor.ts) | Blessed screen, bounded display excerpts, terminal-input decoding, composer, selectors, approvals, external editor, optional OSC52. No independent agent loop or database. |
| [`ui-contract.ts`](../src/ui-contract.ts) | Narrow callback interface: status, subscriptions, submit/abort, commands, models/sessions/tree/files/transcript. `TerminalUI.prompt` works before a client is attached for bootstrap trust. |
| [`extensions.ts`](../src/extensions.ts) / [`external.ts`](../src/external.ts) / [`lsp.ts`](../src/lsp.ts) / [`rpc.ts`](../src/rpc.ts) | Trusted resource registration and process transports with explicit error, cancellation, and unavailable states. |
| [`types.ts`](../src/types.ts) / [`util.ts`](../src/util.ts) | Shared tool/message/config contracts, event envelope, redaction, output truncation/artifacts, atomic file helper, and keyed queues. |

## Request Path

The production build compiles TypeScript and runs [`scripts/postbuild.mjs`](../scripts/postbuild.mjs) to set the compiled CLI to mode `0755`. The CLI entry guard compares canonical real paths, supporting the `npm link` symlink as well as direct invocation. Bootstrap loads protected user config and discovers instructions from filesystem root to canonical workspace cwd. Project config/instructions are fingerprinted and loaded from the same captured snapshot after explicit or remembered trust; executable extension modules are not snapshotted. Model/config-inspection and session-management commands avoid provider calls.

Client initialization loads user and trusted project extensions separately, requests configured external-server launches and discovers tools, registers diagnostics, and creates the agent. It then reports session/context/Git state. Project trust does not grant all tool executions, and plan mode does not prevent trusted startup JavaScript or an approved configured process from running.

Provider authentication is endpoint-scoped: any explicit `baseURL` uses only explicit `apiKey`, the named `apiKeyEnv`, or configured headers, never an implicit default provider environment key. Inline keys precede environment values and headers apply last. The implicit built-in endpoint retains its provider-specific environment fallback. This keeps a credential-free local endpoint from accidentally receiving a production key; the [local example](../examples/config.json) deliberately opts in with `KILN_LOCAL_API_KEY`.

A normal submission prepares bounded, permission-checked attachments, records model/mode/thinking, and starts the agent. Each turn calculates an estimated context budget, compacts if necessary, and sends sanitized active history and available tools. `capabilities.tools: false` omits all tool schemas and rejects unsolicited execution; otherwise plan mode removes mutation tools. Indexed tool arguments are assembled, validated as JSON and against synchronous AJV schemas, then authorized at their resource boundary. Execution uses original arguments, while parsed, recursively redacted copies enter events/history; malformed argument strings become omission markers. Adjacent readonly calls run in groups of up to eight and all in-flight siblings settle before a persistence failure propagates; mutations are sequential barriers.

Transient provider failures are retried only before partial output; uncertain partial calls are not executed. A recognized context overflow gets one separate compaction retry under the same no-partial-output rule, including reasoning signatures and tool chunks. Missing tool results from interrupted history are replaced with explicit error results explaining that execution is unknown, not replayed. Undelivered inputs are persisted individually as `queue.pending` records to avoid a combined record-size overflow. Ordered session hooks are drained before outward `agent.end`; failed pending/terminal persistence changes the outcome to failure instead of claiming saved work.

The client holds its busy gate through each async state-changing command and through post-run Git/status finalization. New runs and state changes cannot overlap those operations; inspection/abort remain available, with steering accepted only while the agent can queue it. UI resume/fork/import restore available saved model/mode/thinking from destination ancestry; new sessions or missing fields retain the current selection. `/branch` does not restore settings. Close is shared/idempotent, cancels work, waits for initialization/active run/command tasks, then attempts each integration's cleanup before releasing the store. `agent.end` success means a clean model stop, not task correctness; post-run Git errors are warnings. See [Events](events.md) for ordering and exits.

## Storage And Recovery

The database uses SQLite WAL, full synchronous commits, foreign keys, strict tables, disabled loadable extensions, and `trusted_schema=OFF`. Records have parent IDs and an active leaf: branching retains abandoned history; compaction changes the active model view without deleting original records. Per-session PID/token ownership prevents ordinary concurrent writers; stale owners are reclaimed only when the PID no longer exists. This is a local process lock, not a distributed lease, and PID reuse can require waiting rather than unsafe takeover.

Original `create_file`/`edit_file` writes first validate snapshots and record durable intent in `pending_actions`. Publication uses a same-directory temporary file, file/directory synchronization, and rename for edits or exclusive link publication for creation. Finalization records the checkpoint once the observed file matches the intended after-state. On resume, recovery can recognize before-state as unapplied or after-state as applied without replaying the write; conflicting path/file/branch state is refused and the original-write intent cleared without replacing user files.

Undo/redo select the active ancestry's checkpoint stack, verify local authority, directory device/inode and expected content hash, record intent, then restore/delete and commit. Recovery finalizes an already applied action without repeating it. SQLite and filesystem publication cannot be one transaction; durable intent reconciles that gap. This is not protection against a hostile same-user process racing arbitrary filesystem operations, storage corruption, or every crash leftover (for example a creation temporary hard link).

**Linux and `/proc/self/fd` are required for checkpoint preparation as well as restoration.** The pinned-directory helper is used by the original write path, so tracked client writes fail on macOS too, even though POSIX shell group handling targets both. Undo/redo refuses symlink/multiple-link targets, changed directory identity, external file edits, or imported checkpoints without private authority. A fork retains authority for copied local checkpoints, but independent forks still share actual workspace files and can conflict. A branch/fork is not a workspace snapshot checkout.

Sessions, messages, settings, and output artifacts are redacted, not encrypted. The known-secret set includes configured header values and their extracted bare Bearer tokens; config rejects recognized credential query parameters rather than retaining them in endpoint URLs. Undoable snapshots must remain exact; a checkpoint whose content would change under redaction is rejected before the write. Exports include record history but not the private authority table; imports strip executable/credential-bearing keys, validate ancestry and bounds, and cannot authorize restoration. Imported messages can still influence subsequent model context and require the same distrust as repository text.

Shell and arbitrary integration side effects are **not automatically checkpointed**. Cancellation or deleting a session does not reverse them. Persistent output artifacts are separate files with no session-delete garbage collection or configured disk quota. Ephemeral mode uses an in-memory database and temporary output directory, with best-effort handled-exit deletion, not secure erasure.

`PermissionManager` accepts application-supplied `protectedPaths` for files such as `<config-dir>/config.json`; this is a constructor option, **not a disk-config key**. It protects both registered locations and their initial/current canonical targets, as well as state-directory contents, even inside the workspace. Protected reads/writes bypass reusable grants and require one-time approval. `read_output` exempts only validated artifacts from the state-directory restriction, not separately registered config/protected paths. Shell reason banners recognize common destructive/network-sensitive commands but remain advisory; every command still uses normal shell authorization, not containment or a separate network gate.

## Extension Hooks

The host API is `cwd`, `emit(type, data?)`, activation `signal`, `registerTool(tool)`, `registerCommand(name, (args, signal) => string)`, `registerTemplate(name, prompt)`, `on(name, payload => ...)`, and `registerStatus(signal => string)`. Async callbacks are accepted. Activation may return a cleanup callback receiving a shutdown signal. Registration happens only during successful activation; failed activation publishes no partial resources.

Tools, commands, and templates publish as `ext__<extension>__<resource>`. Names use lowercase alphanumeric segments separated by single `-`/`_`, start with a letter, and are at most 24 characters per local name. Readonly extension tools still need action `extension` permission for resource exactly `<extension>/<tool>`, then should permission-check their actual reads/writes through `ToolContext`. `readonly` is a promise by trusted code, not enforcement against arbitrary JavaScript. Commands receive the slash command's whitespace-normalized trailing arguments as one string, not an argv array.

These are the hooks actually dispatched by the application; each host callback additionally receives a composed `signal`:

| Hook | Payload Beyond `signal` | Boundary |
| --- | --- | --- |
| `session.start` | `session: SessionMeta` | Once after client initialization, not on every in-UI session switch. |
| `session.event` | `record: SessionRecord` (detached, sanitized copy) | Queued in commit order for records saved through the agent's `save`; the chain, including the terminal record hook, is drained before outward `agent.end`. Not every store append, checkpoint, or client configuration record. |
| `prompt.before`, `prompt.after` | `message: Message` (detached copy) | Around saving/emitting a delivered user message. Not attachment preparation or enqueue time. |
| `model.before` | `model: string` | Before each provider attempt, before `model.start`. |
| `model.after` | `model: string`, `reason: StopReason` | After a complete streamed response; not guaranteed on failure. |
| `tool.before` | `id: string`, `name: string`, `arguments: object` (detached original arguments) | After model-capability/schema/mode checks, before tool execution/its permission checks. This trusted hook sees execution arguments, unlike sanitized session hooks. |
| `tool.after` | `id: string`, `name: string`, `isError: boolean` | After a valid result is normalized. Thrown execution failures do not dispatch it; returned error results do. Successful built-in writes then trigger matching LSP updates. |
| `approval.before` | `request: PermissionRequest` (detached copy) | Before a client execution-approval callback, not automatic grants or CLI bootstrap project trust. |
| `approval.after` | `request: PermissionRequest` (detached copy), `answer: PermissionAnswer` | After that callback, before final permission-manager decision validation. |
| `shutdown` | No additional fields | Host close, before reverse-order activation cleanups. |

The host accepts other syntactically valid hook labels, but does not invent application dispatch points. In particular, registering `turn.start` as in the generic extension API example does **not** make this client dispatch it. Hooks are not a prompt/tool-result transformation API, and awaiting an ordinary failed hook does not veto the operation. Status callbacks are polled at initialization and after a run, not a continuous push feed; failed providers are omitted and reported. `/extensions` exposes source (`user`/`project`), paths, loaded state, resources, and up to 100 recent errors per extension.

Import/activation shares five seconds; each hook/status/command wait has two seconds; shutdown has one shared two-second budget. Tools have no fixed extension-host deadline and use caller cancellation. These stop waiting and signal cooperative work; they cannot interrupt synchronous JavaScript or forcibly stop late async side effects, detached exceptions, timers, or child processes. Extensions run in the main Node process with full environment/filesystem/network access. Review [Extensions](extensions.md) before enabling code.

## Process Integrations

`servers` and `lsp` entries use structured `command`, `args`, optional literal `env`, and unique names. Runtime names follow the stricter 24-character lowercase resource rule, even though the disk config schema accepts a broader name pattern. Processes inherit the environment, run in canonical workspace cwd, and launch without a shell. The application gates launch; transport adapters themselves do not sandbox or independently authorize it.

External tools negotiate **`kiln-tools/1`, not MCP**, over JSONL JSON-RPC 2.0. Discovery is atomic, capped at 256 tools, with synchronous object schemas. All external tools are mutating regardless of the server's readonly declaration, use `external__<server>__<tool>`, and require separate execution permission. The client discovers at initialization, not on the first model call. After a previously successful discovery, a wrapper can restart a failed process and rediscover/revalidate against the new generation; a failed call is never replayed automatically. Initial discovery failure registers no wrappers, so restart the client after correcting it.

LSP starts only for matching document updates and uses Content-Length framing, full-text didOpen/didChange, per-document versions, and diagnostics with file URIs. The client permission-checks and reads a canonical file before suffix matching, so a supplied unmatched path can still require file approval but does not launch a server. Failed connections are unavailable, even on an unexpected zero exit; matching updates can retry and reopen the latest known buffers. No configured server or unmatched file is not a clean check. Formatting returns validated `TextEdit[]` previews only; `workspace/applyEdit` is refused. Updates use redacted text attachments capped at 128 KiB; Kiln does not watch every file or promise analysis has finished when a connection becomes ready.

RPC frames are capped at 8 MiB, LSP headers at 8 KiB, pending requests at 128, and normal requests at 30 seconds. Cancellation rejects immediately and requests acknowledgment within 250 ms; ignored cancellation or transport failure terminates the process group, escalating TERM to KILL after 250 ms. Shell cancellation uses a separate 200 ms escalation. Detached descendants that escape the process group are outside these controls. External/LSP stderr is discarded with byte-count activity events; shell output is separately redacted and persisted. See [Protocols](protocol.md) for exact messages and errors.

## Verification Boundary

The [README verification command](../README.md#verification) exercises local fixtures and implementation tests without provider credentials or internet access. It is not a live Anthropic/OpenAI/local-Qwen compatibility check, a provider pricing audit, an adversarial sandbox certification, or evidence of macOS/Windows tracked-write support. Use OS isolation for untrusted code, protect configuration/state directories, and review actual tool results before treating work as complete.
