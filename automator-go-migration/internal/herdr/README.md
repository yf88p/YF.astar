# Herdr Orchestration

This package ports the original Rust executor's Herdr orchestration, its
attach/interrupt actions, and the TUI's native reopen fallback. It imports
`worker`; `worker` must not import `herdr`.

## API

```go
func EnsureWorkspace(ctx context.Context, snapshot *config.RunSnapshot) error
func CreateTabs(ctx context.Context, snapshot *config.RunSnapshot) error
func Dispatch(ctx context.Context, snapshot *config.RunSnapshot, key, subcommand, message string) error
func Attach(ctx context.Context, snapshot *config.RunSnapshot, key string) error
func SendInterrupt(ctx context.Context, paneID string) error
func AttachCommand(snapshot config.RunSnapshot, state worker.State) string
```

- `EnsureWorkspace` checks server readiness, starts the `Automator` session's
  server if needed, and validates recorded workspace IDs with `workspace list`.
  Creation updates both the supplied snapshot and `run.yaml`. The label defaults
  to the run name. Available label, directory and cwd metadata must agree with
  the run identity. Startup logs append under `config.HomeDir()/herdr/`.
- `CreateTabs` prepares a heavy paused run in sorted model-key order. The first
  nondeleted model takes the workspace's root tab. Other tabs are created with
  the model project directory, label, preferred shell, and `--no-focus`. It
  preserves statuses and metrics and runs only the paused notice and shell.
- `Dispatch` accepts exactly `worker` or `continue-worker`. The message is passed
  verbatim for continuation; callers normalize empty messages if needed. It
  reuses persisted model tabs only in the same workspace/session, uses an
  unclaimed root for an initial worker,
  and retries a stale target once in a replacement tab. IDs and running state
  are persisted before `pane run`. A failed pane dispatch marks the model failed
  without discarding captured native metadata or metrics.
- `Attach` prefers the model's recorded workspace/tab and session, then snapshot
  metadata, then the default `Automator` session. Focus failures are best-effort.
  If Herdr startup or session attach fails, a usable `NativeReopen` is run with
  the preferred shell's `-lc`. Empty/placeholder reopen commands are rejected,
  and cancellation never triggers reopen. An empty key attaches the run without
  selecting a model. Interactive commands inherit standard input/output/error.
- `SendInterrupt` sends `pane send-keys <paneID> Ctrl-C` and returns command errors
  for callers to handle or deliberately ignore.
- `AttachCommand` returns a shell-quoted `herdr session attach` string, preferring
  the model's session, then the snapshot's session, with `Automator` as the empty
  session default. It has no subprocess or persistence side effects.

All Herdr subprocesses use `HERDR_SESSION=Automator` and the preferred `SHELL`.
Inherited socket, workspace, tab, pane, and managed-pane routing variables are
removed; fixture and other Automator environment variables are preserved.
The worker wrappers use `os.Executable()`, not a PATH-resolved `automator`, invoke
`worker-failed` on nonzero exit, always invoke `report-refresh`, then leave an
interactive shell open. The server outlives the request context; its readiness
probe is cancellable and otherwise uses the source's 40 retries at 250 ms.

Public IDs can compact after restart or deletion. A newly created workspace
never reuses an old model target during that dispatch. With richer workspace
responses, available embedded tab/pane records are checked before rename/run;
otherwise read-only `tab get` / `pane get` probes check ownership and model
identity. Definite mismatches or missing targets cause a fresh tab. Transport
failures abort verification, while explicitly unsupported queries fall back to
legacy behavior. ID-only workspace responses keep the original command sequence
for compatibility; without identity metadata, reused compact IDs cannot be fully
disambiguated. Cwds may move within the model project, and root panes may retain
the run cwd, but sibling projects are not accepted.

Command errors omit pane shell payloads and redact secret assignments and echoed
continuation messages before returning or persisting failure state. Error chains
retain cancellation and process-exit identity. Actual dispatched argv is unchanged.

## Caller Responsibilities

Create the run directory, snapshot, and initial model state files before these
calls. Scheduling/concurrency limits and immediate report generation remain in
the executor. In particular, failures before a pane is recorded (for example,
server startup or tab creation failure) must be reflected in model states and
reports by the caller. Child completion refreshes reports through the wrapper.

Workspace/tab mutations acquire the worker's run lock, then its model lock. Do
not call them while holding either lock. Calls sharing a mutable snapshot pointer
must be serialized by the caller.

## Isolated Tests

`go test ./internal/herdr` uses a test-owned fake `herdr` executable. Its PATH
contains only fake executables, HOME/Automator/XDG directories are temporary, and
inherited Herdr routing variables are cleared. No test invokes installed Herdr
or contacts a Herdr server. Generated worker wrappers are also tested through
`/bin/sh` with fake worker and shell executables. The full readiness timeout test
takes approximately ten seconds.
