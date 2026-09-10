package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"automator/internal/adapter"
	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/process"
	"automator/internal/util"
)

var ErrAlreadyRunning = errors.New("worker already running")

// Run executes template steps, pre hooks, a git baseline, the agent and post_each
// hooks. Cancellation skips remaining hooks and wraps context.Canceled.
func Run(ctx context.Context, runDir, key string) error {
	return execute(ctx, runDir, key, nil, productionDependencies())
}

// Continue resumes the captured native session without running any hooks.
func Continue(ctx context.Context, runDir, key, message string) error {
	return execute(ctx, runDir, key, &message, productionDependencies())
}

type dependencies struct {
	build   func(config.Model, string, string, string) (adapter.Command, error)
	resume  func(config.Model, string, string, string) (adapter.Command, error)
	collect func(context.Context, config.Model, string, string, time.Time) (adapter.Metrics, error)
	recover func(context.Context, config.Model, string, string, time.Time, string) (adapter.Metrics, error)
	shell   func(context.Context, string, string) (int, error)
	agent   func(context.Context, string, adapter.Command) error
	cleanup func(context.Context, string)
}

func productionDependencies() dependencies {
	return dependencies{
		build: adapter.BuildCommand, resume: adapter.ContinueCommand,
		collect: adapter.CollectMetrics, recover: adapter.RecoverMetrics,
		shell: runShell, agent: runCommand, cleanup: cleanupPlaywrightSessions,
	}
}

func execute(ctx context.Context, runDir, key string, message *string, deps dependencies) (resultErr error) {
	defer func() {
		if resultErr != nil {
			resultErr = redactedError{resultErr}
		}
	}()
	if err := validateKey(key); err != nil {
		return err
	}
	ctx, stopSignals := cancellationContext(ctx)
	defer stopSignals()
	if err := ctx.Err(); err != nil {
		return cancellationError(err)
	}
	canonical, err := checkedRunDir(runDir, key)
	if err != nil {
		return err
	}
	runDir = canonical
	runInfo, err := os.Stat(runDir)
	if err != nil {
		return err
	}
	deleted, err := modelDeleted(runDir, key)
	if err != nil || deleted {
		return err
	}
	// Direct worker invocations bypass executor validation. Validate the entire
	// snapshot before even creating locks, then reread it under transition locks.
	snapshot, err := readSnapshot(runDir, key)
	if err != nil {
		return err
	}
	// This is intentionally distinct from ModelLockPath. Deletion and stop
	// transitions must not wait for a long-running model to release its lock.
	unlockLifetime, err := persistence.TryLock(LifetimeLockPath(runDir, key))
	if err != nil {
		if errors.Is(err, persistence.ErrLocked) {
			return fmt.Errorf("%w: %s: %w", ErrAlreadyRunning, key, err)
		}
		return err
	}
	defer unlockLifetime()

	var model config.Model
	var state State
	if err := func() error {
		unlock, err := transitionLock(ctx, runDir, key)
		if err != nil {
			return err
		}
		defer unlock()
		deleted, err = modelDeleted(runDir, key)
		if err != nil || deleted {
			return err
		}
		currentInfo, err := os.Stat(runDir)
		if err != nil {
			return err
		}
		if !os.SameFile(runInfo, currentInfo) {
			deleted = true
			return nil
		}
		snapshot, err = readSnapshot(runDir, key)
		if err != nil {
			return err
		}
		model = snapshot.Models[key]
		previous, stateErr := LoadState(runDir, key)
		if stateErr != nil && !errors.Is(stateErr, os.ErrNotExist) {
			return stateErr
		}
		if message != nil {
			if stateErr != nil {
				return stateErr
			}
			if previous.NativeSessionID == nil {
				return fmt.Errorf("no native session id captured for %s", key)
			}
			state = previous
		} else {
			state = initialState(runDir, key, model, snapshot, false)
		}
		if snapshot.Mode == config.Headful {
			if stateErr == nil {
				state.HerdrWorkspaceID = previous.HerdrWorkspaceID
				state.HerdrTabID = previous.HerdrTabID
				state.HerdrPaneID = previous.HerdrPaneID
			}
			setHerdr(&state, snapshot, true)
		}
		// A Running state can be prelaunched by the executor. Its cancel marker
		// belongs to this launch and must not be mistaken for a stale request.
		if stateErr != nil || previous.Status != Running {
			if err := clearCancelRequest(runDir, key); err != nil {
				return err
			}
		}
		state.Status = Running
		state.StartedAt = pointer(time.Now().UTC().Format(time.RFC3339Nano))
		state.FinishedAt, state.DurationSeconds, state.Error = nil, nil, nil
		return SaveState(runDir, key, state)
	}(); err != nil {
		if ctx.Err() != nil {
			return cancellationError(err)
		}
		return err
	}
	if deleted {
		return nil
	}

	started := time.Now()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			if cancelRequested(runDir, key) {
				cancel()
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { cancel(); <-watchDone }()

	project := filepath.Join(runDir, key)
	title := snapshot.Name + ":" + key
	// Setup may replace paths, so a startup-only check is insufficient for later
	// hooks, git, or failure cleanup. Never execute through a replaced symlink.
	shell := deps.shell
	deps.shell = func(ctx context.Context, project, command string) (int, error) {
		if _, err := checkedRunDir(runDir, key); err != nil {
			return 0, err
		}
		return shell(ctx, project, command)
	}
	postAttempted := false
	result := func() error {
		if cancelRequested(runDir, key) {
			cancel()
		}
		if ctx.Err() != nil {
			return cancellationError(ctx.Err())
		}
		if message == nil {
			if err := os.MkdirAll(project, 0o755); err != nil {
				return err
			}
			if err := runSteps(ctx, deps.shell, project, snapshot.Template.Steps); err != nil {
				return err
			}
			if err := runSteps(ctx, deps.shell, project, snapshot.Pre); err != nil {
				return err
			}
			if err := gitBaseline(ctx, deps.shell, project); err != nil {
				return err
			}
		}
		var command adapter.Command
		var err error
		if _, err := checkedRunDir(runDir, key); err != nil {
			return err
		}
		if message == nil {
			command, err = deps.build(model, project, filepath.Join(runDir, "prompt.md"), title)
		} else {
			command, err = deps.resume(model, project, *state.NativeSessionID, *message)
		}
		if err != nil {
			return err
		}
		if _, err := checkedRunDir(runDir, key); err != nil {
			return err
		}
		err = deps.agent(ctx, project, command)
		if err != nil {
			err = fmt.Errorf("agent %s: %w", command.Program, err)
		}
		if _, pathErr := checkedRunDir(runDir, key); pathErr != nil {
			return errors.Join(err, pathErr)
		}
		// Session files and browser cleanup are still useful after interruption.
		// There is no execution deadline, including for these best-effort steps.
		metadataCtx := ctx
		if ctx.Err() != nil {
			// Allow recovery after an interruption, but a subsequent signal can
			// still stop a stuck metadata or browser command.
			var stopMetadataSignals context.CancelFunc
			metadataCtx, stopMetadataSignals = cancellationContext(context.WithoutCancel(ctx))
			defer stopMetadataSignals()
		}
		deps.cleanup(metadataCtx, project)
		if _, pathErr := checkedRunDir(runDir, key); pathErr != nil {
			return errors.Join(err, pathErr)
		}
		var metrics adapter.Metrics
		var metricsErr error
		knownSession := ""
		if state.NativeSessionID != nil {
			knownSession = *state.NativeSessionID
		}
		if message != nil {
			metrics, metricsErr = deps.recover(metadataCtx, model, project, title, started, knownSession)
		} else {
			metrics, metricsErr = deps.collect(metadataCtx, model, project, title, started)
		}
		adapter.ApplyPricing(&metrics, model.Pricing)
		mergeMetrics(&state, metrics)
		if metricsErr != nil && message == nil {
			recovered, _ := deps.recover(metadataCtx, model, project, title, started, knownSession)
			adapter.ApplyPricing(&recovered, model.Pricing)
			mergeMetrics(&state, recovered)
		}
		state.NativeReopen = nativeReopen(model.Tool, project, state.NativeSessionID)
		if ctx.Err() != nil || process.ExitWasCancelled(err) || cancelRequested(runDir, key) {
			cancel()
			return cancellationError(err)
		}
		if err != nil {
			return err
		}
		if message == nil {
			postAttempted = true
			return runSteps(ctx, deps.shell, project, snapshot.PostEach)
		}
		return nil
	}()
	if ctx.Err() != nil || errors.Is(result, context.Canceled) || cancelRequested(runDir, key) {
		result = cancellationError(result)
	}
	if result != nil && !errors.Is(result, context.Canceled) && message == nil && !postAttempted {
		if postErr := runSteps(ctx, deps.shell, project, snapshot.PostEach); postErr != nil {
			result = fmt.Errorf("%w; post_each failed: %w", result, postErr)
		}
	}
	if ctx.Err() != nil || errors.Is(result, context.Canceled) || cancelRequested(runDir, key) {
		result = cancellationError(result)
	}
	state.DurationSeconds = pointer(uint64(time.Since(started) / time.Second))
	state.FinishedAt = pointer(time.Now().UTC().Format(time.RFC3339Nano))
	state.Status = Done
	if result != nil {
		state.Status = Failed
		if errors.Is(result, context.Canceled) {
			state.Status = Cancelled
		}
		state.Error = pointer(result.Error())
	}
	// Persist with an uncancelled context, but only while the original run and
	// state still exist. Never resurrect a model deleted while it was executing.
	saveErr := func() error {
		unlock, err := transitionLock(context.WithoutCancel(ctx), runDir, key)
		if err != nil {
			return err
		}
		defer unlock()
		currentInfo, err := os.Stat(runDir)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if !os.SameFile(runInfo, currentInfo) {
			return nil
		}
		current, err := LoadState(runDir, key)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if ctx.Err() != nil || cancelRequested(runDir, key) || current.Status == Cancelled {
			result = cancellationError(result)
			state.Status = Cancelled
			state.Error = pointer(result.Error())
		}
		if err := SaveState(runDir, key, state); err != nil {
			return err
		}
		if state.Status == Cancelled {
			return clearCancelRequest(runDir, key)
		}
		return nil
	}()
	return errors.Join(result, saveErr)
}

func cancellationError(err error) error {
	if err == nil {
		return context.Canceled
	}
	if errors.Is(err, context.Canceled) {
		return err
	}
	return fmt.Errorf("%w: %v", context.Canceled, err)
}

func cancelRequested(runDir, key string) bool {
	if _, err := checkedRunDir(runDir, key); err != nil {
		return true
	}
	if _, err := os.Lstat(CancelPath(runDir, key)); err == nil {
		return true
	}
	if deleted, _ := modelDeleted(runDir, key); deleted {
		return true
	}
	_, err := os.Stat(StatePath(runDir, key))
	return errors.Is(err, os.ErrNotExist)
}

func clearCancelRequest(runDir, key string) error {
	if _, err := checkedRunDir(runDir, key); err != nil {
		return err
	}
	err := os.Remove(CancelPath(runDir, key))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func runCommand(ctx context.Context, project string, command adapter.Command) error {
	cmd := process.CommandContext(ctx, command.Program, command.Args...)
	cmd.Dir = project
	cmd.Env = append(cmd.Environ(), command.Env...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return cancellationError(ctx.Err())
	}
	return err
}

func runShell(ctx context.Context, project, shell string) (int, error) {
	cmd := process.CommandContext(ctx, util.PreferredShell(), "-lc", shell)
	cmd.Dir = project
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return -1, cancellationError(ctx.Err())
	}
	if process.ExitWasCancelled(err) {
		return -1, cancellationError(err)
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode(), nil
	}
	return 0, err
}

func runSteps(ctx context.Context, shell func(context.Context, string, string) (int, error), project string, steps []config.ShellStep) error {
	for _, step := range steps {
		if ctx.Err() != nil {
			return cancellationError(ctx.Err())
		}
		code, err := shell(ctx, project, step.Shell)
		display := util.RedactSecrets(step.Shell)
		if err != nil {
			return fmt.Errorf("run shell %q: %w", display, err)
		}
		if code == 130 || code == 143 {
			return cancellationError(fmt.Errorf("command interrupted (%d): %s", code, display))
		}
		if code != 0 {
			return fmt.Errorf("command failed (%d): %s", code, display)
		}
	}
	return nil
}

func gitBaseline(ctx context.Context, shell func(context.Context, string, string) (int, error), project string) error {
	if err := runSteps(ctx, shell, project, []config.ShellStep{{Shell: "git init"}, {Shell: "git add -A"}}); err != nil {
		return err
	}
	// A pre-existing template repository may already contain the same baseline;
	// as in the Rust worker, only failure to launch the commit is fatal.
	_, err := shell(ctx, project, "git -c user.email=automator@example.invalid -c user.name=Automator commit --allow-empty -m 'Automator baseline'")
	return err
}

func mergeMetrics(state *State, metrics adapter.Metrics) {
	if metrics.InputTokens != nil {
		state.InputTokens = metrics.InputTokens
	}
	if metrics.OutputTokens != nil {
		state.OutputTokens = metrics.OutputTokens
	}
	if metrics.ReasoningTokens != nil {
		state.ReasoningTokens = metrics.ReasoningTokens
	}
	if metrics.CacheReadTokens != nil {
		state.CacheReadTokens = metrics.CacheReadTokens
	}
	if metrics.CacheWriteTokens != nil {
		state.CacheWriteTokens = metrics.CacheWriteTokens
	}
	if metrics.TotalTokens != nil {
		state.TotalTokens = metrics.TotalTokens
	}
	if metrics.CostUSD != nil {
		state.Cost = metrics.CostUSD
	}
	if metrics.NativeSessionID != nil {
		state.NativeSessionID = metrics.NativeSessionID
	}
	if metrics.ToolVersion != nil {
		state.ToolVersion = metrics.ToolVersion
	}
}

func cleanupPlaywrightSessions(ctx context.Context, project string) {
	cmd := process.CommandContext(ctx, "playwright-cli", "list", "--json")
	cmd.Dir = project
	output, err := cmd.Output()
	if err != nil {
		return
	}
	var list struct {
		Browsers []struct {
			Name      string `json:"name"`
			Workspace string `json:"workspace"`
		} `json:"browsers"`
	}
	if json.Unmarshal(output, &list) != nil {
		return
	}
	for _, browser := range list.Browsers {
		if workspaceMatches(browser.Workspace, project) {
			close := process.CommandContext(ctx, "playwright-cli", "-s="+browser.Name, "close")
			close.Dir = project
			close.Stdout, close.Stderr = os.Stdout, os.Stderr
			_ = close.Run()
		}
	}
}

func workspaceMatches(workspace, project string) bool {
	if workspace == "" {
		return false
	}
	if workspace == project {
		return true
	}
	workspacePath, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		return false
	}
	projectPath, err := filepath.EvalSymlinks(project)
	if err != nil {
		return false
	}
	workspacePath, err = filepath.Abs(workspacePath)
	if err != nil {
		return false
	}
	projectPath, err = filepath.Abs(projectPath)
	return err == nil && workspacePath == projectPath
}
