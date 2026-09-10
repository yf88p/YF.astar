//go:build !windows

package persistence

import (
	"fmt"
	"os"
	"path/filepath"
)

func replaceFile(tmp, path string) error {
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("atomic rename %s: %w", path, err)
	}
	dir := filepath.Dir(path)
	d, err := os.Open(dir)
	if err != nil {
		return fmt.Errorf("open directory %s: %w", dir, err)
	}
	defer d.Close()
	if err := d.Sync(); err != nil {
		return fmt.Errorf("sync directory %s: %w", dir, err)
	}
	return nil
}
