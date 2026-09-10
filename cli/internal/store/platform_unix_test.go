//go:build linux || darwin

package store

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"kanban/internal/exchange"
	"kanban/internal/model"
)

func TestPrivatePermissions(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0755); err != nil {
		t.Fatal(err)
	}
	s := &Store{Path: filepath.Join(root, "private", "nested", "board.json")}
	if _, err := s.Init(); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]fs.FileMode{
		root: 0755, filepath.Join(root, "private"): 0700,
		filepath.Dir(s.Path): 0700, s.Path: 0600, s.Path + ".lock": 0600,
	} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != want {
			t.Errorf("mode of %s = %04o, want %04o", path, got, want)
		}
	}
	if err := os.Chmod(s.Path, 0644); err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(*model.Board) error { return nil }); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(s.Path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("updated permissions = %v, %v", info, err)
	}
}

func TestFIFOPathsDoNotBlock(t *testing.T) {
	for _, lockPath := range []bool{false, true} {
		t.Run(map[bool]string{false: "board", true: "lock"}[lockPath], func(t *testing.T) {
			s := &Store{Path: filepath.Join(t.TempDir(), "board.json")}
			fifo := s.Path
			if lockPath {
				fifo += ".lock"
			}
			if err := syscall.Mkfifo(fifo, 0600); err != nil {
				t.Fatal(err)
			}
			if !lockPath {
				if _, err := s.Load(); err == nil || errors.Is(err, ErrNotInitialized) {
					t.Fatalf("FIFO Load = %v", err)
				}
			}
			if created, err := s.Init(); created || err == nil {
				t.Fatalf("FIFO Init = %v, %v", created, err)
			}
			if err := s.Update(func(*model.Board) error { t.Error("callback called"); return nil }); err == nil {
				t.Fatal("FIFO Update succeeded")
			}
			info, err := os.Lstat(fifo)
			if err != nil || info.Mode()&os.ModeNamedPipe == 0 {
				t.Fatalf("FIFO replaced: %v, %v", info, err)
			}
		})
	}
}

func TestUnwritableDirectoryLeavesBoardUnchanged(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses directory permissions")
	}
	dir := t.TempDir()
	s := &Store{Path: filepath.Join(dir, "board.json")}
	if _, err := s.Init(); err != nil {
		t.Fatal(err)
	}
	before := readBytes(t, s.Path)
	if err := os.Chmod(dir, 0500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(dir, 0700) })
	if err := s.Update(func(board *model.Board) error {
		board.Tasks = append(board.Tasks, testTask(1))
		return nil
	}); err == nil {
		t.Fatal("write into read-only directory succeeded")
	}
	assertUnchanged(t, s.Path, before)
	assertNoTemps(t, dir)
	lock, err := acquireLock(s.Path+".lock", time.Second)
	if err != nil {
		t.Fatalf("failed write left lock held: %v", err)
	}
	lock.Close()
}

func TestRenameFailureLeavesBoardUnchanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "board.json")
	before := boardBytes(t, model.NewBoard())
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	board := model.NewBoard()
	board.Tasks = append(board.Tasks, testTask(1))
	committed, err := writeBoard(path, board, false, func(w io.Writer, board model.Board) error {
		if err := exchange.JSON(w, board); err != nil {
			return err
		}
		// Unix permits unlinking an open file: sync and close still succeed, but
		// the later rename must fail because its source no longer exists.
		return os.Remove(w.(*os.File).Name())
	}, syncDirectory)
	if committed || !errors.Is(err, fs.ErrNotExist) || !strings.Contains(err.Error(), "publish") {
		t.Fatalf("rename failure = %v, %v", committed, err)
	}
	assertUnchanged(t, path, before)
	assertNoTemps(t, filepath.Dir(path))
}
