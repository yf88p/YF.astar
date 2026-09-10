//go:build !unix

package executor

import (
	"os"
	"os/exec"
)

func configureChild(cmd *exec.Cmd)       {}
func interruptChild(process *os.Process) { _ = process.Kill() }
func killChildTree(process *os.Process)  { _ = process.Kill() }
