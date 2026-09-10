// Package process starts commands whose descendants are stopped on cancellation.
package process

import (
	"context"
	"os/exec"
)

// CommandContext is exec.CommandContext with process-tree cancellation. It does
// not impose a timeout. Callers retain control of streams, environment and cwd.
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	configure(cmd)
	return cmd
}
