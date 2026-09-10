//go:build linux || darwin

package terminal

import (
	"fmt"
	"os"
	"sync"
	"syscall"
	"unsafe"
)

func ioctl(file *os.File, request uintptr, data unsafe.Pointer) error {
	if file == nil {
		return os.ErrInvalid
	}
	conn, err := file.SyscallConn()
	if err != nil {
		return err
	}
	// Control holds the descriptor open and, unlike Fd, preserves nonblocking mode.
	var callErr error
	if err := conn.Control(func(fd uintptr) {
		_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, request, uintptr(data))
		if errno != 0 {
			callErr = errno
		}
	}); err != nil {
		return err
	}
	return callErr
}

// IsTerminal reports whether file supports terminal attributes, not merely
// whether it is a character device. Nil, closed files and redirections are false.
func IsTerminal(file *os.File) bool {
	var state syscall.Termios
	return ioctl(file, getTermios, unsafe.Pointer(&state)) == nil
}

type windowSize struct {
	rows, columns, xpixel, ypixel uint16
}

// Size returns the terminal's dimensions, or 80 by 24 if unavailable or zero.
func Size(file *os.File) (width, height int) {
	var size windowSize
	if ioctl(file, syscall.TIOCGWINSZ, unsafe.Pointer(&size)) != nil || size.columns == 0 || size.rows == 0 {
		return defaultWidth, defaultHeight
	}
	return int(size.columns), int(size.rows)
}

// Raw enables unbuffered, unechoed single-key input and disables output
// postprocessing. ISIG stays enabled so Ctrl-C is handled by the caller's signal
// handler. The caller must restore before closing file, including on interrupts.
// The restore function is concurrency-safe and idempotent, including its error.
func Raw(file *os.File) (restore func() error, err error) {
	var original syscall.Termios
	if err := ioctl(file, getTermios, unsafe.Pointer(&original)); err != nil {
		return nil, fmt.Errorf("terminal raw mode: %w", err)
	}
	state := original
	state.Iflag &^= syscall.IGNBRK | syscall.BRKINT | syscall.PARMRK | syscall.ISTRIP |
		syscall.INLCR | syscall.IGNCR | syscall.ICRNL | syscall.IXON | syscall.IXOFF | syscall.IXANY
	state.Oflag &^= syscall.OPOST
	state.Lflag &^= syscall.ECHO | syscall.ECHONL | syscall.ICANON | syscall.IEXTEN
	state.Lflag |= syscall.ISIG
	state.Cflag &^= syscall.CSIZE | syscall.PARENB
	state.Cflag |= syscall.CS8
	state.Cc[syscall.VMIN] = 1
	state.Cc[syscall.VTIME] = 0
	if err := ioctl(file, setTermios, unsafe.Pointer(&state)); err != nil {
		return nil, fmt.Errorf("terminal raw mode: %w", err)
	}
	var once sync.Once
	var restoreErr error
	return func() error {
		once.Do(func() {
			if err := ioctl(file, setTermios, unsafe.Pointer(&original)); err != nil {
				restoreErr = fmt.Errorf("restore terminal: %w", err)
			}
		})
		return restoreErr
	}, nil
}
