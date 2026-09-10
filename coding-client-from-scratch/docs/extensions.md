# Trusted JavaScript Extensions

Extensions are **trusted local code, not a sandbox**. Importing an entry executes
JavaScript with all of Kiln's filesystem, process, network and environment access.
Do not install code you would not run yourself. Resource validation and error
wrappers are reliability boundaries, not protection against malicious JavaScript,
infinite loops, `process.exit()`, or detached asynchronous exceptions.

`new ExtensionHost({ cwd, emit, trusted })` exposes:

- `load(paths, source)`: each path is an `extension.json` directory or a manifest
  filename, resolved against `cwd`. Sources are `user` and `project`. User paths
  are an explicit trusted-code configuration source. Project paths are rejected
  before any import when `trusted` is false. The caller must retain each path's
  source instead of merging project paths into the user list.
- `tools`, `commands`, `templates`: successfully registered resources.
- `inspect()`: detached snapshots with path, name, source, loaded state, errors,
  and resource names/counts. Only the latest 100 errors per extension are retained.
- `hook(name, payload)`: calls registered handlers in order, isolating failures.
- `statuses()`: successful status strings; a failed provider is omitted and logged.
- `close()`: invokes `shutdown` hooks and then activation cleanups in reverse order,
  once, within a shared two-second shutdown budget. Execution is disabled as soon
  as close begins, and pending activation/hook/status/command waits are interrupted.

## Manifest and Activation

```json
{"apiVersion":1,"name":"review","entry":"./index.mjs"}
```

The manifest permits only these three fields, is at most 64 KiB, and must point to
a regular `.js`, `.mjs`, or `.cjs` file inside its own directory after resolving
symlinks. `.mjs` is recommended for unambiguous ES module loading. JavaScript
imports made by that entry are unrestricted because the code is trusted.

The entry default-exports a function, optionally asynchronous. It receives:

```js
export default function activate(api) {
  // api.cwd, api.emit and the activation AbortSignal api.signal are available.
  api.registerTemplate('changes', 'Review changes without editing files.');
  api.registerCommand('checklist', async args => `Review checklist for ${args}`);
  api.on('turn.start', async payload => {
    payload.signal.throwIfAborted();
    // Observe a caller-dispatched hook; pass payload.signal to asynchronous work.
  });
  api.registerStatus(signal => { signal.throwIfAborted(); return 'Review available'; });
  return async signal => { /* Release resources, cooperating with this deadline. */ };
}
```

Registration is only allowed during activation. Import and activation share a
five-second deadline, including asynchronous top-level await. Failed or timed-out
activation publishes no resources, and late registration attempts are rejected.
An import that completes after the deadline will not invoke its activation
function. The extension is responsible for cleaning up its own side effects on
failure or cancellation. There is no automatic hot reload; normal Node module
caching applies.

Each hook, status provider and command has a two-second wait deadline. Hooks
receive a composed `payload.signal`, combining their deadline, host lifetime and
any caller-supplied `payload.signal`. Caller cancellation stops subsequent hook
dispatch. Status and cleanup callbacks receive a signal as their first argument;
command handlers receive it as their second argument, after `args`. Existing
callbacks that do not use signals can simply ignore these arguments. A failed or
timed-out hook/status provider does not prevent the next provider from running.

Shutdown has one shared two-second budget for all shutdown hooks and cleanups,
not two seconds per callback. Remaining callbacks are skipped and reported when
that budget is exhausted. Close does not queue behind a stalled activation.

These are **wait deadlines, not sandboxing or forced termination**. Timers cannot
interrupt synchronous JavaScript that blocks the event loop. A timed-out or
aborted promise may still execute side effects; extensions must cooperate with
their signals. The host observes late promise rejections, but cannot contain
detached exceptions or stop timers, processes, or other resources an extension
creates outside the awaited callback.

Extension and resource names are lowercase, start with a letter, have at most
24 characters, and contain alphanumeric segments separated by a single `-` or
`_`. Double separators and path syntax are rejected.
Published tool, command and template names are `ext__<extension>__<resource>`.
Resource names cannot collide even across resource kinds, and extension namespaces
cannot be registered twice. Hook names are caller-dispatched lowercase labels up
to 64 characters, permitting single `.`, `_`, `:`, or `-` separators. Apart from
`shutdown` on close, the host does not invent or automatically dispatch lifecycle
events; the application calls `hook` at its own lifecycle boundaries.

## Tools and Failures

`registerTool` accepts the shared `Tool` interface: `name`, `description`,
`inputSchema`, `readonly`, and `async execute(args, context)`. Schemas must declare
`type: "object"` and compile with AJV's synchronous draft-07 validation. Async
schemas, invalid schemas, invalid results and invalid registrations are rejected.
Arguments are validated without coercion, defaults, or removal of extra fields,
before requesting execution permission. Every tool, **including readonly tools**,
then requires `context.permissions.authorize` with action `extension`, resource
exactly `<extension>/<tool>`, and the published name `ext__<extension>__<tool>`.
Loading trusted code is not authorization for every model-initiated execution.

Tools return `{content: string, isError?: boolean, metadata?: object}`. Tool
exceptions become error results; command exceptions become error strings. Hook,
status, cleanup and startup errors are reported through `extension.error` and
inspection without preventing other extensions from running. Abort signals remain
abort errors. Permission and tool execution waits race `context.signal`, with
abort checks before and after execution. Tools have no fixed execution deadline;
the caller controls cancellation. Cancellation stops waiting, not the underlying
JavaScript or its side effects. Mutating tools cannot run in plan mode. A readonly declaration is a
promise from already-trusted code, not a security guarantee. Tools should use
`context.permissions.path` / `authorize` for their actual resource access and honor
`context.signal`.

The agent centrally normalizes and redacts tool results; the client must redact
inspection output and route emitted errors through its normal redacting event
sink. Inspection snapshots and raw extension-returned strings are not themselves
a sanitized presentation boundary.

Two working examples are included:

- `examples/extensions/whitespace`: `ext__whitespace__audit` reads a permission-gated
  file and reports whitespace issues without modifying it. Available in plan mode
  after exact extension-tool execution approval and the file-read permission check.
- `examples/extensions/review`: template `ext__review__changes`, command
  `ext__review__checklist`, and a status provider. Neither executes shell commands.
