package store

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"kanban/internal/exchange"
	"kanban/internal/model"
)

// ErrNotInitialized indicates that the board file (or its parent) is missing.
var ErrNotInitialized = errors.New("store not initialized")

// Store stores a board at Path. Path must not be changed during an operation.
type Store struct {
	Path string
}

const lockTimeout = 5 * time.Second

// Load decodes and validates the existing board without creating any files or
// directories. A missing board returns an error wrapping ErrNotInitialized.
func (s *Store) Load() (model.Board, error) {
	path, err := s.resolvePath(false)
	if err == nil {
		var board model.Board
		board, err = readBoard(path)
		if err == nil {
			return board, nil
		}
	}
	if errors.Is(err, fs.ErrNotExist) {
		return model.Board{}, fmt.Errorf("load store %q: %w: %w", s.Path, ErrNotInitialized, err)
	}
	return model.Board{}, err
}

// Init creates an empty board only if one is missing. Existing boards are
// validated, never overwritten. created is true once the new board is published,
// including when a subsequent directory-sync error is returned.
func (s *Store) Init() (created bool, err error) {
	path, err := s.resolvePath(true)
	if err != nil {
		return false, err
	}
	lock, err := acquireLock(path+".lock", lockTimeout)
	if err != nil {
		return false, err
	}
	defer lock.Close()

	if _, err := readBoard(path); err == nil {
		return false, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	board := model.NewBoard()
	if err := model.ValidateBoard(board); err != nil {
		return false, fmt.Errorf("validate new store %q: %w", path, err)
	}
	return writeBoard(path, board, true, exchange.JSON, syncDirectory)
}

// Update locks the complete read-modify-write operation. A missing board starts
// as model.NewBoard(). Callback and validation errors leave the board bytes
// unchanged. The callback must not recursively update or initialize this store.
// Errors after atomic publication explicitly say the change has committed but
// durability is uncertain. The callback must not retain the board for mutation.
func (s *Store) Update(fn func(*model.Board) error) error {
	if fn == nil {
		return fmt.Errorf("update store %q: nil callback", s.Path)
	}
	path, err := s.resolvePath(true)
	if err != nil {
		return err
	}
	lock, err := acquireLock(path+".lock", lockTimeout)
	if err != nil {
		return err
	}
	defer lock.Close()

	board, err := readBoard(path)
	if errors.Is(err, fs.ErrNotExist) {
		board = model.NewBoard()
	} else if err != nil {
		return err
	}
	if err := fn(&board); err != nil {
		return fmt.Errorf("update store %q: callback: %w", path, err)
	}
	if err := model.ValidateBoard(board); err != nil {
		return fmt.Errorf("validate store %q: %w", path, err)
	}
	_, err = writeBoard(path, board, false, exchange.JSON, syncDirectory)
	return err
}

func (s *Store) resolvePath(create bool) (string, error) {
	if s.Path == "" {
		return "", errors.New("store path is empty")
	}
	path, err := filepath.Abs(s.Path)
	if err != nil {
		return "", fmt.Errorf("resolve store %q: %w", s.Path, err)
	}
	parent := filepath.Dir(path)
	if create {
		if err := makePrivateDirectories(parent); err != nil {
			return "", fmt.Errorf("create directory for store %q: %w", s.Path, err)
		}
	}
	parent, err = filepath.EvalSymlinks(parent)
	if err != nil {
		return "", fmt.Errorf("resolve directory for store %q: %w", s.Path, err)
	}
	return filepath.Join(parent, filepath.Base(path)), nil
}

func makePrivateDirectories(path string) error {
	info, err := os.Stat(path)
	if err == nil {
		if !info.IsDir() {
			return fmt.Errorf("%q is not a directory", path)
		}
		return nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	parent := filepath.Dir(path)
	if parent == path {
		return err
	}
	if err := makePrivateDirectories(parent); err != nil {
		return err
	}
	if err := os.Mkdir(path, 0700); err != nil {
		if !errors.Is(err, fs.ErrExist) {
			return err
		}
		info, statErr := os.Stat(path)
		if statErr != nil {
			return statErr
		}
		if !info.IsDir() {
			return fmt.Errorf("%q is not a directory", path)
		}
	}
	// The new directory's name must survive a crash too, not just its contents.
	if err := syncDirectory(parent); err != nil {
		return fmt.Errorf("sync parent of new directory %q: %w", path, err)
	}
	return nil
}

func checkDestination(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("store %q: symbolic link destination is not allowed", path)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("store %q: destination is not a regular file", path)
	}
	return nil
}

func readBoard(path string) (model.Board, error) {
	if err := checkDestination(path); err != nil {
		return model.Board{}, fmt.Errorf("inspect store %q: %w", path, err)
	}
	f, err := openBoard(path)
	if err != nil {
		return model.Board{}, fmt.Errorf("open store %q: %w", path, err)
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		if err != nil {
			return model.Board{}, fmt.Errorf("stat store %q: %w", path, err)
		}
		return model.Board{}, fmt.Errorf("store %q: destination is not a regular file", path)
	}
	board, decodeErr := exchange.Decode(f)
	closeErr := f.Close()
	if decodeErr != nil {
		return model.Board{}, fmt.Errorf("decode store %q: %w", path, decodeErr)
	}
	if closeErr != nil {
		return model.Board{}, fmt.Errorf("close store %q: %w", path, closeErr)
	}
	return board, nil
}

// Function arguments allow testing failures without mutable global I/O hooks.
func writeBoard(path string, board model.Board, createOnly bool,
	encode func(io.Writer, model.Board) error, syncDir func(string) error,
) (committed bool, err error) {
	parent := filepath.Dir(path)
	f, err := os.CreateTemp(parent, ".kanban-*.tmp")
	if err != nil {
		return false, fmt.Errorf("create temporary file for store %q: %w", path, err)
	}
	temp := f.Name()
	defer func() {
		if f != nil {
			f.Close()
		}
		if temp != "" {
			if cleanupErr := os.Remove(temp); cleanupErr != nil && !errors.Is(cleanupErr, fs.ErrNotExist) {
				err = errors.Join(err, fmt.Errorf("remove temporary file %q: %w", temp, cleanupErr))
			}
		}
	}()
	if err := f.Chmod(0600); err != nil {
		return false, fmt.Errorf("set temporary file permissions for store %q: %w", path, err)
	}
	if err := encode(f, board); err != nil {
		return false, fmt.Errorf("encode store %q: %w", path, err)
	}
	if err := f.Sync(); err != nil {
		return false, fmt.Errorf("sync temporary file for store %q: %w", path, err)
	}
	// The codec may impose read-side limits beyond model validation. Never
	// replace a usable board with an encoding that Load would reject.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return false, fmt.Errorf("rewind temporary file for store %q: %w", path, err)
	}
	if _, err := exchange.Decode(f); err != nil {
		return false, fmt.Errorf("verify encoded store %q: %w", path, err)
	}
	if err := f.Close(); err != nil {
		f = nil
		return false, fmt.Errorf("close temporary file for store %q: %w", path, err)
	}
	f = nil
	if err := checkDestination(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	if createOnly {
		err = os.Link(temp, path)
	} else {
		err = os.Rename(temp, path)
	}
	if err != nil {
		if createOnly && errors.Is(err, fs.ErrExist) {
			// A creator outside our locking protocol won. Validate its board,
			// while still letting deferred cleanup failures reach the caller.
			_, err = readBoard(path)
			return false, err
		}
		return false, fmt.Errorf("publish store %q: %w", path, err)
	}
	if createOnly {
		if err := os.Remove(temp); err != nil {
			return true, fmt.Errorf("store %q: change committed, durability uncertain: remove temporary file %q: %w", path, temp, err)
		}
	}
	temp = ""
	if err := syncDir(parent); err != nil {
		return true, fmt.Errorf("store %q: change committed, durability uncertain: sync directory: %w", path, err)
	}
	return true, nil
}

func waitForLock(path string, deadline time.Time, timeout time.Duration) error {
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return fmt.Errorf("timed out after %s waiting for store lock %q", timeout, path)
	}
	if remaining > 25*time.Millisecond {
		remaining = 25 * time.Millisecond
	}
	time.Sleep(remaining)
	return nil
}
