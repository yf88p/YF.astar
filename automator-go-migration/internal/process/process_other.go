//go:build !unix && !windows

package process

import (
	"errors"
	"os/exec"
)

func configure(cmd *exec.Cmd) {}

func ExitWasCancelled(err error) bool {
	var exit *exec.ExitError
	return errors.As(err, &exit) && (exit.ExitCode() == 130 || exit.ExitCode() == 143)
}
