//go:build unix

package executor

import (
	"os"
	"os/exec"
	"syscall"
)

func configureChild(cmd *exec.Cmd)       { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func interruptChild(process *os.Process) { _ = process.Signal(syscall.SIGTERM) }
func killChildTree(process *os.Process) {
	for _, pid := range descendants(process.Pid) {
		_ = syscall.Kill(pid, syscall.SIGKILL)
	}
	_ = syscall.Kill(-process.Pid, syscall.SIGKILL)
	_ = process.Kill()
}
