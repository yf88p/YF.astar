//go:build linux

package executor

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func descendants(parent int) []int {
	entries, _ := os.ReadDir("/proc")
	children := map[int][]int{}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		data, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if err != nil {
			continue
		}
		end := strings.LastIndex(string(data), ")")
		if end < 0 {
			continue
		}
		fields := strings.Fields(string(data[end+1:]))
		if len(fields) < 2 {
			continue
		}
		ppid, err := strconv.Atoi(fields[1])
		if err == nil {
			children[ppid] = append(children[ppid], pid)
		}
	}
	queue := []int{parent}
	for i := 0; i < len(queue); i++ {
		queue = append(queue, children[queue[i]]...)
	}
	return queue[1:]
}

func terminateWorkers(runDir, key string) error {
	return signalWorkers(runDir, key, false)
}

func killWorkers(runDir, key string) error {
	return signalWorkers(runDir, key, true)
}

func signalWorkers(runDir, key string, force bool) error {
	canonical, err := filepath.EvalSymlinks(runDir)
	if err != nil {
		return err
	}
	canonical, err = filepath.Abs(canonical)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid == os.Getpid() {
			continue
		}
		data, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "cmdline"))
		if err != nil {
			continue
		}
		args := strings.Split(strings.TrimSuffix(string(data), "\x00"), "\x00")
		isWorker, run, model := false, "", ""
		for i, arg := range args {
			if arg == "worker" || arg == "continue-worker" {
				isWorker = true
			}
			if i+1 < len(args) {
				if arg == "--run" {
					run = args[i+1]
				}
				if arg == "--model" {
					model = args[i+1]
				}
			}
		}
		if !isWorker || model != key || run == "" {
			continue
		}
		path, err := filepath.EvalSymlinks(run)
		if err != nil {
			continue
		}
		path, err = filepath.Abs(path)
		if err == nil && path == canonical {
			if force {
				for _, child := range descendants(pid) {
					_ = syscall.Kill(child, syscall.SIGKILL)
				}
				_ = syscall.Kill(pid, syscall.SIGKILL)
			} else {
				_ = syscall.Kill(pid, syscall.SIGTERM)
			}
		}
	}
	return nil
}
