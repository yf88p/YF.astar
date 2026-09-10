//go:build !unix

package tui

import "os/exec"

func detachProcess(cmd *exec.Cmd) {}
