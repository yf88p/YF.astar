package executor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/util"
	"automator/internal/worker"
)

// Configured parents are trusted and may use platform aliases such as /var on
// macOS. Resolve their existing prefix, retaining not-yet-created suffixes.
func canonicalPath(path string) (string, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(path); err == nil {
		return filepath.EvalSymlinks(path)
	} else if !errors.Is(err, os.ErrNotExist) || filepath.Dir(path) == path {
		return "", err
	}
	parent, err := canonicalPath(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	return filepath.Join(parent, filepath.Base(path)), nil
}

// Resolve only the parent of a run/model target: the target itself must never
// be a symlink, including a dangling one or one with a trailing slash.
func canonicalTarget(path string) (string, error) {
	path = filepath.Clean(path)
	parent, err := canonicalPath(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	path = filepath.Join(parent, filepath.Base(path))
	return path, rejectSymlinks(parent, path)
}

// Symlink rejection starts below the trusted parent, not at the filesystem
// root. In particular .automator, model directories and index files stay guarded.
func rejectSymlinks(root, path string) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("path escapes trusted parent: %s", path)
	}
	current, err := canonicalPath(root)
	if err != nil {
		return err
	}
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing symlink path: %s", current)
		}
	}
	return nil
}

func loadSnapshot(runDir string) (config.RunSnapshot, error) {
	return checkedSnapshot(runDir, false)
}

func checkedSnapshot(runDir string, deleting bool) (config.RunSnapshot, error) {
	var snapshot config.RunSnapshot
	if runDir == "" {
		return snapshot, errors.New("run directory is empty")
	}
	canonical, err := canonicalTarget(runDir)
	if err != nil {
		return snapshot, err
	}
	info, err := os.Lstat(canonical)
	if err != nil {
		return snapshot, err
	}
	if !info.IsDir() {
		return snapshot, errors.New("refusing a non-directory run path")
	}
	if err := rejectSymlinks(filepath.Dir(canonical), filepath.Join(filepath.Dir(canonical), ".automator-locks")); err != nil {
		return snapshot, err
	}
	for _, path := range []string{filepath.Join(canonical, "run.yaml"), filepath.Join(canonical, ".automator", "state"), filepath.Join(canonical, ".automator", "deleted"), filepath.Join(canonical, ".automator", "cancel"), filepath.Join(canonical, ".automator", "retry-backups")} {
		if err := rejectSymlinks(canonical, path); err != nil {
			return snapshot, err
		}
	}
	if err := persistence.LoadYAML(filepath.Join(canonical, "run.yaml"), &snapshot); err != nil {
		return snapshot, err
	}
	if snapshot.SchemaVersion != 1 {
		return snapshot, fmt.Errorf("unsupported run schema_version: %d", snapshot.SchemaVersion)
	}
	if snapshot.RunDir == "" {
		return snapshot, errors.New("run snapshot path is empty")
	}
	// Rust snapshots can retain paths relative to the original invoking cwd.
	// Actions use the supplied directory; deletion must still verify the record.
	if deleting || filepath.IsAbs(snapshot.RunDir) {
		stored, err := canonicalTarget(snapshot.RunDir)
		if err != nil {
			return snapshot, err
		}
		if canonical != stored {
			return snapshot, errors.New("run snapshot path does not match indexed directory")
		}
	}
	for _, key := range config.SortedKeys(snapshot.Models) {
		if err := checkKey(key); err != nil {
			return snapshot, err
		}
		for _, path := range []string{worker.StatePath(canonical, key), filepath.Join(canonical, key), worker.CancelPath(canonical, key), filepath.Join(canonical, ".automator", "deleted", key)} {
			if err := rejectSymlinks(canonical, path); err != nil {
				return snapshot, err
			}
		}
		if info, err := os.Lstat(filepath.Join(canonical, key)); err == nil && !info.IsDir() {
			return snapshot, fmt.Errorf("refusing a non-directory model path: %s", key)
		} else if err != nil && !errors.Is(err, os.ErrNotExist) {
			return snapshot, err
		}
		state, err := worker.LoadState(canonical, key)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return snapshot, err
		}
		if err == nil {
			if err := checkStatePath(canonical, key, &state); err != nil {
				return snapshot, err
			}
		}
	}
	snapshot.RunDir = canonical
	if deleting {
		if err := checkDeletionRoot(snapshot); err != nil {
			return snapshot, err
		}
	}
	return snapshot, nil
}

func checkStatePath(runDir, key string, state *worker.State) error {
	if state.ProjectPath == "" {
		return fmt.Errorf("model %s project path is empty", key)
	}
	path, err := canonicalTarget(state.ProjectPath)
	expected := filepath.Join(runDir, key)
	if err == nil && path == expected {
		state.ProjectPath = expected
		return nil
	}
	if !filepath.IsAbs(state.ProjectPath) {
		var snapshot config.RunSnapshot
		if err := persistence.LoadYAML(filepath.Join(runDir, "run.yaml"), &snapshot); err != nil {
			return err
		}
		if !filepath.IsAbs(snapshot.RunDir) && filepath.Clean(state.ProjectPath) == filepath.Join(snapshot.RunDir, key) {
			if err := rejectSymlinks(runDir, expected); err != nil {
				return err
			}
			state.ProjectPath = expected
			return nil
		}
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("model %s project path escapes its run directory", key)
}

// Root is informational for start/continue (a relative root may no longer be
// relative to the invoking cwd), but deletion still requires proof of containment.
func checkDeletionRoot(snapshot config.RunSnapshot) error {
	root, err := canonicalPath(util.ExpandPath(snapshot.Root))
	if err != nil {
		return err
	}
	if snapshot.Root == "" || root != filepath.Dir(snapshot.RunDir) || snapshot.RunDir == filepath.Dir(snapshot.RunDir) {
		return errors.New("run snapshot root does not contain the run directory")
	}
	return nil
}

// DeleteModel tombstones an inactive model before removing its files. Deleting
// the last model also removes the run and its index entries.
func DeleteModel(ctx context.Context, runDir, key string) error {
	if err := checkKey(key); err != nil {
		return err
	}
	return deleteTarget(ctx, runDir, key)
}

// DeleteRun rejects active workers and unsafe/unindexed paths. Persistent locks
// and an external tombstone prevent queued processes from resurrecting the run.
func DeleteRun(ctx context.Context, runDir string) error {
	return deleteTarget(ctx, runDir, "")
}

func deleteTarget(ctx context.Context, runDir, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	// All unsafe path checks precede even lock-directory creation.
	snapshot, err := checkedSnapshot(runDir, true)
	if err != nil {
		return err
	}
	runDir = snapshot.RunDir
	for _, path := range []string{indexLockPath(), filepath.Join(config.HomeDir(), "runs-index.yaml")} {
		if err := rejectSymlinks(config.HomeDir(), path); err != nil {
			return err
		}
	}
	metadataUnlock, err := persistence.Lock(ctx, worker.RunLockPath(runDir)+".dispatch")
	if err != nil {
		return err
	}
	defer metadataUnlock()
	indexUnlock, err := persistence.Lock(ctx, indexLockPath())
	if err != nil {
		return err
	}
	defer indexUnlock()
	var index config.RunsIndex
	if err := loadRegistry("runs-index.yaml", &index, &index.SchemaVersion); err != nil {
		return err
	}
	indexed := func(path string) bool {
		abs, err := canonicalTarget(path)
		return err == nil && abs == runDir
	}
	found := false
	for _, entry := range index.Runs {
		if indexed(entry.Path) {
			found = true
			break
		}
	}
	if !found {
		return errors.New("run is no longer present in runs-index.yaml")
	}
	err = func() error {
		unlock, err := persistence.Lock(ctx, worker.RunLockPath(runDir))
		if err != nil {
			return err
		}
		defer unlock()
		snapshot, err = checkedSnapshot(runDir, true)
		if err != nil {
			return err
		}
		if key != "" {
			if _, ok := snapshot.Models[key]; !ok {
				return fmt.Errorf("model %s missing from run snapshot", key)
			}
		}
		removeRun := key == "" || len(snapshot.Models) == 1
		keys := []string{key}
		if removeRun {
			all := make(map[string]bool)
			for key := range snapshot.Models {
				all[key] = true
			}
			entries, err := os.ReadDir(filepath.Join(runDir, ".automator", "state"))
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			for _, entry := range entries {
				if filepath.Ext(entry.Name()) == ".yaml" {
					all[strings.TrimSuffix(entry.Name(), ".yaml")] = true
				}
			}
			keys = config.SortedKeys(all)
		}
		var guards []func()
		defer func() {
			for i := len(guards) - 1; i >= 0; i-- {
				guards[i]()
			}
		}()
		for _, modelKey := range keys {
			if err := checkKey(modelKey); err != nil {
				return err
			}
			if err := rejectSymlinks(runDir, worker.StatePath(runDir, modelKey)); err != nil {
				return err
			}
			// Never wait on a lifetime lock while holding the run lock: that
			// worker may be waiting for this very run lock to enter Running.
			guard, err := persistence.TryLock(worker.LifetimeLockPath(runDir, modelKey))
			if errors.Is(err, persistence.ErrLocked) {
				return fmt.Errorf("model %s has an active worker and cannot be deleted", modelKey)
			}
			if err != nil {
				return err
			}
			guards = append(guards, guard)
			guard, err = persistence.Lock(ctx, worker.ModelLockPath(runDir, modelKey))
			if err != nil {
				return err
			}
			guards = append(guards, guard)
			state, err := worker.LoadState(runDir, modelKey)
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if err == nil {
				if state.Status == worker.Running {
					return fmt.Errorf("model %s became running and cannot be deleted", modelKey)
				}
				if err := checkStatePath(runDir, modelKey, &state); err != nil {
					return err
				}
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		for _, modelKey := range keys {
			if err := persistence.WriteFile(filepath.Join(runDir, ".automator", "deleted", modelKey), []byte("deleted by user\n"), 0600); err != nil {
				return err
			}
		}
		if removeRun {
			// Retain an external tombstone so allocation cannot reuse this path
			// while an old queued process still carries its run/model argv.
			if err := persistence.WriteFile(worker.RunLockPath(runDir)+".deleted", []byte("deleted by user\n"), 0600); err != nil {
				return err
			}
			if err := os.RemoveAll(runDir); err != nil {
				return fmt.Errorf("delete run files: %w", err)
			}
			kept := index.Runs[:0]
			for _, entry := range index.Runs {
				if !indexed(entry.Path) {
					kept = append(kept, entry)
				}
			}
			index.Runs = kept
			return config.SaveRunsIndex(index)
		}
		if err := os.RemoveAll(filepath.Join(runDir, key)); err != nil {
			return err
		}
		if err := os.Remove(worker.StatePath(runDir, key)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		delete(snapshot.Models, key)
		return persistence.SaveYAML(filepath.Join(runDir, "run.yaml"), snapshot)
	}()
	indexUnlock()
	if err != nil {
		return err
	}
	return refreshReport(runDir)
}
