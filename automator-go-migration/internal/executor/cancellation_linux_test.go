//go:build linux

package executor

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/worker"
)

func processAlive(pid int) bool {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return false
	}
	end := strings.LastIndex(string(data), ")")
	return end >= 0 && !strings.HasPrefix(string(data[end+1:]), " Z")
}

func TestOrchestratorCancellationStopsWorkerTrees(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("block", "queued")
	draft.Concurrency = 1
	draft.PostAll = []config.ShellStep{{Shell: "printf unexpected > post-all"}}
	f.saveDraft(draft)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- RunDraft(ctx, "example", config.ModelSelection{Models: []string{"block", "queued"}}) }()
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "descendant.pid")) })
	pid, err := strconv.Atoi(readText(t, filepath.Join(f.events, "descendant.pid")))
	must(t, err)
	if !processAlive(pid) {
		t.Fatal("fixture descendant not alive")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("orchestrator must map to CLI 130, got %v", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("cancellation hung")
	}
	waitFor(t, func() bool { return !processAlive(pid) })
	for _, key := range []string{"block", "queued"} {
		state, err := worker.LoadState(f.runDir(), key)
		must(t, err)
		if state.Status != worker.Cancelled {
			t.Errorf("%s remained %s", key, state.Status)
		}
	}
	if exists(filepath.Join(f.events, "queued.start")) || exists(filepath.Join(f.runDir(), "post-all")) {
		t.Fatal("cancelled orchestrator launched queued model or post_all")
	}
}

func TestStopIsolatedModelAndLifetimeDuplicateLock(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("block", "other")
	f.saveDraft(draft)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- RunDraft(ctx, "example", config.ModelSelection{Models: []string{"block", "other"}}) }()
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "descendant.pid")) })
	pid, err := strconv.Atoi(readText(t, filepath.Join(f.events, "descendant.pid")))
	must(t, err)
	if err := worker.Run(context.Background(), f.runDir(), "block"); !errors.Is(err, worker.ErrAlreadyRunning) {
		t.Fatalf("duplicate worker not lifetime guarded: %v", err)
	}
	must(t, worker.MarkFailed(f.runDir(), "block", "duplicate failure"))
	state, err := worker.LoadState(f.runDir(), "block")
	must(t, err)
	if state.Status != worker.Running {
		t.Fatal("duplicate failure overwrote active worker")
	}
	if err := RetryModel(context.Background(), f.runDir(), "block", true); err == nil {
		t.Fatal("retry moved active project")
	}
	must(t, StopModel(context.Background(), f.runDir(), "block"))
	select {
	case err := <-done:
		must(t, err)
	case <-time.After(8 * time.Second):
		t.Fatal("stop hung")
	}
	waitFor(t, func() bool { return !processAlive(pid) })
	state, err = worker.LoadState(f.runDir(), "block")
	must(t, err)
	if state.Status != worker.Cancelled {
		t.Fatal(state.Status)
	}
	state, err = worker.LoadState(f.runDir(), "other")
	must(t, err)
	if state.Status != worker.Done {
		t.Fatal("one model stop cancelled independent model")
	}
	if err := StopModel(context.Background(), f.runDir(), "other"); err == nil {
		t.Fatal("stopped terminal model")
	}
}

func TestQueuedWorkerWaitingOnRunLockCannotBeDeleted(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("model")
	draft.Heavy = true
	f.saveDraft(draft)
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"model"}}))
	runUnlock, err := persistence.Lock(context.Background(), worker.RunLockPath(f.runDir()))
	must(t, err)
	exe, err := os.Executable()
	must(t, err)
	cmd := exec.Command(exe, "worker", "--run", f.runDir(), "--model", "model")
	must(t, cmd.Start())
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	waitFor(t, func() bool {
		guard, err := persistence.TryLock(worker.LifetimeLockPath(f.runDir(), "model"))
		if err == nil {
			guard()
			return false
		}
		return errors.Is(err, persistence.ErrLocked)
	})
	runUnlock()
	if err := DeleteRun(context.Background(), f.runDir()); err == nil {
		t.Fatal("deleted worker already holding lifetime guard")
	}
	select {
	case err := <-done:
		must(t, err)
	case <-time.After(8 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("worker deadlocked")
	}
	must(t, DeleteRun(context.Background(), f.runDir()))
}

func TestHeadfulCancellationStopsWorkers(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("block")
	draft.Mode = config.Headful
	f.saveDraft(draft)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- RunDraft(ctx, "example", config.ModelSelection{Models: []string{"block"}}) }()
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "descendant.pid")) })
	pid, err := strconv.Atoi(readText(t, filepath.Join(f.events, "descendant.pid")))
	must(t, err)
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("headful cancellation hung")
	}
	waitFor(t, func() bool { return !processAlive(pid) })
	waitState(t, f.runDir(), "block", worker.Cancelled)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
}

func TestCancellationForcesUncooperativeWorkerTree(t *testing.T) {
	f := newFixture(t)
	f.draft("stubborn")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- RunDraft(ctx, "example", config.ModelSelection{Models: []string{"stubborn"}}) }()
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "descendant.pid")) })
	pid, err := strconv.Atoi(readText(t, filepath.Join(f.events, "descendant.pid")))
	must(t, err)
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("force cancellation hung")
	}
	if processAlive(pid) {
		t.Fatal("forced cancellation left descendant alive")
	}
	waitState(t, f.runDir(), "stubborn", worker.Cancelled)
}

func TestCancellationDuringHerdrDispatchStopsEarlierWorkers(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("block", "two")
	draft.Mode, draft.Heavy = config.Headful, true
	f.saveDraft(draft)
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"block", "two"}}))
	must(t, StartModel(context.Background(), f.runDir(), "block", false))
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "descendant.pid")) })
	state, err := worker.LoadState(f.runDir(), "two")
	must(t, err)
	state.Status = worker.Queued
	must(t, worker.SaveState(f.runDir(), "two", state))
	snapshot, err := loadSnapshot(f.runDir())
	must(t, err)
	t.Setenv("EXECUTOR_TEST_HERDR_BLOCK_KEY", "two")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- runHeadful(ctx, &snapshot) }()
	waitFor(t, func() bool {
		return exists(filepath.Join(f.events, "descendant.pid")) && exists(filepath.Join(f.events, "herdr-blocked"))
	})
	pid, err := strconv.Atoi(readText(t, filepath.Join(f.events, "descendant.pid")))
	must(t, err)
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("dispatch cancellation hung")
	}
	if processAlive(pid) {
		t.Fatal("cancelled dispatch left earlier worker descendant alive")
	}
	waitState(t, f.runDir(), "block", worker.Cancelled)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
}
