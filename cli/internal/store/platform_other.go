//go:build !linux && !darwin && !windows

package store

import (
	"fmt"
	"os"
	"runtime"
	"time"
)

func acquireLock(path string, _ time.Duration) (*os.File, error) {
	return nil, fmt.Errorf("store lock %q: safe advisory locking is not supported on %s", path, runtime.GOOS)
}

func openBoard(path string) (*os.File, error) {
	return os.Open(path)
}

func syncDirectory(string) error {
	return nil
}
