// Package worker executes one model from an immutable run snapshot.
package worker

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"strings"
	"time"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/util"

	"go.yaml.in/yaml/v3"
)

type Status string

const (
	Queued    Status = "queued"
	Paused    Status = "paused"
	Running   Status = "running"
	Done      Status = "done"
	Failed    Status = "failed"
	Cancelled Status = "cancelled"
)

func (status *Status) UnmarshalText(text []byte) error {
	value := Status(text)
	switch value {
	case Queued, Paused, Running, Done, Failed, Cancelled:
		*status = value
		return nil
	default:
		return fmt.Errorf("unknown worker status: %q", text)
	}
}

// State preserves the Rust ModelState schema, including explicit null values.
type State struct {
	Model            string   `yaml:"model" json:"model"`
	Provider         string   `yaml:"provider" json:"provider"`
	Tool             string   `yaml:"tool" json:"tool"`
	Status           Status   `yaml:"status" json:"status"`
	StartedAt        *string  `yaml:"started_at" json:"started_at"`
	FinishedAt       *string  `yaml:"finished_at" json:"finished_at"`
	DurationSeconds  *uint64  `yaml:"duration_seconds" json:"duration_seconds"`
	InputTokens      *uint64  `yaml:"input_tokens" json:"input_tokens"`
	OutputTokens     *uint64  `yaml:"output_tokens" json:"output_tokens"`
	ReasoningTokens  *uint64  `yaml:"reasoning_tokens" json:"reasoning_tokens"`
	CacheReadTokens  *uint64  `yaml:"cache_read_tokens" json:"cache_read_tokens"`
	CacheWriteTokens *uint64  `yaml:"cache_write_tokens" json:"cache_write_tokens"`
	TotalTokens      *uint64  `yaml:"total_tokens" json:"total_tokens"`
	Cost             *float64 `yaml:"cost" json:"cost"`
	ProjectPath      string   `yaml:"project_path" json:"project_path"`
	TmuxAttach       *string  `yaml:"tmux_attach" json:"tmux_attach"`
	HerdrSession     *string  `yaml:"herdr_session" json:"herdr_session"`
	HerdrWorkspaceID *string  `yaml:"herdr_workspace_id" json:"herdr_workspace_id"`
	HerdrTabID       *string  `yaml:"herdr_tab_id" json:"herdr_tab_id"`
	HerdrPaneID      *string  `yaml:"herdr_pane_id" json:"herdr_pane_id"`
	HerdrAttach      *string  `yaml:"herdr_attach" json:"herdr_attach"`
	NativeSessionID  *string  `yaml:"native_session_id" json:"native_session_id"`
	NativeReopen     string   `yaml:"native_reopen" json:"native_reopen"`
	ToolVersion      *string  `yaml:"tool_version" json:"tool_version"`
	Error            *string  `yaml:"error" json:"error"`
}

func (state *State) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind != yaml.MappingNode {
		return fmt.Errorf("line %d: expected a state mapping", node.Line)
	}
	fields := make(map[string]*yaml.Node, len(node.Content)/2)
	for i := 0; i < len(node.Content); i += 2 {
		fields[node.Content[i].Value] = node.Content[i+1]
	}
	// Serde permits omitted Option fields, but these six fields are required.
	for _, name := range []string{"model", "provider", "tool", "status", "project_path", "native_reopen"} {
		value, ok := fields[name]
		if !ok {
			return fmt.Errorf("line %d: missing required field %q", node.Line, name)
		}
		for value.Kind == yaml.AliasNode {
			value = value.Alias
		}
		if value.Tag == "!!null" {
			return fmt.Errorf("line %d: field %q cannot be null", value.Line, name)
		}
	}
	type plain State
	var decoded plain
	if err := node.Decode(&decoded); err != nil {
		return err
	}
	*state = State(decoded)
	return nil
}

func StatePath(runDir, key string) string {
	return filepath.Join(runDir, ".automator", "state", key+".yaml")
}

func CancelPath(runDir, key string) string {
	return filepath.Join(runDir, ".automator", "cancel", key)
}

// ModelLockPath is the short-lived state-transition lock, not the worker's
// lifetime lock. Callers must hold it around read/modify/write or deletion.
func ModelLockPath(runDir, key string) string {
	return namedLockPath(runDir, "model:"+key)
}

// LifetimeLockPath is held for the entire worker execution. Nonblocking callers
// can use it to reject duplicate workers or deletion of a live model.
func LifetimeLockPath(runDir, key string) string {
	return namedLockPath(runDir, "worker:"+key)
}

func RunLockPath(runDir string) string {
	return namedLockPath(runDir, "run")
}

func namedLockPath(runDir, key string) string {
	if canonical, err := filepath.EvalSymlinks(runDir); err == nil {
		runDir = canonical
	}
	abs, err := filepath.Abs(runDir)
	if err == nil {
		runDir = abs
	}
	hash := fnv.New64a()
	_, _ = hash.Write([]byte(runDir + "\x00" + key))
	// Locks survive run deletion so a waiting process cannot lock a new inode.
	return filepath.Join(filepath.Dir(runDir), ".automator-locks", fmt.Sprintf("%016x.lock", hash.Sum64()))
}

func validateKey(key string) error {
	if key == "" || key == "." || key == ".." || strings.ContainsAny(key, "/\\\x00") || filepath.VolumeName(key) != "" {
		return fmt.Errorf("unsafe model key: %q", key)
	}
	switch strings.ToLower(key) {
	case ".automator", ".automator-locks", "run.yaml", "prompt.md", "report.md", "report.json", "report.html":
		return fmt.Errorf("model key conflicts with run metadata: %s", key)
	}
	return nil
}

func LoadState(runDir, key string) (State, error) {
	var state State
	if err := validateKey(key); err != nil {
		return state, err
	}
	var err error
	runDir, err = checkedRunDir(runDir, key)
	if err != nil {
		return state, err
	}
	if err := persistence.LoadYAML(StatePath(runDir, key), &state); err != nil {
		return state, fmt.Errorf("read state for %s: %w", key, err)
	}
	if state.Model != key {
		return state, fmt.Errorf("state model %q does not match key %q", state.Model, key)
	}
	return state, nil
}

// SaveState atomically writes state without acquiring locks. This permits
// callers to hold ModelLockPath across a larger transition without deadlocking.
// Deleted runs and tombstoned models are never recreated.
func SaveState(runDir, key string, state State) error {
	if err := validateKey(key); err != nil {
		return err
	}
	if state.Model != key {
		return fmt.Errorf("state model %q does not match key %q", state.Model, key)
	}
	canonical, err := checkedRunDir(runDir, key)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	runDir = canonical
	deleted, err := modelDeleted(runDir, key)
	if err != nil || deleted {
		return err
	}
	if state.Error != nil {
		state.Error = pointer(util.RedactSecrets(*state.Error))
	}
	return persistence.SaveYAML(StatePath(runDir, key), state)
}

func modelDeleted(runDir, key string) (bool, error) {
	info, err := os.Stat(runDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return true, nil
		}
		return false, err
	}
	if !info.IsDir() {
		return false, fmt.Errorf("run path is not a directory: %s", runDir)
	}
	_, err = os.Lstat(filepath.Join(runDir, ".automator", "deleted", key))
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

// transitionLock uses the same ordering as run deletion: run, then model.
func transitionLock(ctx context.Context, runDir, key string) (func(), error) {
	if _, err := checkedRunDir(runDir, key); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	runUnlock, err := persistence.Lock(ctx, RunLockPath(runDir))
	if err != nil {
		return nil, err
	}
	modelUnlock, err := persistence.Lock(ctx, ModelLockPath(runDir, key))
	if err != nil {
		runUnlock()
		return nil, err
	}
	return func() { modelUnlock(); runUnlock() }, nil
}

// MarkFailed preserves captured metrics and session metadata, and synthesizes a
// state from run.yaml when launching failed before the worker wrote its state.
// Live workers, terminal states and deleted models are left unchanged. It
// acquires its own locks and must not be called while holding transition locks.
func MarkFailed(runDir, key, message string) error {
	if err := validateKey(key); err != nil {
		return err
	}
	canonical, err := checkedRunDir(runDir, key)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	runDir = canonical
	deleted, err := modelDeleted(runDir, key)
	if err != nil || deleted {
		return err
	}
	if _, err := LoadState(runDir, key); err != nil {
		if _, err := readSnapshot(runDir, key); err != nil {
			return err
		}
	}
	// A rejected duplicate launch must not mark the real worker as failed.
	unlockLifetime, err := persistence.TryLock(LifetimeLockPath(runDir, key))
	if errors.Is(err, persistence.ErrLocked) {
		return nil
	}
	if err != nil {
		return err
	}
	defer unlockLifetime()
	unlock, err := transitionLock(context.Background(), runDir, key)
	if err != nil {
		return err
	}
	defer unlock()
	deleted, err = modelDeleted(runDir, key)
	if err != nil || deleted {
		return err
	}
	state, err := LoadState(runDir, key)
	if err == nil {
		if state.Status == Done || state.Status == Failed || state.Status == Cancelled {
			return nil
		}
	} else {
		snapshot, err := readSnapshot(runDir, key)
		if err != nil {
			return err
		}
		state = initialState(runDir, key, snapshot.Models[key], snapshot, false)
	}
	state.Status = Failed
	state.FinishedAt = pointer(time.Now().UTC().Format(time.RFC3339Nano))
	state.Error = &message
	return SaveState(runDir, key, state)
}

func initialState(runDir, key string, model config.Model, snapshot config.RunSnapshot, currentPane bool) State {
	state := State{
		Model: key, Provider: model.Provider, Tool: string(model.Tool),
		ProjectPath: filepath.Join(runDir, key),
	}
	state.NativeReopen = nativeReopen(model.Tool, state.ProjectPath, nil)
	if snapshot.Mode == config.Headful {
		setHerdr(&state, snapshot, currentPane)
	}
	return state
}

func setHerdr(state *State, snapshot config.RunSnapshot, currentPane bool) {
	state.TmuxAttach = nil
	state.HerdrSession = pointer(snapshot.HerdrSession)
	if state.HerdrWorkspaceID == nil {
		state.HerdrWorkspaceID = snapshot.HerdrWorkspaceID
	}
	state.HerdrAttach = pointer("herdr session attach " + util.ShellQuote(snapshot.HerdrSession))
	if currentPane {
		if workspace := envValue("HERDR_WORKSPACE_ID"); workspace != nil {
			state.HerdrWorkspaceID = workspace
		}
		if tab := envValue("HERDR_TAB_ID"); tab != nil {
			state.HerdrTabID = tab
		}
		if pane := envValue("HERDR_PANE_ID"); pane != nil {
			state.HerdrPaneID = pane
		}
	}
}

func envValue(key string) *string {
	if value := os.Getenv(key); value != "" {
		return &value
	}
	return nil
}

func nativeReopen(tool config.Tool, project string, sessionID *string) string {
	session := "<session-id>"
	if sessionID != nil && !strings.ContainsAny(*sessionID, "\x00\n\r") {
		session = *sessionID
	}
	flag := "--session"
	if tool == config.Claude {
		flag = "--resume"
	}
	return "cd " + util.ShellQuote(project) + " && " + string(tool) + " " + flag + " " + util.ShellQuote(session)
}

func pointer[T any](value T) *T { return &value }
