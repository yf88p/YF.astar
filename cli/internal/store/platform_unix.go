//go:build linux || darwin

package store

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"time"
)

func acquireLock(path string, timeout time.Duration) (*os.File, error) {
	fd, err := syscall.Open(path, syscall.O_CREAT|syscall.O_RDWR|syscall.O_CLOEXEC|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return nil, fmt.Errorf("open store lock %q: %w", path, err)
	}
	f := os.NewFile(uintptr(fd), path)
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("stat store lock %q: %w", path, err)
		}
		return nil, fmt.Errorf("store lock %q is not a regular file", path)
	}
	deadline := time.Now().Add(timeout)
	for {
		err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			return f, nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) && !errors.Is(err, syscall.EINTR) {
			f.Close()
			return nil, fmt.Errorf("lock store %q: %w", path, err)
		}
		if err := waitForLock(path, deadline, timeout); err != nil {
			f.Close()
			return nil, err
		}
	}
}

func openBoard(path string) (*os.File, error) {
	// NONBLOCK prevents a substituted FIFO from hanging the subsequent Stat.
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), path), nil
}

func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	syncErr := f.Sync()
	closeErr := f.Close()
	// Some filesystems do not implement fsync on directories.
	if errors.Is(syncErr, syscall.EINVAL) || errors.Is(syncErr, syscall.ENOTSUP) {
		syncErr = nil
	}
	return errors.Join(syncErr, closeErr)
}
