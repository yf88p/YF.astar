# Native Adapter Integration

The package imports `automator/internal/config`, `automator/internal/util`, and
the pure-Go SQLite driver `modernc.org/sqlite`. The parent module must provide
the SQLite dependency; this package does not require a `sqlite3` executable.

## Public API

```go
type Command struct {
    Program string
    Args    []string
    Env     []string
}

BuildCommand(model config.Model, project, promptPath, title string) (Command, error)
BuildCommandWithPrompt(model config.Model, project, promptPath, prompt, title string) (Command, error)
ContinueCommand(model config.Model, project, sessionID, message string) (Command, error)
ValidateModel(key string, model config.Model) error
ReopenCommand(model config.Model, project, sessionID string) string

CollectMetrics(ctx context.Context, model config.Model, project, title string, started time.Time) (Metrics, error)
RecoverMetrics(ctx context.Context, model config.Model, project, title string, started time.Time, knownSessionID string) (Metrics, error)
ApplyPricing(metrics *Metrics, pricing *config.ModelPricing)

InstalledVersion(ctx context.Context, tool config.Tool) *string
ToolBinary(tool config.Tool) string
ModelKeyDisplay(key string, model config.Model) string
```

Execute `Command.Program` with `Command.Args` directly, set the working directory
to `project`, and inherit the environment. `Env` contains only additions and is
currently nil for all tools. Do not shell-expand or quote structured argv.
`ReopenCommand` is separately shell-quoted for interactive reopening.
Build reads the prompt file for OpenCode and Claude without trimming its contents;
Pi receives the literal `@promptPath`. Pi continue/nudge remains unsupported.

For dry-run previews, call `BuildCommandWithPrompt` with the in-memory prompt.
It validates the model and builds the same argv without reading, statting, or
creating the prompt file (or any other file). `BuildCommand` delegates to it
after reading the prompt for tools that need inline text.

Commands contain the original argument values, not redacted values. Apply
`util.RedactSecrets` when displaying them, never to the executable argv.
The command boundary tests cover shell-quoted secret assignments with embedded
apostrophes, escaped quotes, spaces, and separators in provider/model/title/prompt.
`ModelKeyDisplay` also returns unredacted data. Dry-run callers must redact model
labels and run/workspace/path headers too, not only command and reopen strings.

Validation matches the Rust adapter's finite non-negative pricing checks and
tool argument whitelists. It does not validate provider registry membership,
model-key path safety, or binary installation; those are executor concerns.
The key is used as error context. Allowed values retain Rust's permissive
coercion: string options accept strings and bools; switches accept only bools.
OpenCode's `format` option is accepted but deliberately not emitted.

## Metrics And Pricing

`Metrics` has `*uint64` fields `InputTokens`, `OutputTokens`, `ReasoningTokens`,
`CacheReadTokens`, `CacheWriteTokens`, and **`TotalTokens`**. `TotalTokens` exists
in Rust and must also be copied to persisted worker/report state.
`CostUSD` is `*float64`; `NativeSessionID` and `ToolVersion` are `*string`.
The requested `InputTokensIncludeCache *bool` has no counterpart in the Rust
source and is left nil. Do not subtract cache tokens from input: Rust retains
the native input/cache/reasoning breakdown and prices each component directly.
Claude leaves reasoning and native cost nil, not zero.

Metric serialization retains Rust's `cost` and `session_id` names, along with
the existing snake-case token/version fields. Missing source metrics stay nil.

Collection and recovery return **native, unpriced metrics**. Then call:

```go
metrics, err := adapter.RecoverMetrics(ctx, model, project, title, started, knownID)
if err != nil {
    return err
}
adapter.ApplyPricing(&metrics, model.Pricing)
```

The selected model identity and OpenCode usage contributions are held privately
on the returned value. Overrides replace only that provider/model's native
cost, preserving other models' contributions, including child agents. If a
session has identities but none match, the override does nothing. Sessions with
no model identities use the aggregate breakdown, matching Rust.

Call `ApplyPricing` once per fresh result. Like Rust, repeated calls on an
already-priced result are not idempotent for model-specific contributions.
Historical reprice must recover native metrics first; the contribution map is
not serialized. Registry/snapshot pricing selection and state updates remain
the caller's responsibility.

## Correlation And Recovery

- Live collection considers `started - 5 minutes`, clamped to the Unix epoch.
- Pi scores project/title correlation, preferring newest among equal scores;
  only a single recent file may be used without correlation. Pi historical
  recovery returns no usage or session ID, but still probes the tool version.
- OpenCode checks newest databases first, then uses its native recursive session
  tree. Within a database, live matching prefers directory+title, directory,
  then title, requiring a recent creation or update. Message usage takes
  precedence over step-finish parts; never add both.
- OpenCode recovery ignores `started` and requires exact directory AND title.
  A known ID must also match both, and forbids all export/JSON fallbacks.
- Without a known ID, SQLite failure falls back to line-oriented JSON/JSONL.
  Recovery requires both project and title substrings. Live collection permits
  either and finally falls back to only the newest JSON, regardless of age.
- Claude scans `CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`, requiring
  exact event `cwd` and excluding sidechains. The title is intentionally ignored.
  Recovery ignores `started`; a known ID adds exact per-event ID filtering.
  Later updates replace usage for the same message ID, UUID, or line-index key.
- Pi uses `PI_CODING_AGENT_SESSION_DIR` or `~/.pi/agent/sessions`. OpenCode uses
  Rust's fixed home-relative roots, not XDG overrides or tool args.
- Missing/unreadable/malformed data preserves Rust's best-effort fallback
  behavior. Cancellation and unsupported tool values return errors. Native
  version lookup runs `--version` only when no SQLite session version is present.

## Credential Privacy

Unlike Rust's unrestricted directory scan, discovery excludes known credential
path components (`auth`, `credentials`, `oauth`, `secrets`, `tokens`, API-key
stores, and their file extensions/dot-prefixed variants), plus `.ssh`, `.aws`,
`.gnupg`, `.netrc`, `.env`, and `.git-credentials`. Both the supplied path and
the symlink-resolved path are checked before opening files or credential
directories. Prompt-file reads and direct SQLite/text reads use the same guard.
This intentional privacy restriction applies before every fallback, including
OpenCode's uncorrelated newest-JSON fallback; eligible session-file correlation
and pricing semantics are unchanged.

Session files may contain messages and are still read, as required by the Rust
contract. The exclusion is path-based; it does not inspect arbitrary files to
classify their contents as credentials. Linux tests watch synthetic credential
fixtures with inotify and assert that no open/read events occur.

All discovery and executable tests isolate HOME, tool-specific roots, and PATH.
Only temporary fixture databases, fixture sessions, and fake tools are used.
