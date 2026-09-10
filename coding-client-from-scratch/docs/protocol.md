# Local Process Protocols

Process launch is structured `spawn(command, args)` with **no shell**, the configured
working directory, inherited environment plus `env` overrides, and a detached
process group on POSIX. Configuration is the shared `ProcessServerConfig`:

```json
{"name":"local","command":"node","args":["/absolute/path/server.mjs"],"env":{"SETTING":"value"}}
```

The main application must authorize/trust launching configured processes before
calling discovery or an LSP update. The adapters cannot sandbox servers and do not
make a separate launch-permission decision. Configured server names must be unique.
Names follow the extension/resource rules: lowercase alphanumeric segments with
single `_` or `-` separators, starting with a letter, at most 24 characters.

## Kiln Tools 1

`ExternalTools(config, cwd, emit)` implements **`kiln-tools/1`**, a custom protocol,
not MCP. `discover(signal)` starts lazily, negotiates the version, lists and
validates tools, then returns shared `Tool` wrappers. `close()` permanently closes
the adapter and terminates its process group.

Transport is one UTF-8 JSON-RPC 2.0 object per LF-terminated line on stdin/stdout.
CRLF also works. Stdout must contain only protocol frames; write logs to stderr.
Batch messages and blank lines are not supported. Frames are capped at 8 MiB.
Each client request has a monotonically increasing numeric ID within a process
generation. Responses must echo that ID and have exactly one `result` or `error`.
Unknown response IDs are ignored, allowing late cancellation replies.

The mandatory handshake is:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"kiln-tools/1","client":{"name":"kiln","apiVersion":1}}}
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"kiln-tools/1"}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo","description":"Echo text","readonly":true,"inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}}]}}
```

At most 256 tools are accepted, with unique valid local names. Schemas must be
synchronous AJV-compatible draft-07 schemas declaring `type: "object"`. Invalid
descriptors, duplicate names, async schemas and unsupported versions reject the
whole discovery; there are no partial tool lists.

Execution and optional progress notifications:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hello"}}}
{"jsonrpc":"2.0","method":"progress","params":{"requestId":3,"message":"Working","progress":1,"total":1}}
{"jsonrpc":"2.0","id":3,"result":{"content":"hello","metadata":{"example":true}}}
```

Results use `{content: string, isError?: boolean, metadata?: object}`. A successful
RPC response may describe a tool-level error with `isError: true`. RPC failures
use the standard error shape and reject execution honestly:

```json
{"jsonrpc":"2.0","id":3,"error":{"code":-32000,"message":"Execution failed"}}
```

Tools are named `external__<server>__<tool>` and **always have `readonly: false`**,
regardless of the server's declaration. They reject plan-mode execution directly.
Every execution validates arguments against the current process generation's
schema, then calls `context.permissions.authorize` with action `extension`,
resource exactly `<server>/<tool>`, and the full namespaced tool name before
`tools/call`. Invalid arguments do not prompt for execution permission.
Restart cannot silently reuse an outdated validator. Launch and execution are
separate trust decisions; discovery itself can execute arbitrary configured code.

Aborting a request rejects it immediately and sends a notification:

```json
{"jsonrpc":"2.0","method":"cancel","params":{"id":3}}
```

The server must settle the original request (usually with an error) within 250 ms
to acknowledge cancellation. Otherwise its process group is terminated and all
other pending requests reject. All requests have a 30-second deadline; a timeout
also invalidates the connection. SIGTERM is followed by SIGKILL after 250 ms on
POSIX, including surviving descendants. Windows uses direct child termination.
Up to 128 requests may be pending. This is not a streaming tool-result protocol.

Process exit, pipe failure, invalid framing or invalid responses reject pending
work and discard discovery. The next `discover` or existing wrapper execution
starts a fresh process, reinitializes, and rediscovers. Failed calls are **never
automatically replayed**, because their side effects may already have happened.
Ordinary tool RPC errors do not require restarting a healthy transport.

Events are `external.progress`, `external.stderr`, and `external.error`, each
including `server`. Stderr events contain only `{server, bytes}`: `bytes` is the
number of bytes discarded for that event, not text and not a cumulative total.
Sum the counts to display stderr activity. Raw stderr is never emitted, retained,
or appended to failures. The process adapter does not have the application's
secret set, so emitting even small chunks could leak credentials split across
chunks. Actual RPC and process errors still reject honestly and are sanitized by
the application's central error/event presentation boundary. The agent centrally
normalizes and redacts tool results rather than the adapter doing it twice.

## LSP

`LspManager(configs, cwd, emit)` accepts `LspConfig[]`, which adds `extensions`
(for example `[".ts", "tsx"]`) to process configuration. It lazily launches only
matching servers when `update(path, text, signal?)` is called. Paths become encoded
file URIs. The supplied text is the authoritative editor buffer; no filesystem
write is performed.

LSP uses standard `Content-Length: <UTF-8 byte count>\r\n\r\n` framing. Header
names are case-insensitive, headers are limited to 8 KiB, frames to 8 MiB, and
fragmented headers, bodies and multibyte characters are supported. Duplicate,
invalid or oversized lengths and invalid UTF-8 fail the connection.

The lifecycle is `initialize`, `initialized`, `textDocument/didOpen`, then
version-increasing `textDocument/didChange` with full-text replacements. On restart,
known documents are reopened using their latest supplied text. Each file URI has
its own document version and diagnostics. Repeated updates with identical text
are no-ops while the server is ready: they do not send duplicate opens/changes,
increment versions or erase diagnostics. The same update still restarts a failed
server. Diagnostics are accepted through
`textDocument/publishDiagnostics`, annotated with their file `uri`, and cleared
on changes or failure. Older explicitly versioned diagnostics are ignored.

`diagnostics()` always includes every configured server:

```ts
{ server: string, status: 'ready' | 'unavailable' | 'starting', diagnostics: unknown[] }[]
```

`ready` with an empty array is distinct from `unavailable` (not launched, failed,
or exited). An unexpected exit with code zero is still unavailable. Startup and
process failures are reported and isolated; the next matching update retries.
An explicitly aborted update still rejects with an abort error.

With no configured servers, `diagnostics()` returns `[]`, meaning **LSP is not
configured**, not that files have been checked and found clean. Updating an
unmatched file is a no-op and does not clear other files' diagnostics. Server
readiness describes its connection, not proof that it analyzed every file or
finished publishing diagnostics. Callers should display unconfigured or unmatched
files as unavailable for LSP analysis rather than infer success from an empty list.

`format(path, signal?)` requires a ready formatting-capable server and a previously
updated document. It returns validated LSP `TextEdit[]` only, never applies them.
An unconfigured file gets an explicit "No LSP server configured" error, distinct
from a configured server that is unavailable and can be started/retried by update.
The caller must check its buffer version and obtain user approval before applying
edits. Server-initiated `workspace/applyEdit` is always refused. Minimal client
configuration, workspace-folder and capability-registration requests are handled;
unsupported server requests receive a method-not-found error.

`close()` sends `shutdown`, then `exit`, allows a brief graceful exit, and terminates
unresponsive processes. Requests use `$/cancelRequest` on abort with the same
cancellation deadline as the tool transport. Events are `lsp.status`,
`lsp.diagnostics`, and `lsp.stderr`. LSP stderr uses the same count-only
`{server, bytes}` events as external tools; raw stderr never enters diagnostics or
failure output. Diagnostic content and actual errors use central client redaction.

## Local Verification

Run `npm test` for all tests, or after `npm run build`:

```sh
node --test --test-concurrency=1 dist/test/extensions.integration.test.js dist/test/external.integration.test.js dist/test/lsp.integration.test.js dist/test/rpc.integration.test.js
```

The deterministic Node fixture at `test/fixtures/rpc-server.mjs` exercises both
protocols, malformed frames, UTF-8 fragmentation, failures, cancellation and
restart without internet access or third-party servers.
