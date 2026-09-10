# Development

Automator implements orchestration, configuration, workers, adapters, reporting, and the dashboard in native Go. It is not a wrapper around another implementation. [SPEC.md](SPEC.md) is the detailed behavior contract; [README.md](README.md) covers CLI and dashboard use.

When older prose differs from the original executable, preserve the executable's observable behavior. The [source discrepancy ledger](SPEC.md#source-discrepancies) records these compatibility decisions, including in-place draft editing and the historically ignored baseline commit exit status.

## Toolchain

Use Go 1.24 or newer. The minimum is declared in `go.mod`; keep dependency changes and `go.sum` reproducible. Production uses these mature libraries:

| Concern | Library |
|---|---|
| CLI | `github.com/spf13/cobra` |
| TUI lifecycle/widgets/styles | `github.com/charmbracelet/bubbletea`, `bubbles`, `lipgloss` |
| YAML | `go.yaml.in/yaml/v3` |
| Cross-process advisory locks | `github.com/gofrs/flock` |
| Read-only SQLite | `modernc.org/sqlite` (pure Go) |

These libraries provide CLI parsing, terminal lifecycle, YAML, cross-process locking, and SQLite access. Production metrics do not require a `sqlite3` executable. Orchestration uses standard `context`, `os/exec`, and bounded goroutines, with explicit platform-specific process handling.

Canonical production build:

```bash
go build -trimpath -ldflags='-s -w' -o automator ./cmd/automator
```

Verify the same build with `CGO_ENABLED=0`. The normal binary must not embed, read, locate, delegate to, or fall back to `.automator-reference/`, `AUTOMATOR_SOURCE_*`, Rust source/binaries, or any provenance artifacts. No production command or hidden worker may route through a comparison reference. Production builds must work when those artifacts and the Rust toolchain are absent.

The race detector is a separate development facility: `go test -race` needs a supported host architecture, CGO enabled, and a working host C compiler. That does not make CGO a production dependency.

## Package Boundaries

| Path | Responsibility |
|---|---|
| `cmd/automator` | Production entry point, signal context, and process exit. |
| `internal/cli` | Cobra command tree, public commands and hidden worker protocol, flag/argument validation, help/version, exit classes, and redacted errors. |
| `internal/config` | YAML schemas/defaults, registries, draft lookup, run index and lookup. |
| `internal/persistence` | Atomic file replacement and advisory locking. |
| `internal/executor` | Selection resolution, validation, snapshot allocation, scheduling, recovery, repricing, and guarded deletion. |
| `internal/worker` | Fresh/continuation pipelines, state transitions, cancellation requests, and terminal failure synthesis. |
| `internal/process` | Child/process-tree lifecycle and platform-specific cancellation. |
| `internal/herdr` | Server/workspace/tab orchestration, dispatch wrappers, attach and native reopen fallback. |
| `internal/adapter` | Tool argv, version probes, native session correlation, metrics, and pricing. |
| `internal/report` | Stable Markdown rendering from snapshot/state. |
| `internal/tui` | Bubble Tea state/update/view, refresh, selection, queue, confirmation, external terminal handoff. |
| `internal/util` | Shared path, shell, redaction, and command helpers. |

Keep subprocess construction at explicit boundaries so tests can inject fake tools/services. Tool commands are structured argv executed in the project directory; displayed reopen commands are separately shell-quoted. Templates/hooks, user editor/pager settings, and quoted worker supervisor wrappers are intentional shell command strings.

Herdr can depend on worker state, but the worker must not depend on Herdr orchestration. The executor owns scheduler capacity; a worker must not unexpectedly create a scheduler or run `post_all`. A continuation worker never runs setup or hooks. All child worker commands use the current executable, not a PATH-resolved alternate Automator.

OpenCode warm-up runs `opencode session list` under `~/.automator-opencode-warmup.lock`. This serializes initialization of shared tool state across output roots and different `AUTOMATOR_HOME` values for the same user home. Release the warm-up lock before launching model workers: neither provider identity nor tool identity is a worker-wide concurrency lock. Independent same-provider workers remain concurrent.

## Persistence Rules

- Preserve schema version `1`, required/default/null behavior, snake-case fields, exact prompt contents, numeric draft-version ordering, and existing snapshot/state compatibility. Legacy tmux metadata is data compatibility, not an alternate backend.
- Use unique temporary files in the destination directory, fsync their contents, rename atomically, and fsync the parent directory before reporting success. Existing file permissions are preserved; new YAML/state files are private. Protect read/modify/write transactions, not only writes.
- Acquire transition locks consistently: run before model. Do not hold a transition lock while calling another API that acquires it. Workers hold a separate lifetime lock from startup through terminal-state persistence; actions and deletion probe it nonblocking to reject live work without deadlocking a worker waiting on the run lock.
- Keep lock files outside deletable runs. Do not unlink them while another process may be waiting on the same inode.
- Reject unsafe keys, including case-insensitive reserved metadata names: `.automator`, `.automator-locks`, `run.yaml`, `prompt.md`, `report.md`, `report.json`, and `report.html`. Direct hidden workers validate the snapshot too; bypassing the public CLI does not bypass path safety.
- Resolve trusted configured parent aliases, but reject symlinks in run/model targets, managed state/cancel/backup/lock paths, and index mutation targets. Check containment and snapshot/index/project identity before destructive actions, then recheck under locks. Revalidate worker paths between setup/agent/hook stages because a template can replace a directory after startup.
- A tombstoned/deleted model or run must not be recreated by a delayed worker, report refresh, or failed-launch handler. Model deletion also updates the snapshot. Deleting the final model removes the run; external run tombstones prevent reallocation of a path still referenced by an old queued process.
- Preserve captured native IDs, metrics, and reopen commands across cancellation/dispatch failure. Unknown metrics remain null, not zero; do not overwrite a terminal state with a synthesized launcher error.

## Process Lifecycle

Cancellation is scoped to a selected model or the explicitly cancelled run. Unix agent/shell children run in their own process groups. Context cancellation terminates those groups; Linux worker discovery and shutdown also handle descendant groups, including descendants that started a new session. Workers collect recoverable metadata and persist terminal state after interruption. Sibling model workers are not targets of a single-model stop, and no model execution deadline is imposed.

Bubble Tea owns terminal cleanup. The CLI owns the signal context; the dashboard responds to context cancellation with graceful Quit rather than abruptly killing the input reader. External editors and attachments retain the original context so a signal stops them, while normal return restores the dashboard screen, input mode, and selection. Private-PTY tests cover the real default CLI, signal restoration, and external command failures; real-CLI workflow tests use private fake coding tools.

TUI launch logging uses a detached helper, implemented in `internal/tui/logging.go`, so a dashboard exit does not close a redaction pipe needed by a still-running benchmark. The same executable runs `tui` with the private `AUTOMATOR_TUI_LOG_HELPER=1` marker and reads a bounded JSON job from stdin. No plaintext job file is created, and the marker is removed from the launched child's environment. This is internal plumbing, not a public alternative to `run`.

The helper streams combined stdout/stderr through a stateful redactor before persistence, including assignment values spanning writes, quoted newlines, and escaped spaces. Launcher headers, status feedback, and persisted worker errors also use shared redaction. Redaction recognizes sensitive assignment names; it does not make arbitrary prompts/tool output secret-free. Authentication remains solely tool-owned, with no Automator credential storage or management.

## Isolated Tests

Default tests run without installed agents, an active Herdr server, user history, credentials, or a required comparison reference. Do not run `automator`, its worker commands, or native tools against your actual home for development verification.

1. Use `t.TempDir()` for fixture homes, Automator configuration, output roots, and session data. Set `HOME`, `AUTOMATOR_HOME`, XDG roots, `CLAUDE_CONFIG_DIR`, and `PI_CODING_AGENT_SESSION_DIR` explicitly. Where platform APIs use other home variables, isolate those too.
2. Provide a test-owned PATH and fake `pi`, `opencode`, `claude`, `herdr`, `git`, `playwright-cli`, editor, pager, and clipboard executables as needed. Do not append a real tool directory as a fallback. If testing real git semantics, explicitly allow only git with isolated configuration and identity.
3. Clear inherited Herdr routing/session/socket variables before running a fake Herdr executable. Tests must never contact the developer's live workspace or server.
4. Write synthetic YAML/JSON/JSONL and SQLite fixtures. Open fixture databases directly with the Go driver. Never copy real tool sessions, provider configuration, or credentials into test fixtures.
5. Use helper processes or fake commands to record exact argv, cwd, environment additions, signals, and hook order. Use synchronization to test concurrency and cancellation rather than relying only on arbitrary sleeps.
6. Keep terminal tests deterministic: inject dashboard services, exercise Update/View transitions, and use a test-owned PTY for raw-mode/alternate-screen restoration checks. Never attach the test runner to a real native session.

`t.Setenv` changes process-global state; tests that use it must not run in parallel with tests depending on those variables. Race tests complement, but do not replace, cross-process lock and process-tree tests. Platform-specific tests need explicit build constraints and reported skips; do not silently disable a behavior just to make compilation green.

Downloading Go modules/toolchains during environment setup is separate from test execution. Tests must not require model API calls, external network services, or real credentials.

## Verification

Run from the repository root:

```bash
go test ./...
go test -race ./...
go vet ./...
go build -trimpath -ldflags='-s -w' -o automator ./cmd/automator
```

Check pure-Go portability separately; use a temporary output directory rather than overwriting a local runnable binary with another platform's output:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /tmp/automator-linux ./cmd/automator
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-s -w' -o /tmp/automator-darwin ./cmd/automator
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /tmp/automator-windows.exe ./cmd/automator
```

These are cross-build commands, not native runtime tests. Native macOS and Windows testing has not been performed; compilation does not certify shell behavior, Herdr availability, terminal handoff, filesystem durability, or process-tree cancellation on those systems.

[CI](.github/workflows/ci.yml) uses Go 1.24 on Linux for the CGO-disabled production build, normal tests, race tests, and vet. A Linux-hosted matrix cross-compiles macOS amd64/arm64 and Windows amd64 with CGO disabled. These portability jobs are checks to run, not evidence of native platform testing. CI does not install Rust or require reference comparisons and supplies no coding-tool credentials. Without a supplied reference, the optional differential test reports a skip.

The integrated root `go test ./...`, `go test -race ./...`, and `go vet ./...` checks have passed on Linux, as has the mandatory Rust-reference differential suite with `AUTOMATOR_REQUIRE_PARITY=1`. Verification includes private-PTY terminal restoration and TUI workflows through the real Go CLI with isolated fake coding tools. This evidence covers the Linux host, not native macOS/Windows execution or live provider integrations.

## Regression Coverage

Preserve coverage for these observable behaviors when changing the implementation:

- CLI: default dashboard, explicit `tui`, `init`, list commands, run/validate flags and aliases, comma/repeated selection, all recovery/report/reprice commands, hidden `worker`, `worker-failed`, `continue-worker`, and `report-refresh`, help/version, argument errors, and exit behavior.
- Config: missing-only initialization, existing registry preservation, YAML multiline/quoted/alias/default/null behavior, schema errors, highest numeric draft version, in-place draft editing, model/preset expansion and deduplication, mandatory runtime selection, path safety, default draft concurrency `6`, zero clamping, and unused global default semantics.
- Validation: shared argv construction and redaction, advisory missing binaries, fatal registry/config errors, no benchmark creation or agent launch, missing-preset initialization in legacy homes, and shell-step preview without execution or exhaustive dependency/writability checks.
- Scheduling: versioned independent output directories, resolved snapshots and exact prompts, bounded concurrency in both modes, heavy pause and `--run-heavy`, cross-root OpenCode warm-up serialization without serializing same-provider workers, sibling failure isolation, deleted-model skips, premature worker failure, and normal-run `post_all` behavior.
- Workers: template/pre/git/agent/post_each order; failure and interruption at every phase; selected descendant-group termination; project-scoped Playwright cleanup; metadata recovery; final state; checked git init/add and the preserved ignored nonzero baseline commit exit.
- Recovery: start guards and its limited force behavior; retry backups and reset; continue's exact native correlation, hook skipping, timing and metrics; retry/continue force accepted without override; explicit Pi continuation rejection; manual dispatch outside scheduler capacity and no automatic `post_all`.
- Herdr: `Automator` session readiness/startup, workspace/root-tab reuse, paused tabs, stored IDs, stale-target replacement, no-focus creation, failure state/report refresh, shell retention, focused attach and native fallback, plus isolated wrapper argv tests.
- Adapters: exact Pi/OpenCode/Claude fresh and continue argv; allowed argument names/coercions; OpenCode `format` accepted but not emitted; version detection; native session discovery/correlation; malformed/missing storage; known-ID filtering; no accidental user-home access.
- Metrics/pricing: Pi JSONL usage, recursive OpenCode root/subagent usage without message/part double counting, Claude cwd/sidechain/update deduplication, unknown versus zero fields, all token categories, matching-model pricing while preserving other contributions, and OpenCode/Claude-only historical repricing.
- Reports: deterministic model order, blank unknown values, four-decimal costs, relative paths, sessions/reopen commands, legacy `Input*` note, and synchronized refresh after state changes.
- Dashboard: all five sections, three registry panes, stable sibling rows across status changes, latest drafts, stats, selector filtering/multi-select, immediate/sequential launches, FIFO after either child success/failure, active-state admission, redaction before log persistence across output chunks and dashboard exit, transient error/log paths, editor/pager/attach return, clipboard failure, small-terminal resize, full keybindings, context restoration, private PTYs, and real-CLI workflows.
- Deletion/persistence: confirmed model/run removal, final-model run cleanup, queued/paused deletion, running protection and lifetime locks rechecked under transition locks, index/snapshot updates, external tombstones, reserved keys, symlink escapes, atomic fsync writes, concurrent saves/reports/launch/deletion, and no resurrection by waiting workers.
- Production isolation: canonical build and default tests succeed without any reference/provenance artifacts or Rust tooling. No production import, embed directive, command registration, environment toggle, or subprocess fallback may depend on them.

## Optional Reference

The former Rust source, Cargo manifests, and Rust test entry point have been removed. `.automator-reference/automator-rust` and original `AUTOMATOR_SOURCE_*` provenance files can remain as ignored, untracked local artifacts. They are not shipped application inputs. The reference executable is optional and platform-specific; its presence is not a prerequisite for the Go build or native fixture tests.

Reference execution is allowed **only in development tests**. The Unix integration harness in `tests/` builds the Go CLI, runs both executables against separate copies of the same isolated fixture home/fake-tool environment, and compares observable behavior. `TestRustReferenceParity` uses an absolute `AUTOMATOR_RUST_REFERENCE` path, or defaults to `.automator-reference/automator-rust` under the repository root. It skips when the reference is absent; `AUTOMATOR_REQUIRE_PARITY=1` makes absence fail instead. An available but broken reference or a semantic mismatch fails the comparison.

To request a comparison explicitly on a host able to execute the reference:

```bash
AUTOMATOR_RUST_REFERENCE="$PWD/.automator-reference/automator-rust" \
  AUTOMATOR_REQUIRE_PARITY=1 \
  go test -count=1 -run '^TestRustReferenceParity$' ./tests
```

These environment variables belong to tests only. Production, hidden worker commands, and production package initialization do not discover or run the reference. There is no production `reference` command or fallback to another implementation. Native fixture tests remain usable with all reference artifacts absent.

To print isolated demonstrations of `--help`, `models`, `presets`, and `validate` for both implementations:

```bash
go test -count=1 -v -run '^TestCLICompatibilityDemonstrations$' ./tests
```

These examples use fake tools and temporary homes; they never launch a coding agent. Help formatting differs between Cobra and Clap, while commands, selection, paths, and validation semantics are checked.

Useful comparisons include CLI help/argument handling, initialization, selection/validation output, snapshots/state, tool argv, reports, hook sequencing, and recovery guards. Normalize only nondeterministic timestamps, absolute fixture roots, process IDs, and live Herdr IDs; do not normalize away statuses, omitted fields, cost differences, lost hooks, or command flags. The source discrepancy ledger identifies where an older SPEC statement is not what the executable actually does.

An absent reference leaves native fixture tests unaffected. An explicitly required comparison that cannot run fails rather than being counted as a parity pass. Keep the reference test-only and ignored; no source restore, Cargo build, or production fallback is part of this workflow.
