package executor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"automator/internal/adapter"
	"automator/internal/config"
	"automator/internal/herdr"
	"automator/internal/persistence"
	"automator/internal/util"
	"automator/internal/worker"
)

// StartModel asynchronously starts a paused/queued model in its existing run.
func StartModel(ctx context.Context, run, key string, force bool) error {
	return modelAction(ctx, run, key, "start", "", force)
}

// RetryModel backs up the old project and starts a fresh worker in place.
func RetryModel(ctx context.Context, run, key string, force bool) error {
	return modelAction(ctx, run, key, "retry", "", force)
}

// ContinueModel recovers a native session if needed and resumes it without hooks.
func ContinueModel(ctx context.Context, run, key, message string, force bool) error {
	if strings.TrimSpace(message) == "" {
		message = "continue"
	}
	return modelAction(ctx, run, key, "continue", message, force)
}

func modelAction(ctx context.Context, run, key, action, message string, force bool) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	runDir, err := config.FindRun(run)
	if err != nil {
		return err
	}
	snapshot, err := loadSnapshot(runDir)
	if err != nil {
		return err
	}
	runDir = snapshot.RunDir
	if err := func() error {
		unlock, err := transitionLock(ctx, runDir, key)
		if err != nil {
			return err
		}
		defer unlock()
		if modelDeleted(runDir, key) {
			return fmt.Errorf("model was deleted: %s", key)
		}
		snapshot, err = loadSnapshot(runDir)
		if err != nil {
			return err
		}
		model, ok := snapshot.Models[key]
		if !ok {
			return fmt.Errorf("model %s missing from run snapshot", key)
		}
		if err := adapter.ValidateModel(key, model); err != nil {
			return err
		}
		lifetime, err := persistence.TryLock(worker.LifetimeLockPath(runDir, key))
		if errors.Is(err, persistence.ErrLocked) {
			return fmt.Errorf("model is already running: %s", key)
		}
		if err != nil {
			return err
		}
		defer lifetime()
		state, err := worker.LoadState(runDir, key)
		if err != nil {
			return err
		}
		if err := checkStatePath(runDir, key, &state); err != nil {
			return err
		}
		if state.Status == worker.Running {
			return fmt.Errorf("model is already running: %s", key)
		}
		switch action {
		case "start":
			if state.Status != worker.Paused && state.Status != worker.Queued && !force {
				return fmt.Errorf("model is %s; use retry or --force to start anyway", state.Status)
			}
		case "retry":
			if err := backupProject(runDir, key); err != nil {
				return err
			}
		case "continue":
			if state.Status == worker.Queued {
				return fmt.Errorf("model already has a continuation in progress: %s", key)
			}
			if state.NativeSessionID == nil {
				metrics, err := adapter.RecoverMetrics(ctx, model, state.ProjectPath, snapshot.Name+":"+key, time.Time{}, "")
				if err != nil {
					return err
				}
				adapter.ApplyPricing(&metrics, model.Pricing)
				mergeMetrics(&state, metrics, false)
				state.NativeReopen = adapter.ReopenCommand(model, state.ProjectPath, stringValue(state.NativeSessionID))
				if err := worker.SaveState(runDir, key, state); err != nil {
					return err
				}
			}
			if state.NativeSessionID == nil {
				return fmt.Errorf("no recoverable native session for %s; use retry instead", key)
			}
			if _, err := adapter.ContinueCommand(model, state.ProjectPath, *state.NativeSessionID, message); err != nil {
				return err
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if action != "continue" {
			if err := writeInitialState(snapshot, key, worker.Queued); err != nil {
				return err
			}
			state, err = worker.LoadState(runDir, key)
			if err != nil {
				return err
			}
		}
		if err := clearCancel(runDir, key); err != nil {
			return err
		}
		// Reserve before dropping locks; a second manual action must not reset
		// state or move a project while the first child is being dispatched.
		state.Status, state.Error = worker.Running, nil
		now := time.Now().UTC().Format(time.RFC3339Nano)
		state.StartedAt, state.FinishedAt, state.DurationSeconds = &now, nil, nil
		return worker.SaveState(runDir, key, state)
	}(); err != nil {
		return err
	}
	subcommand := "worker"
	if action == "continue" {
		subcommand = "continue-worker"
	}
	if snapshot.Mode == config.Headful {
		err = dispatchHerdr(ctx, &snapshot, key, subcommand, message)
	} else {
		err = dispatchDetached(ctx, runDir, key, subcommand, message)
	}
	err = childFailure(runDir, key, err)
	if err := errors.Join(err, refreshReport(runDir)); err != nil {
		return err
	}
	prefix := "started"
	if action != "start" {
		prefix = action + " started"
	}
	fmt.Printf("%s %s / %s\n", prefix, snapshot.Name, key)
	return nil
}

// The supervisor must outlive the short-lived start/retry CLI process. Like a
// Herdr tab wrapper, it synthesizes launch failures and refreshes the report.
func dispatchDetached(ctx context.Context, runDir, key, subcommand, message string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	base := util.ShellQuote(exe)
	flags := " --run " + util.ShellQuote(runDir) + " --model " + util.ShellQuote(key)
	action := base + " " + subcommand + flags
	if subcommand == "continue-worker" {
		action += " --message " + util.ShellQuote(message)
	}
	wrapper := action + "; code=$?; if [ \"$code\" -ne 0 ]; then " + base + " worker-failed" + flags + " --error " + util.ShellQuote("worker process exited before terminal state") + "; fi; " + base + " report-refresh --run " + util.ShellQuote(runDir)
	cmd := exec.Command(util.PreferredShell(), "-c", wrapper)
	configureChild(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn model action for %s: %w", key, err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// StopModel records a cancellation request, interrupts its pane, and signals
// matching native worker processes without cancelling independent models.
func StopModel(ctx context.Context, run, key string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	runDir, err := config.FindRun(run)
	if err != nil {
		return err
	}
	snapshot, err := loadSnapshot(runDir)
	if err != nil {
		return err
	}
	runDir = snapshot.RunDir
	var pane *string
	if err := func() error {
		unlock, err := transitionLock(ctx, runDir, key)
		if err != nil {
			return err
		}
		defer unlock()
		if modelDeleted(runDir, key) {
			return fmt.Errorf("model was deleted: %s", key)
		}
		if _, ok := snapshot.Models[key]; !ok {
			return fmt.Errorf("model %s missing from run snapshot", key)
		}
		state, err := worker.LoadState(runDir, key)
		if err != nil {
			return err
		}
		if state.Status != worker.Running {
			return fmt.Errorf("model is %s, not running", state.Status)
		}
		pane = state.HerdrPaneID
		return persistence.WriteFile(worker.CancelPath(runDir, key), []byte("cancel requested\n"), 0600)
	}(); err != nil {
		return err
	}
	if pane != nil {
		_ = herdr.SendInterrupt(ctx, *pane)
	}
	if err := terminateWorkers(runDir, key); err != nil {
		return err
	}
	fmt.Printf("stop requested for %s / %s\n", run, key)
	return nil
}

// Attach delegates interactive attachment and native fallback to Herdr.
func Attach(ctx context.Context, run, key string) error {
	if key != "" {
		if err := checkKey(key); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	runDir, err := config.FindRun(run)
	if err != nil {
		return err
	}
	snapshot, err := loadSnapshot(runDir)
	if err != nil {
		return err
	}
	if key != "" {
		if _, ok := snapshot.Models[key]; !ok || modelDeleted(snapshot.RunDir, key) {
			return fmt.Errorf("model %s missing from run snapshot", key)
		}
	}
	return herdr.Attach(ctx, &snapshot, key)
}

func backupProject(runDir, key string) error {
	project := filepath.Join(runDir, key)
	if _, err := os.Lstat(project); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	root := filepath.Join(runDir, ".automator", "retry-backups")
	if err := rejectSymlinks(runDir, root); err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	base := key + "-" + time.Now().UTC().Format("20060102150405")
	backup := filepath.Join(root, base)
	for n := 2; ; n++ {
		if _, err := os.Lstat(backup); errors.Is(err, os.ErrNotExist) {
			break
		} else if err != nil {
			return err
		}
		backup = filepath.Join(root, fmt.Sprintf("%s-%d", base, n))
	}
	return os.Rename(project, backup)
}

// Reprice recomputes historical native metrics using snapshot pricing, adopting
// registry pricing only for an identical model. Empty run means all indexed runs.
func Reprice(ctx context.Context, run string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var registry config.ModelsFile
	if err := loadRegistry("models.yaml", &registry, &registry.SchemaVersion); err != nil {
		return err
	}
	var dirs []string
	if run != "" {
		dir, err := config.FindRun(run)
		if err != nil {
			return err
		}
		dirs = []string{dir}
	} else {
		index, err := config.LoadRunsIndex()
		if err != nil {
			return err
		}
		for _, entry := range index.Runs {
			dirs = append(dirs, entry.Path)
		}
	}
	seen := map[string]bool{}
	updated, skippedRunning, skippedUnsupported := 0, 0, 0
	for _, dir := range dirs {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, err := os.Stat(filepath.Join(dir, "run.yaml")); errors.Is(err, os.ErrNotExist) {
			continue
		}
		snapshot, err := loadSnapshot(dir)
		if err != nil {
			return err
		}
		dir = snapshot.RunDir
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if err := func() error {
			metadataUnlock, err := persistence.Lock(ctx, worker.RunLockPath(dir)+".dispatch")
			if err != nil {
				return err
			}
			defer metadataUnlock()
			unlock, err := persistence.Lock(ctx, worker.RunLockPath(dir))
			if err != nil {
				return err
			}
			defer unlock()
			if _, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
				return nil
			}
			snapshot, err = loadSnapshot(dir)
			if err != nil {
				return err
			}
			for _, key := range config.SortedKeys(snapshot.Models) {
				if err := func() error {
					unlock, err := persistence.Lock(ctx, worker.ModelLockPath(dir, key))
					if err != nil {
						return err
					}
					defer unlock()
					if modelDeleted(dir, key) {
						return nil
					}
					state, err := worker.LoadState(dir, key)
					if errors.Is(err, os.ErrNotExist) {
						return nil
					}
					if err != nil {
						return err
					}
					if err := checkStatePath(dir, key, &state); err != nil {
						return err
					}
					if state.Status == worker.Running || state.Status == worker.Queued {
						skippedRunning++
						return nil
					}
					lifetime, err := persistence.TryLock(worker.LifetimeLockPath(dir, key))
					if errors.Is(err, persistence.ErrLocked) {
						skippedRunning++
						return nil
					}
					if err != nil {
						return err
					}
					defer lifetime()
					model := snapshot.Models[key]
					current, exists := registry.Models[key]
					if model.Tool != config.Opencode && model.Tool != config.Claude {
						if model.Pricing != nil || exists && current.Pricing != nil {
							skippedUnsupported++
						}
						return nil
					}
					if model.Pricing == nil {
						if !exists || current.Tool != model.Tool || current.Provider != model.Provider || current.Model != model.Model || current.Pricing == nil {
							return nil
						}
						if err := adapter.ValidateModel(key, current); err != nil {
							return err
						}
						model.Pricing = current.Pricing
						snapshot.Models[key] = model
						if err := persistence.SaveYAML(filepath.Join(dir, "run.yaml"), snapshot); err != nil {
							return err
						}
					}
					if err := adapter.ValidateModel(key, model); err != nil {
						return err
					}
					metrics, err := adapter.RecoverMetrics(ctx, model, state.ProjectPath, snapshot.Name+":"+key, time.Time{}, stringValue(state.NativeSessionID))
					if err != nil {
						return err
					}
					adapter.ApplyPricing(&metrics, model.Pricing)
					if metrics.CostUSD == nil {
						return nil
					}
					mergeMetrics(&state, metrics, true)
					state.NativeReopen = adapter.ReopenCommand(model, state.ProjectPath, stringValue(state.NativeSessionID))
					if err := worker.SaveState(dir, key, state); err != nil {
						return err
					}
					updated++
					return nil
				}(); err != nil {
					return err
				}
			}
			return nil
		}(); err != nil {
			return err
		}
		if err := refreshReport(dir); err != nil {
			return err
		}
	}
	fmt.Printf("repriced %d model projects\n", updated)
	if skippedRunning > 0 {
		fmt.Printf("skipped %d running/queued projects; reprice them after completion\n", skippedRunning)
	}
	if skippedUnsupported > 0 {
		fmt.Printf("skipped %d projects whose tool session format cannot be repriced\n", skippedUnsupported)
	}
	return nil
}

func stringValue(value *string) string {
	if value != nil {
		return *value
	}
	return ""
}

func mergeMetrics(state *worker.State, metrics adapter.Metrics, replace bool) {
	if replace || metrics.InputTokens != nil {
		state.InputTokens = metrics.InputTokens
	}
	if replace || metrics.OutputTokens != nil {
		state.OutputTokens = metrics.OutputTokens
	}
	if replace || metrics.ReasoningTokens != nil {
		state.ReasoningTokens = metrics.ReasoningTokens
	}
	if replace || metrics.CacheReadTokens != nil {
		state.CacheReadTokens = metrics.CacheReadTokens
	}
	if replace || metrics.CacheWriteTokens != nil {
		state.CacheWriteTokens = metrics.CacheWriteTokens
	}
	if replace || metrics.TotalTokens != nil {
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
