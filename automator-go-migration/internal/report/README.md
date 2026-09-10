# Reports

`Write(runDir)` loads `run.yaml` and `.automator/state/*.yaml` and atomically
replaces `report.md` with `persistence.WriteFile`. `LoadStates(runDir)` is a
read-only, model-sorted loader; missing state directories are empty. `Print(run)`
resolves an existing path or indexed run name and prints the saved report without
refreshing it.

## Locking Contract

`Write` acquires `worker.RunLockPath(runDir)` before reading the snapshot or
states and holds it through persistence. The lock lives outside the run, so it
survives run deletion. Existence checks prevent the atomic writer's parent
directory creation from resurrecting a deleted run. A missing run or snapshot is
an error, not a successful refresh.

The executor must call `Write` **after releasing all run and model transition
locks**, including on failure/cleanup paths. These locks are not reentrant:
calling under the run lock deadlocks; calling under a model lock can invert the
run-then-model lock order. Release transition locks explicitly before refreshing
the report, rather than relying on a deferred unlock at function return.

Run deletion must hold the same run lock. Advisory locking cannot protect against
an unrelated process deleting directories without taking that lock.
`LoadStates` deliberately does not lock, so a caller already holding the run lock
can safely use it. Without a caller-held lock, each state read is atomic, but the
set is not guaranteed to be a run-wide snapshot.

## Compatibility and Tests

The Markdown matches `src/report.rs`: titlecase statuses, blank missing metrics,
four-decimal costs, unbounded minute durations, legacy input labeling, lexical
relative project paths, sorted models, and shell-quoted Herdr session names.
Saved native/Herdr reopen commands and Markdown field contents remain verbatim.
Statistics aggregation remains in the TUI; report statistics are never inferred
from other token fields or repriced.

Tests use temporary run/index fixtures and isolated home environment variables.
They cover exact Markdown, metric formatting, state loading, printing, atomic
replacement, lock serialization, and deletion while a refresh waits on the lock.
No real agents, Herdr sessions, or user home data are accessed.
