//go:build !linux && !darwin

package terminal

import (
	"errors"
	"os"
)

// IsTerminal conservatively returns false on unsupported platforms.
func IsTerminal(_ *os.File) bool { return false }

// Size returns the fallback dimensions on unsupported platforms.
func Size(_ *os.File) (width, height int) { return defaultWidth, defaultHeight }

// Raw is unavailable on this platform; noninteractive commands remain usable.
func Raw(_ *os.File) (restore func() error, err error) {
	return nil, errors.New("terminal raw mode is unsupported on this platform (TUI unavailable)")
}
