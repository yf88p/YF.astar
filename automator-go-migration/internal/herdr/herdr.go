// Package herdr manages Automator's session, per-run workspaces, and durable
// model tabs. Scheduling and report generation remain the caller's responsibility.
package herdr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/util"
	"automator/internal/worker"
)

const session = "Automator"

type tab struct {
	tabID  string
	paneID string
}

type tabOptions struct {
	workspace     map[string]any
	reuseExisting bool
	markRunning   bool
	message       string
}

// EnsureWorkspace starts the Automator server if necessary and reuses a live
// recorded workspace, or creates one. New IDs are saved to run.yaml and snapshot.
func EnsureWorkspace(ctx context.Context, snapshot *config.RunSnapshot) (err error) {
	defer func() { err = redactError(err) }()
	if snapshot == nil || snapshot.RunDir == "" {
		return errors.New("Herdr workspace requires a run directory")
	}
	unlock, err := persistence.Lock(ctx, worker.RunLockPath(snapshot.RunDir))
	if err != nil {
		return err
	}
	defer unlock()
	_, err = ensureWorkspace(ctx, snapshot)
	return err
}

// A nil workspace means it was just created; saved model targets cannot belong
// to it, even if a restarted server happened to recycle the same public ID.
func ensureWorkspace(ctx context.Context, snapshot *config.RunSnapshot) (map[string]any, error) {
	info, err := os.Stat(snapshot.RunDir)
	if err != nil {
		return nil, fmt.Errorf("run directory no longer exists: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("run path is not a directory: %s", snapshot.RunDir)
	}
	if err := ensureReady(ctx); err != nil {
		return nil, err
	}
	label := snapshot.HerdrWorkspaceLabel
	if label == "" {
		label = snapshot.Name
	}
	if snapshot.HerdrWorkspaceID != nil && snapshot.HerdrRootTabID != nil && snapshot.HerdrRootPaneID != nil {
		value, err := commandJSON(ctx, "workspace", "list")
		if err != nil {
			return nil, err
		}
		workspace := listedObject(commandResult(value), "workspaces", "workspace_id", *snapshot.HerdrWorkspaceID)
		if workspace != nil && identityMatches(workspace, map[string]string{"label": label}, snapshot.RunDir) {
			return workspace, nil
		}
	}
	value, err := commandJSON(ctx, "workspace", "create", "--cwd", snapshot.RunDir, "--label", label, "--no-focus")
	if err != nil {
		return nil, err
	}
	result := commandResult(value)
	workspaceID := objectID(result, "workspace", "workspace_id", "id")
	if workspaceID == "" {
		return nil, errors.New("herdr workspace id missing")
	}
	rootTabID := objectID(result, "tab", "tab_id", "id")
	if rootTabID == "" {
		return nil, errors.New("herdr root tab id missing")
	}
	rootPaneID := objectID(result, "root_pane", "pane_id", "terminal_id", "id")
	if rootPaneID == "" {
		return nil, errors.New("herdr root pane id missing")
	}
	updated := *snapshot
	updated.HerdrSession = session
	updated.HerdrWorkspaceLabel = label
	updated.HerdrWorkspaceID = &workspaceID
	updated.HerdrRootTabID = &rootTabID
	updated.HerdrRootPaneID = &rootPaneID
	if err := persistence.SaveYAML(filepath.Join(snapshot.RunDir, "run.yaml"), &updated); err != nil {
		return nil, fmt.Errorf("record Herdr workspace: %w", err)
	}
	*snapshot = updated
	return nil, nil
}

// CreateTabs prepares the tabs for a heavy, paused run without starting workers
// or changing model statuses. Model state files must already exist.
func CreateTabs(ctx context.Context, snapshot *config.RunSnapshot) (err error) {
	defer func() { err = redactError(err) }()
	if snapshot == nil || snapshot.RunDir == "" {
		return errors.New("Herdr tabs require a run directory")
	}
	unlock, err := persistence.Lock(ctx, worker.RunLockPath(snapshot.RunDir))
	if err != nil {
		return err
	}
	defer unlock()
	workspace, err := ensureWorkspace(ctx, snapshot)
	if err != nil {
		return err
	}
	root := &tab{*snapshot.HerdrRootTabID, *snapshot.HerdrRootPaneID}
	for _, key := range config.SortedKeys(snapshot.Models) {
		cmd := fmt.Sprintf("echo %s; echo %s; exec %s",
			util.ShellQuote(fmt.Sprintf("automator paused: %s / %s", snapshot.Name, key)),
			util.ShellQuote(fmt.Sprintf("start with: automator start %s %s", snapshot.Name, key)),
			util.ShellQuote(util.PreferredShell()))
		if err := launchShellTab(ctx, snapshot, key, cmd, &root, tabOptions{workspace: workspace}); err != nil {
			return fmt.Errorf("create paused Herdr tab for %s: %w", key, err)
		}
	}
	return nil
}

// Dispatch launches worker or continue-worker in the model's durable tab. It
// marks the state running before dispatch and replaces a stale pane once.
func Dispatch(ctx context.Context, snapshot *config.RunSnapshot, key, subcommand, message string) (err error) {
	defer func() { err = redactError(err, message) }()
	if subcommand != "worker" && subcommand != "continue-worker" {
		return fmt.Errorf("unsupported Herdr worker subcommand: %s", subcommand)
	}
	if snapshot == nil || snapshot.RunDir == "" {
		return errors.New("Herdr dispatch requires a run directory")
	}
	if !util.IsSafePathComponent(key) {
		return fmt.Errorf("unsafe model key: %s", key)
	}
	if modelDeleted(snapshot.RunDir, key) {
		return nil
	}
	if _, ok := snapshot.Models[key]; !ok {
		return fmt.Errorf("model %s missing from run snapshot", key)
	}
	unlock, err := persistence.Lock(ctx, worker.RunLockPath(snapshot.RunDir))
	if err != nil {
		return err
	}
	defer unlock()
	workspace, err := ensureWorkspace(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("ensure Herdr workspace for %s: %w", key, err)
	}
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate automator worker executable: %w", err)
	}
	exeQ, runQ, keyQ := util.ShellQuote(exe), util.ShellQuote(snapshot.RunDir), util.ShellQuote(key)
	action := fmt.Sprintf("%s %s --run %s --model %s", exeQ, subcommand, runQ, keyQ)
	failure, exited := "worker process exited before terminal state", "worker"
	if subcommand == "continue-worker" {
		action += " --message " + util.ShellQuote(message)
		failure, exited = "continue worker exited before terminal state", "continue"
	}
	cmd := fmt.Sprintf("%s; code=$?; if [ \"$code\" -ne 0 ]; then %s worker-failed --run %s --model %s --error %s; fi; %s report-refresh --run %s; echo; echo 'automator %s exited. press Ctrl-D to close.'; exec %s",
		action, exeQ, runQ, keyQ, util.ShellQuote(failure), exeQ, runQ, exited, util.ShellQuote(util.PreferredShell()))
	var root *tab
	if subcommand == "worker" {
		root = &tab{*snapshot.HerdrRootTabID, *snapshot.HerdrRootPaneID}
		// Dispatch is called separately for each model, so ownership of the root
		// tab must survive in state rather than in a scheduler-local variable.
		for _, model := range config.SortedKeys(snapshot.Models) {
			state, err := worker.LoadState(snapshot.RunDir, model)
			if err == nil && state.HerdrWorkspaceID != nil && *state.HerdrWorkspaceID == *snapshot.HerdrWorkspaceID &&
				((state.HerdrTabID != nil && *state.HerdrTabID == root.tabID) ||
					(state.HerdrPaneID != nil && *state.HerdrPaneID == root.paneID)) {
				root = nil
				break
			}
		}
	}
	if err := launchShellTab(ctx, snapshot, key, cmd, &root, tabOptions{
		workspace: workspace, reuseExisting: true, markRunning: true, message: message,
	}); err != nil {
		return fmt.Errorf("dispatch %s for %s: %w", subcommand, key, err)
	}
	return nil
}

func launchShellTab(ctx context.Context, snapshot *config.RunSnapshot, key, cmd string, root **tab, options tabOptions) (err error) {
	defer func() { err = redactError(err, cmd, options.message) }()
	if !util.IsSafePathComponent(key) {
		return fmt.Errorf("unsafe model key: %s", key)
	}
	unlock, err := persistence.Lock(ctx, worker.ModelLockPath(snapshot.RunDir, key))
	if err != nil {
		return err
	}
	defer unlock()
	if modelDeleted(snapshot.RunDir, key) {
		return nil
	}
	if err := os.Remove(worker.CancelPath(snapshot.RunDir, key)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	var target *tab
	if options.reuseExisting && options.workspace != nil {
		state, err := worker.LoadState(snapshot.RunDir, key)
		if err == nil && state.HerdrWorkspaceID != nil && *state.HerdrWorkspaceID == *snapshot.HerdrWorkspaceID &&
			(state.HerdrSession == nil || *state.HerdrSession == "" || *state.HerdrSession == session) &&
			state.HerdrTabID != nil && state.HerdrPaneID != nil {
			target = &tab{*state.HerdrTabID, *state.HerdrPaneID}
		}
	}
	if target == nil && *root != nil {
		target, *root = *root, nil
	}
	if target != nil {
		matches, err := targetMatches(ctx, snapshot, key, target, options.workspace)
		if err != nil {
			return err
		}
		if !matches {
			target = nil
		}
	}
	if target != nil {
		if target.tabID != "" {
			_ = commandStatus(ctx, "tab", "rename", target.tabID, key)
		}
	} else {
		target, err = createTab(ctx, snapshot, key)
		if err != nil {
			return err
		}
	}
	if err := recordModelState(snapshot, key, target, options.markRunning); err != nil {
		return err
	}
	err = commandStatus(ctx, "pane", "run", target.paneID, cmd)
	if err != nil && options.reuseExisting && ctx.Err() == nil {
		staleError := err
		target, err = createTab(ctx, snapshot, key)
		if err != nil {
			err = fmt.Errorf("replace stale Herdr target: %v: %w", staleError, err)
		} else if err = recordModelState(snapshot, key, target, options.markRunning); err == nil {
			if err = commandStatus(ctx, "pane", "run", target.paneID, cmd); err != nil {
				err = fmt.Errorf("run replacement Herdr pane: %v: %w", staleError, err)
			}
		}
	}
	err = redactError(err, cmd, options.message)
	if err != nil && options.markRunning {
		// Both transition locks are already held; SaveState does not relock.
		state, stateErr := worker.LoadState(snapshot.RunDir, key)
		if stateErr != nil {
			return errors.Join(err, stateErr)
		}
		if state.Status != worker.Done && state.Status != worker.Cancelled {
			state.Status = worker.Failed
			now, message := time.Now().UTC().Format(time.RFC3339Nano), "failed to launch worker pane: "+err.Error()
			state.FinishedAt, state.Error = &now, &message
			if stateErr := worker.SaveState(snapshot.RunDir, key, state); stateErr != nil {
				return errors.Join(err, stateErr)
			}
		}
	}
	return err
}

func createTab(ctx context.Context, snapshot *config.RunSnapshot, key string) (*tab, error) {
	projectDir := filepath.Join(snapshot.RunDir, key)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return nil, err
	}
	value, err := commandJSON(ctx, "tab", "create", "--workspace", *snapshot.HerdrWorkspaceID,
		"--cwd", projectDir, "--label", key, "--env", "SHELL="+util.PreferredShell(), "--no-focus")
	if err != nil {
		return nil, err
	}
	result := commandResult(value)
	tabID := objectID(result, "tab", "tab_id", "id")
	if tabID == "" {
		return nil, errors.New("herdr tab id missing")
	}
	paneID := objectID(result, "root_pane", "pane_id", "terminal_id", "id")
	if paneID == "" {
		return nil, errors.New("herdr tab root pane id missing")
	}
	return &tab{tabID, paneID}, nil
}

func recordModelState(snapshot *config.RunSnapshot, key string, target *tab, markRunning bool) error {
	state, err := worker.LoadState(snapshot.RunDir, key)
	if err != nil {
		return fmt.Errorf("read state for %s: %w", key, err)
	}
	state.TmuxAttach = nil
	if markRunning {
		state.Status = worker.Running
		now := time.Now().UTC().Format(time.RFC3339Nano)
		state.StartedAt = &now
	}
	name := session
	state.HerdrSession = &name
	state.HerdrWorkspaceID = snapshot.HerdrWorkspaceID
	state.HerdrTabID, state.HerdrPaneID = &target.tabID, &target.paneID
	attach := "herdr session attach " + util.ShellQuote(snapshot.HerdrSession)
	state.HerdrAttach = &attach
	return worker.SaveState(snapshot.RunDir, key, state)
}

// Attach focuses the recorded model tab and opens its session interactively.
// If Herdr is unavailable, a captured native reopen command is used instead.
// An empty key attaches the run's session without selecting a model tab.
func Attach(ctx context.Context, snapshot *config.RunSnapshot, key string) (err error) {
	defer func() { err = redactError(err) }()
	if snapshot == nil || snapshot.RunDir == "" {
		return errors.New("Herdr attach requires a run directory")
	}
	var state worker.State
	if key != "" {
		if !util.IsSafePathComponent(key) {
			return fmt.Errorf("unsafe model key: %s", key)
		}
		state, _ = worker.LoadState(snapshot.RunDir, key)
	}
	name := snapshot.HerdrSession
	if state.HerdrSession != nil {
		name = *state.HerdrSession
	}
	if name == "" {
		name = session
	}
	err = ensureReady(ctx)
	if err == nil {
		workspaceID := state.HerdrWorkspaceID
		if workspaceID == nil {
			workspaceID = snapshot.HerdrWorkspaceID
		}
		if workspaceID != nil {
			_ = commandStatus(ctx, "workspace", "focus", *workspaceID)
		}
		if state.HerdrTabID != nil {
			_ = commandStatus(ctx, "tab", "focus", *state.HerdrTabID)
		}
		cmd := command(ctx, "session", "attach", name)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		if err = cmd.Run(); err == nil {
			return nil
		}
		err = fmt.Errorf("herdr session attach failed: %s: %w", name, err)
	}
	if ctx.Err() != nil {
		return fmt.Errorf("attach Herdr session: %w", ctx.Err())
	}
	if key == "" {
		return err
	}
	if state.NativeReopen == "" || strings.Contains(state.NativeReopen, "<session-id>") {
		return fmt.Errorf("Herdr target unavailable and no native session id captured for %s: %w", key, err)
	}
	cmd := exec.CommandContext(ctx, util.PreferredShell(), "-lc", state.NativeReopen)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if reopenErr := cmd.Run(); reopenErr != nil {
		if ctx.Err() != nil {
			reopenErr = ctx.Err()
		}
		return fmt.Errorf("reopen native session for %s after %v: %w", key, err, reopenErr)
	}
	return nil
}

// SendInterrupt sends a real Ctrl-C key to a pane in the Automator session.
func SendInterrupt(ctx context.Context, paneID string) (err error) {
	defer func() { err = redactError(err) }()
	return commandStatus(ctx, "pane", "send-keys", paneID, "Ctrl-C")
}

// AttachCommand returns the shell-quoted session attach command, preferring the
// model's recorded session and defaulting an empty session to Automator.
func AttachCommand(snapshot config.RunSnapshot, state worker.State) string {
	name := snapshot.HerdrSession
	if state.HerdrSession != nil {
		name = *state.HerdrSession
	}
	if name == "" {
		name = session
	}
	return "herdr session attach " + util.ShellQuote(name)
}

func ensureReady(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, err := exec.LookPath("herdr"); err != nil {
		return errors.New("herdr not found; install herdr or use mode: headless")
	}
	ready, err := serverReady(ctx)
	if err != nil || ready {
		return err
	}
	if err := startServer(ctx); err != nil {
		return err
	}
	for i := 0; i < 40; i++ {
		ready, err = serverReady(ctx)
		if err != nil || ready {
			return err
		}
		timer := time.NewTimer(250 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return errors.New("herdr Automator session did not become ready")
}

func serverReady(ctx context.Context) (bool, error) {
	err := command(ctx, "status", "server").Run()
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return false, nil
	}
	return err == nil, err
}

func startServer(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	logDir := filepath.Join(config.HomeDir(), "herdr")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("start Herdr Automator server: %w", err)
	}
	stdout, err := os.OpenFile(filepath.Join(logDir, "automator.out.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("start Herdr Automator server: %w", err)
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(filepath.Join(logDir, "automator.err.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("start Herdr Automator server: %w", err)
	}
	defer stderr.Close()
	// The server belongs to the session, not the lifetime of this request.
	cmd := command(context.Background(), "server")
	cmd.Stdout, cmd.Stderr = stdout, stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start Herdr Automator server: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func command(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "herdr", args...)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "HERDR_SOCKET_PATH", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID", "HERDR_PANE_ID", "HERDR_ENV", "HERDR_SESSION", "SHELL":
			continue
		}
		cmd.Env = append(cmd.Env, entry)
	}
	cmd.Env = append(cmd.Env, "HERDR_SESSION="+session, "SHELL="+util.PreferredShell())
	return cmd
}

func commandOutput(ctx context.Context, args ...string) ([]byte, error) {
	cmd := command(ctx, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	description := strings.Join(args, " ")
	var payload string
	if len(args) > 3 && args[0] == "pane" && args[1] == "run" {
		payload = args[3]
		description = strings.Join(args[:3], " ") + " [command redacted]"
	}
	if ctx.Err() != nil {
		return nil, redactError(fmt.Errorf("herdr %s: %w", description, ctx.Err()), payload)
	}
	if err != nil {
		return nil, redactError(fmt.Errorf("herdr %s failed: %s: %w", description, strings.TrimSpace(stderr.String()), err), payload)
	}
	return output, nil
}

func commandStatus(ctx context.Context, args ...string) error {
	_, err := commandOutput(ctx, args...)
	return err
}

func commandJSON(ctx context.Context, args ...string) (map[string]any, error) {
	output, err := commandOutput(ctx, args...)
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(output, &value); err != nil {
		return nil, redactError(fmt.Errorf("parse herdr JSON from `%s`: %w", strings.Join(args, " "), err))
	}
	return value, nil
}

func commandResult(value map[string]any) map[string]any {
	if result, exists := value["result"]; exists {
		object, _ := result.(map[string]any)
		return object
	}
	return value
}

func objectID(value map[string]any, object string, keys ...string) string {
	nested, _ := value[object].(map[string]any)
	for _, key := range keys {
		if id, ok := nested[key].(string); ok && id != "" {
			return id
		}
	}
	return ""
}

func listedObject(value map[string]any, collection, idKey, id string) map[string]any {
	items, _ := value[collection].([]any)
	for _, item := range items {
		object, _ := item.(map[string]any)
		if objectID, ok := object[idKey].(string); ok && objectID != "" && objectID == id {
			return object
		}
	}
	return nil
}

// Missing metadata is not a mismatch: older Herdr responses contain only IDs.
// Cwds may move within a project, but never into another run/model project.
func identityMatches(info map[string]any, expected map[string]string, directory string) bool {
	for key, want := range expected {
		if got, ok := info[key].(string); ok && got != "" && got != want {
			return false
		}
	}
	for _, key := range []string{"directory", "cwd"} {
		got, ok := info[key].(string)
		if !ok || got == "" {
			continue
		}
		base, err := filepath.Abs(directory)
		if err != nil {
			return false
		}
		path, err := filepath.Abs(got)
		if err != nil {
			return false
		}
		if resolved, err := filepath.EvalSymlinks(base); err == nil {
			base = resolved
		}
		if resolved, err := filepath.EvalSymlinks(path); err == nil {
			path = resolved
		}
		rel, err := filepath.Rel(base, path)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return false
		}
	}
	return true
}

func targetMatches(ctx context.Context, snapshot *config.RunSnapshot, key string, target *tab, workspace map[string]any) (bool, error) {
	// Do not probe additional endpoints for ID-only reference/legacy responses.
	rich := false
	for _, field := range []string{"label", "directory", "cwd", "tab_count", "pane_count", "tabs", "panes"} {
		if value, ok := workspace[field]; ok && value != nil && value != "" {
			rich = true
			break
		}
	}
	if !rich {
		return true, nil
	}
	var rootPane map[string]any
	for _, item := range []struct{ kind, id string }{{"tab", target.tabID}, {"pane", target.paneID}} {
		var info map[string]any
		if _, ok := workspace[item.kind+"s"].([]any); ok {
			info = listedObject(workspace, item.kind+"s", item.kind+"_id", item.id)
			if info == nil {
				return false, nil
			}
		} else if item.kind == "pane" && rootPane != nil {
			info = rootPane
		} else {
			value, err := commandJSON(ctx, item.kind, "get", item.id)
			if err != nil {
				var exit *exec.ExitError
				if errors.As(err, &exit) && ctx.Err() == nil {
					text := strings.ToLower(err.Error())
					if strings.Contains(text, "not found") || strings.Contains(text, "unknown "+item.kind) {
						return false, nil
					}
					if strings.Contains(text, "unknown command") || strings.Contains(text, "unrecognized subcommand") || strings.Contains(text, "unsupported command") || strings.Contains(text, "unsupported method") {
						continue
					}
				}
				return false, fmt.Errorf("verify Herdr %s target: %w", item.kind, err)
			}
			info, _ = commandResult(value)[item.kind].(map[string]any)
		}
		expected := map[string]string{"workspace_id": *snapshot.HerdrWorkspaceID, "tab_id": target.tabID, "id": item.id}
		if item.kind == "tab" {
			expected["label"] = key
			expected["root_pane_id"] = target.paneID
			rootPane, _ = info["root_pane"].(map[string]any)
		} else {
			expected["pane_id"] = target.paneID
		}
		directory := filepath.Join(snapshot.RunDir, key)
		// The workspace root starts in the run directory, unlike created tabs.
		if target.tabID == *snapshot.HerdrRootTabID && target.paneID == *snapshot.HerdrRootPaneID {
			for _, field := range []string{"cwd", "directory"} {
				if cwd, ok := info[field].(string); ok && filepath.Clean(cwd) == filepath.Clean(snapshot.RunDir) {
					copy := make(map[string]any, len(info))
					for k, v := range info {
						copy[k] = v
					}
					delete(copy, field)
					info = copy
				}
			}
		}
		if !identityMatches(info, expected, directory) {
			return false, nil
		}
	}
	return true, nil
}

type redactedError struct {
	cause error
	text  string
}

func (err redactedError) Error() string { return err.text }
func (err redactedError) Unwrap() error { return err.cause }

func redactError(err error, payloads ...string) error {
	if err == nil {
		return nil
	}
	text := err.Error()
	for _, payload := range payloads {
		if payload != "" {
			for _, value := range []string{util.ShellQuote(payload), payload} {
				// Herdr may echo a command either literally or inside JSON.
				encoded, _ := json.Marshal(value)
				text = strings.ReplaceAll(text, string(encoded[1:len(encoded)-1]), "[redacted]")
				text = strings.ReplaceAll(text, value, "[redacted]")
			}
		}
	}
	text = util.RedactSecrets(text)
	if text == err.Error() {
		return err
	}
	return redactedError{cause: err, text: text}
}

func modelDeleted(runDir, key string) bool {
	_, err := os.Lstat(filepath.Join(runDir, ".automator", "deleted", key))
	return err == nil
}
