package worker

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"automator/internal/adapter"
	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/util"
)

// The supplied run root is trusted and may have symlink ancestors (for example
// macOS /var). Below its canonical location, control paths must not be links.
func checkedRunDir(runDir, key string) (string, error) {
	if err := validateKey(key); err != nil {
		return "", err
	}
	canonical, err := filepath.EvalSymlinks(runDir)
	if err != nil {
		return "", fmt.Errorf("run directory no longer exists: %w", err)
	}
	canonical, err = filepath.Abs(canonical)
	if err != nil {
		return "", err
	}
	for _, path := range []struct {
		name string
		dir  bool
	}{
		{canonical, true},
		{filepath.Join(canonical, ".automator"), true},
		{filepath.Join(canonical, ".automator", "state"), true},
		{filepath.Join(canonical, ".automator", "cancel"), true},
		{filepath.Join(canonical, ".automator", "deleted"), true},
		{filepath.Join(canonical, ".automator", "retry-backups"), true},
		{filepath.Join(canonical, key), true},
		{filepath.Join(filepath.Dir(canonical), ".automator-locks"), true},
		{filepath.Join(canonical, "run.yaml"), false},
		{filepath.Join(canonical, "prompt.md"), false},
		{StatePath(canonical, key), false},
		{CancelPath(canonical, key), false},
		{filepath.Join(canonical, ".automator", "deleted", key), false},
		{RunLockPath(canonical), false},
		{ModelLockPath(canonical, key), false},
		{LifetimeLockPath(canonical, key), false},
	} {
		info, err := os.Lstat(path.name)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("refusing symlink path: %s", path.name)
		}
		if path.dir && !info.IsDir() || !path.dir && !info.Mode().IsRegular() {
			return "", fmt.Errorf("unexpected file type at worker path: %s", path.name)
		}
	}
	gitPath := filepath.Join(canonical, key, ".git")
	if info, err := os.Lstat(gitPath); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("refusing symlink path: %s", gitPath)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return canonical, nil
}

func readSnapshot(runDir, key string) (config.RunSnapshot, error) {
	var snapshot config.RunSnapshot
	if _, err := checkedRunDir(runDir, key); err != nil {
		return snapshot, err
	}
	if err := persistence.LoadYAML(filepath.Join(runDir, "run.yaml"), &snapshot); err != nil {
		return snapshot, err
	}
	if snapshot.SchemaVersion != 1 {
		return snapshot, fmt.Errorf("unsupported run schema_version: %d", snapshot.SchemaVersion)
	}
	for _, modelKey := range config.SortedKeys(snapshot.Models) {
		if err := validateKey(modelKey); err != nil {
			return snapshot, err
		}
		if err := adapter.ValidateModel(modelKey, snapshot.Models[modelKey]); err != nil {
			return snapshot, err
		}
	}
	if _, ok := snapshot.Models[key]; !ok {
		return snapshot, fmt.Errorf("model %s missing from run snapshot", key)
	}
	return snapshot, nil
}

// Keep errors.Is/As behavior while preventing CLI callers from logging raw
// shell assignments contained in error messages.
type redactedError struct{ error }

func (err redactedError) Error() string { return util.RedactSecrets(err.error.Error()) }
func (err redactedError) Unwrap() error { return err.error }
