//go:build linux

package terminal

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// A real PTY exercises the kernel path without depending on the test runner's
// stdin or launching an external stty/script process.
func openPTY(t *testing.T) (master, slave *os.File) {
	t.Helper()
	master, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		t.Skipf("PTY unavailable: %v", err)
	}
	t.Cleanup(func() { master.Close() })
	var unlock int32
	if err := ioctl(master, syscall.TIOCSPTLCK, unsafe.Pointer(&unlock)); err != nil {
		t.Fatalf("unlock PTY: %v", err)
	}
	var number uint32
	if err := ioctl(master, syscall.TIOCGPTN, unsafe.Pointer(&number)); err != nil {
		t.Fatalf("PTY number: %v", err)
	}
	slave, err = os.OpenFile(fmt.Sprintf("/dev/pts/%d", number), os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { slave.Close() })
	return master, slave
}

func termios(t *testing.T, file *os.File) syscall.Termios {
	t.Helper()
	var state syscall.Termios
	if err := ioctl(file, getTermios, unsafe.Pointer(&state)); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestPTYDetectionAndSize(t *testing.T) {
	master, slave := openPTY(t)
	for _, file := range []*os.File{master, slave} {
		if !IsTerminal(file) {
			t.Error("PTY is not a terminal")
		}
	}
	for _, test := range []struct{ columns, rows, wantWidth, wantHeight int }{
		{123, 45, 123, 45}, {0, 0, 80, 24}, {90, 0, 80, 24}, {0, 30, 80, 24},
	} {
		size := windowSize{columns: uint16(test.columns), rows: uint16(test.rows)}
		if err := ioctl(slave, syscall.TIOCSWINSZ, unsafe.Pointer(&size)); err != nil {
			t.Fatal(err)
		}
		if w, h := Size(slave); w != test.wantWidth || h != test.wantHeight {
			t.Errorf("Size = %d,%d, want %d,%d", w, h, test.wantWidth, test.wantHeight)
		}
	}
}

func TestPreservesDescriptorFlags(t *testing.T) {
	_, slave := openPTY(t)
	conn, err := slave.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Control(func(fd uintptr) {
		if err := syscall.SetNonblock(int(fd), true); err != nil {
			t.Error(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	IsTerminal(slave)
	Size(slave)
	restore, err := Raw(slave)
	if err != nil {
		t.Fatal(err)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if err := conn.Control(func(fd uintptr) {
		flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, fd, syscall.F_GETFL, 0)
		if errno != 0 || flags&syscall.O_NONBLOCK == 0 {
			t.Errorf("descriptor lost nonblocking mode: flags=%#x, errno=%v", flags, errno)
		}
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRawSingleKeyAndRestore(t *testing.T) {
	master, slave := openPTY(t)
	original := termios(t, slave)
	restore, err := Raw(slave)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := restore(); err != nil {
			t.Error(err)
		}
	})
	raw := termios(t, slave)
	if raw.Lflag&(syscall.ECHO|syscall.ECHONL|syscall.ICANON|syscall.IEXTEN) != 0 || raw.Lflag&syscall.ISIG == 0 {
		t.Errorf("unexpected raw local flags: %#x", raw.Lflag)
	}
	if raw.Iflag&(syscall.ICRNL|syscall.INLCR|syscall.IGNCR|syscall.IXON|syscall.IXOFF|syscall.IXANY|syscall.ISTRIP) != 0 {
		t.Errorf("unexpected raw input flags: %#x", raw.Iflag)
	}
	if raw.Oflag&syscall.OPOST != 0 || raw.Cflag&syscall.CSIZE != syscall.CS8 || raw.Cc[syscall.VMIN] != 1 || raw.Cc[syscall.VTIME] != 0 {
		t.Errorf("unexpected raw attributes: %+v", raw)
	}
	fd := int(slave.Fd())
	if err := syscall.SetNonblock(fd, true); err != nil {
		t.Fatal(err)
	}
	// No newline is sent; CR and flow-control bytes must arrive unchanged.
	for _, key := range []byte{'x', '\r', 0x11, 0x13} {
		if _, err := master.Write([]byte{key}); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(2 * time.Second)
		for {
			var data [1]byte
			n, err := syscall.Read(fd, data[:])
			if err == syscall.EAGAIN || err == syscall.EINTR {
				if time.Now().After(deadline) {
					t.Fatal("single-key read blocked waiting for a newline")
				}
				time.Sleep(time.Millisecond)
				continue
			}
			if err != nil || n != 1 || data[0] != key {
				t.Fatalf("read = %q (%d), %v; want byte %#x", data, n, err, key)
			}
			break
		}
	}
	masterFD := int(master.Fd())
	if err := syscall.SetNonblock(masterFD, true); err != nil {
		t.Fatal(err)
	}
	var echoed [16]byte
	if n, err := syscall.Read(masterFD, echoed[:]); n > 0 || !errors.Is(err, syscall.EAGAIN) {
		t.Errorf("input was echoed: n=%d, err=%v", n, err)
	}
	var callers sync.WaitGroup
	for i := 0; i < 10; i++ {
		callers.Add(1)
		go func() {
			defer callers.Done()
			if err := restore(); err != nil {
				t.Error(err)
			}
		}()
	}
	callers.Wait()
	if got := termios(t, slave); got != original {
		t.Errorf("restore changed attributes:\ngot  %+v\nwant %+v", got, original)
	}
	// A repeated restore must not overwrite subsequent, intentional changes.
	changed := original
	changed.Lflag ^= syscall.ECHO
	if err := ioctl(slave, setTermios, unsafe.Pointer(&changed)); err != nil {
		t.Fatal(err)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if got := termios(t, slave); got != changed {
		t.Error("second restore was not a no-op")
	}
}

func TestRestoreClosedFile(t *testing.T) {
	_, slave := openPTY(t)
	restore, err := Raw(slave)
	if err != nil {
		t.Fatal(err)
	}
	if err := slave.Close(); err != nil {
		t.Fatal(err)
	}
	first := restore()
	if first == nil {
		t.Fatal("restoring a closed file succeeded")
	}
	if second := restore(); second != first {
		t.Errorf("restore error changed: %v -> %v", first, second)
	}
}
