package executor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"automator/internal/config"
	"automator/internal/herdr"
	"automator/internal/persistence"
	"automator/internal/worker"
)

func modelDeleted(runDir, key string) bool {
	if _, err := os.Stat(filepath.Join(runDir, "run.yaml")); errors.Is(err, os.ErrNotExist) {
		return true
	}
	_, err := os.Lstat(filepath.Join(runDir, ".automator", "deleted", key))
	return err == nil
}

func terminal(status worker.Status) bool {
	return status == worker.Done || status == worker.Failed || status == worker.Cancelled
}

func runHeadless(ctx context.Context, snapshot config.RunSnapshot) error {
	keys := make(chan string)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var result error
	for i := 0; i < min(max(1, snapshot.Concurrency), len(snapshot.Models)); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for key := range keys {
				if ctx.Err() != nil {
					continue
				}
				launch, err := reserveQueued(ctx, snapshot.RunDir, key)
				if err == nil && launch {
					err = runChild(ctx, snapshot.RunDir, key)
				}
				if ctx.Err() != nil {
					err = cancelState(snapshot.RunDir, key)
				} else if err != nil {
					err = worker.MarkFailed(snapshot.RunDir, key, "worker process exited before terminal state: "+err.Error())
				}
				if err != nil {
					mu.Lock()
					result = errors.Join(result, err)
					mu.Unlock()
				}
			}
		}()
	}
send:
	for _, key := range config.SortedKeys(snapshot.Models) {
		select {
		case <-ctx.Done():
			break send
		case keys <- key:
		}
	}
	close(keys)
	wg.Wait()
	if ctx.Err() != nil {
		for _, key := range config.SortedKeys(snapshot.Models) {
			result = errors.Join(result, cancelState(snapshot.RunDir, key))
		}
		return errors.Join(context.Canceled, ctx.Err(), result)
	}
	return result
}

func reserveQueued(ctx context.Context, runDir, key string) (bool, error) {
	unlock, err := transitionLock(ctx, runDir, key)
	if err != nil {
		return false, err
	}
	defer unlock()
	if modelDeleted(runDir, key) {
		return false, nil
	}
	state, err := worker.LoadState(runDir, key)
	if err != nil {
		return false, err
	}
	if state.Status != worker.Queued {
		return false, nil
	}
	lifetime, err := persistence.TryLock(worker.LifetimeLockPath(runDir, key))
	if errors.Is(err, persistence.ErrLocked) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer lifetime()
	if err := clearCancel(runDir, key); err != nil {
		return false, err
	}
	state.Status = worker.Running
	now := time.Now().UTC().Format(time.RFC3339Nano)
	state.StartedAt = &now
	return true, worker.SaveState(runDir, key, state)
}

func runHeadful(ctx context.Context, snapshot *config.RunSnapshot) error {
	keys := config.SortedKeys(snapshot.Models)
	launched := make(map[string]bool)
	defer func() {
		if ctx.Err() != nil {
			stopHeadfulWorkers(context.WithoutCancel(ctx), snapshot.RunDir, keys)
		}
	}()
	for {
		if ctx.Err() != nil {
			return errors.Join(context.Canceled, ctx.Err())
		}
		active, complete := 0, 0
		for _, key := range keys {
			if modelDeleted(snapshot.RunDir, key) {
				complete++
				continue
			}
			state, err := worker.LoadState(snapshot.RunDir, key)
			if err != nil {
				return err
			}
			if terminal(state.Status) {
				complete++
				continue
			}
			if launched[key] || state.Status == worker.Running {
				active++
			}
		}
		if complete == len(keys) {
			return nil
		}
		for _, key := range keys {
			if active >= max(1, snapshot.Concurrency) {
				break
			}
			if launched[key] || modelDeleted(snapshot.RunDir, key) {
				continue
			}
			launch, err := reserveQueued(ctx, snapshot.RunDir, key)
			if err != nil {
				return err
			}
			if !launch {
				continue
			}
			launched[key] = true
			active++
			// Dispatch owns the run/model transition locks itself.
			if err := dispatchHerdr(ctx, snapshot, key, "worker", ""); err != nil {
				return err
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func stopHeadfulWorkers(ctx context.Context, runDir string, keys []string) {
	interruptCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	for _, key := range keys {
		if state, err := worker.LoadState(runDir, key); err == nil && state.Status == worker.Running {
			_ = StopModel(interruptCtx, runDir, key)
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		active := false
		for _, key := range keys {
			guard, err := persistence.TryLock(worker.LifetimeLockPath(runDir, key))
			if err == nil {
				guard()
				continue
			}
			if !errors.Is(err, persistence.ErrLocked) {
				continue
			}
			active = true
			if time.Now().After(deadline) {
				_ = killWorkers(runDir, key)
			}
		}
		if !active || time.Now().After(deadline.Add(time.Second)) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	for _, key := range keys {
		_ = cancelState(runDir, key)
	}
}

func dispatchHerdr(ctx context.Context, snapshot *config.RunSnapshot, key, subcommand, message string) error {
	// Herdr owns RunLockPath internally. A separate metadata gate lets us reload
	// its snapshot without racing deletion/repricing, without nesting that lock.
	unlock, err := persistence.Lock(ctx, worker.RunLockPath(snapshot.RunDir)+".dispatch")
	if err != nil {
		return err
	}
	defer unlock()
	if key != "" && modelDeleted(snapshot.RunDir, key) {
		return nil
	}
	latest, err := loadSnapshot(snapshot.RunDir)
	if err != nil {
		return err
	}
	*snapshot = latest
	if key == "" {
		return herdr.CreateTabs(ctx, snapshot)
	}
	return herdr.Dispatch(ctx, snapshot, key, subcommand, message)
}

func runChild(ctx context.Context, runDir, key string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	cmd := exec.Command(exe, "worker", "--run", runDir, "--model", key)
	configureChild(cmd)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		// Workers own process groups for agent commands. Give their signal
		// handler time to cancel those groups and persist native metrics.
		_ = requestCancel(context.WithoutCancel(ctx), runDir, key)
		interruptChild(cmd.Process)
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			interruptChild(cmd.Process)
			select {
			case <-done:
			case <-time.After(time.Second):
				killChildTree(cmd.Process)
				<-done
			}
		}
		return errors.Join(context.Canceled, ctx.Err())
	}
}

func transitionLock(ctx context.Context, runDir, key string) (func(), error) {
	runUnlock, err := persistence.Lock(ctx, worker.RunLockPath(runDir))
	if err != nil {
		return nil, err
	}
	modelUnlock, err := persistence.Lock(ctx, worker.ModelLockPath(runDir, key))
	if err != nil {
		runUnlock()
		return nil, err
	}
	return func() { modelUnlock(); runUnlock() }, nil
}

func clearCancel(runDir, key string) error {
	err := os.Remove(worker.CancelPath(runDir, key))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func requestCancel(ctx context.Context, runDir, key string) error {
	unlock, err := transitionLock(ctx, runDir, key)
	if err != nil {
		return err
	}
	defer unlock()
	if modelDeleted(runDir, key) {
		return nil
	}
	return persistence.WriteFile(worker.CancelPath(runDir, key), []byte("cancel requested\n"), 0600)
}

func cancelState(runDir, key string) error {
	unlock, err := transitionLock(context.Background(), runDir, key)
	if err != nil {
		return err
	}
	defer unlock()
	if modelDeleted(runDir, key) {
		return nil
	}
	state, err := worker.LoadState(runDir, key)
	if err != nil {
		return err
	}
	if terminal(state.Status) {
		return nil
	}
	state.Status = worker.Cancelled
	now, message := time.Now().UTC().Format(time.RFC3339Nano), "run orchestrator cancelled"
	state.FinishedAt, state.Error = &now, &message
	return worker.SaveState(runDir, key, state)
}

func childFailure(runDir, key string, err error) error {
	if err == nil {
		return nil
	}
	return errors.Join(err, worker.MarkFailed(runDir, key, fmt.Sprintf("model dispatch failed: %v", err)))
}
