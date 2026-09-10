//go:build windows

package store

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"time"
)

const (
	errorSharingViolation syscall.Errno = 32
	errorLockViolation    syscall.Errno = 33
)

func acquireLock(path string, timeout time.Duration) (*os.File, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, fmt.Errorf("resolve store lock %q: %w", path, err)
	}
	deadline := time.Now().Add(timeout)
	for {
		// A zero sharing mode is an OS-enforced exclusive lock for this handle's
		// lifetime. OPEN_REPARSE_POINT avoids following a lock-file symlink.
		h, err := syscall.CreateFile(name, syscall.GENERIC_READ|syscall.GENERIC_WRITE,
			0, nil, syscall.OPEN_ALWAYS, syscall.FILE_FLAG_OPEN_REPARSE_POINT, 0)
		if err == nil {
			var info syscall.ByHandleFileInformation
			if err := syscall.GetFileInformationByHandle(h, &info); err != nil {
				syscall.CloseHandle(h)
				return nil, fmt.Errorf("stat store lock %q: %w", path, err)
			}
			if info.FileAttributes&(syscall.FILE_ATTRIBUTE_REPARSE_POINT|syscall.FILE_ATTRIBUTE_DIRECTORY) != 0 {
				syscall.CloseHandle(h)
				return nil, fmt.Errorf("store lock %q is not a regular non-symlink file", path)
			}
			return os.NewFile(uintptr(h), path), nil
		}
		if !errors.Is(err, errorSharingViolation) && !errors.Is(err, errorLockViolation) {
			return nil, fmt.Errorf("open store lock %q: %w", path, err)
		}
		if err := waitForLock(path, deadline, timeout); err != nil {
			return nil, err
		}
	}
}

func openBoard(path string) (*os.File, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	// FILE_SHARE_DELETE lets an atomic replacement coexist with an old reader.
	h, err := syscall.CreateFile(name, syscall.GENERIC_READ,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE|syscall.FILE_SHARE_DELETE,
		nil, syscall.OPEN_EXISTING, syscall.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	var info syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(h, &info); err != nil {
		syscall.CloseHandle(h)
		return nil, err
	}
	if info.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		syscall.CloseHandle(h)
		return nil, fmt.Errorf("store %q: symbolic link destination is not allowed", path)
	}
	return os.NewFile(uintptr(h), path), nil
}

func syncDirectory(string) error {
	// Go's portable Windows file API cannot flush directory handles.
	return nil
}
