//go:build !linux

package executor

func descendants(parent int) []int              { return nil }
func terminateWorkers(runDir, key string) error { return nil }
func killWorkers(runDir, key string) error      { return nil }
