//go:build linux || darwin || windows

package store

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"kanban/internal/exchange"
	"kanban/internal/model"
)

func testTask(n int) model.Task {
	stamp := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	return model.Task{
		ID: fmt.Sprintf("%08x", n), Title: fmt.Sprintf("Task %d", n),
		Status: "todo", Priority: "medium", Tags: []string{"storage"},
		CreatedAt: stamp, UpdatedAt: stamp,
	}
}

func boardBytes(t *testing.T, board model.Board) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := exchange.JSON(&buf, board); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func readBytes(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func assertUnchanged(t *testing.T, path string, before []byte) {
	t.Helper()
	if got := readBytes(t, path); !bytes.Equal(got, before) {
		t.Fatalf("store changed: got %q, want %q", got, before)
	}
}

func assertNoTemps(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".kanban-") {
			t.Errorf("temporary file left behind: %s", entry.Name())
		}
	}
}

func TestLoadMissingDoesNotCreateAnything(t *testing.T) {
	for _, nested := range []bool{false, true} {
		t.Run(fmt.Sprint(nested), func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "board.json")
			if nested {
				path = filepath.Join(dir, "missing", "private", "board.json")
			}
			s := &Store{Path: path}
			if _, err := s.Load(); !errors.Is(err, ErrNotInitialized) || !strings.Contains(err.Error(), path) {
				t.Fatalf("Load error = %v, want ErrNotInitialized with path", err)
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 0 {
				t.Fatalf("Load created files: %v, error %v", entries, err)
			}
		})
	}
}

func TestInitIdempotent(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "private", "board.json")}
	if created, err := s.Init(); err != nil || !created {
		t.Fatalf("Init = %v, %v", created, err)
	}
	board, err := s.Load()
	if err != nil || !reflect.DeepEqual(board, model.NewBoard()) {
		t.Fatalf("initial board = %#v, %v", board, err)
	}
	// Noncanonical whitespace makes an accidental decode/re-encode observable.
	before := append([]byte(" \n\t"), readBytes(t, s.Path)...)
	if err := os.WriteFile(s.Path, before, 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(s.Path)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if created, err := s.Init(); err != nil || created {
			t.Fatalf("repeated Init = %v, %v", created, err)
		}
		assertUnchanged(t, s.Path, before)
	}
	after, err := os.Stat(s.Path)
	if err != nil || !os.SameFile(info, after) {
		t.Fatalf("Init replaced existing file: %v", err)
	}
	assertNoTemps(t, filepath.Dir(s.Path))
}

func TestUpdateLifecycleAndAutoInitialization(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "private", "board.json")}
	if err := s.Update(func(board *model.Board) error {
		if !reflect.DeepEqual(*board, model.NewBoard()) {
			t.Fatalf("missing board = %#v", board)
		}
		board.Tasks = append(board.Tasks, testTask(1))
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.Load()
	if err != nil || len(loaded.Tasks) != 1 || loaded.Tasks[0].Title != "Task 1" {
		t.Fatalf("Load = %#v, %v", loaded, err)
	}
	loaded.Tasks[0].Title = "not persisted"
	if err := s.Update(func(board *model.Board) error {
		if board.Tasks[0].Title != "Task 1" {
			t.Fatal("Load leaked mutable state")
		}
		board.Tasks[0].Status = "done"
		board.Tasks[0].Priority = "urgent"
		board.Tasks = append(board.Tasks, testTask(2))
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	before := readBytes(t, s.Path)
	if created, err := s.Init(); err != nil || created {
		t.Fatalf("Init populated board = %v, %v", created, err)
	}
	assertUnchanged(t, s.Path, before)
	loaded, err = s.Load()
	if err != nil || len(loaded.Tasks) != 2 || loaded.Tasks[0].Status != "done" || loaded.Tasks[0].Priority != "urgent" {
		t.Fatalf("updated board = %#v, %v", loaded, err)
	}
	if err := s.Update(func(board *model.Board) error {
		board.Tasks = board.Tasks[:0]
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	loaded, err = s.Load()
	if err != nil || len(loaded.Tasks) != 0 {
		t.Fatalf("empty board = %#v, %v", loaded, err)
	}
	assertNoTemps(t, filepath.Dir(s.Path))
}

func TestMalformedStoresAreNotModified(t *testing.T) {
	for name, data := range map[string]string{
		"empty":     "",
		"truncated": `{"version":1,"tasks":[`,
		"version":   `{"version":999,"tasks":[]}`,
		"task":      `{"version":1,"tasks":[{}]}`,
		"trailing":  `{"version":1,"tasks":[]} {}`,
	} {
		t.Run(name, func(t *testing.T) {
			s := &Store{Path: filepath.Join(t.TempDir(), "board.json")}
			if err := os.WriteFile(s.Path, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Load(); err == nil || errors.Is(err, ErrNotInitialized) || !strings.Contains(err.Error(), s.Path) {
				t.Fatalf("Load malformed error = %v", err)
			}
			if created, err := s.Init(); err == nil || created {
				t.Fatalf("Init malformed = %v, %v", created, err)
			}
			called := false
			if err := s.Update(func(*model.Board) error { called = true; return nil }); err == nil || called {
				t.Fatalf("Update malformed error = %v, callback called = %v", err, called)
			}
			assertUnchanged(t, s.Path, []byte(data))
			assertNoTemps(t, filepath.Dir(s.Path))
		})
	}
}

func TestUpdateFailureLeavesBytesUnchanged(t *testing.T) {
	callbackErr := errors.New("callback failed")
	for _, existing := range []bool{false, true} {
		for _, validation := range []bool{false, true} {
			t.Run(fmt.Sprintf("existing=%v/validation=%v", existing, validation), func(t *testing.T) {
				s := &Store{Path: filepath.Join(t.TempDir(), "private", "board.json")}
				var before []byte
				if existing {
					if err := s.Update(func(board *model.Board) error {
						board.Tasks = append(board.Tasks, testTask(1))
						return nil
					}); err != nil {
						t.Fatal(err)
					}
					before = readBytes(t, s.Path)
				}
				err := s.Update(func(board *model.Board) error {
					if existing {
						board.Tasks[0].Title = "must not be saved"
						board.Tasks[0].Tags[0] = "mutated"
					}
					board.Tasks = append(board.Tasks, testTask(2))
					if validation {
						board.Version = -1
						return nil
					}
					return callbackErr
				})
				if err == nil || !strings.Contains(err.Error(), s.Path) {
					t.Fatalf("Update error = %v", err)
				}
				if !validation && !errors.Is(err, callbackErr) {
					t.Fatalf("callback error not wrapped: %v", err)
				}
				if existing {
					assertUnchanged(t, s.Path, before)
				} else if _, err := s.Load(); !errors.Is(err, ErrNotInitialized) {
					t.Fatalf("failed Update initialized store: %v", err)
				}
				assertNoTemps(t, filepath.Dir(s.Path))
				if err := s.Update(func(*model.Board) error { return nil }); err != nil {
					t.Fatalf("lock not released after failure: %v", err)
				}
			})
		}
	}
}

func TestUpdatePanicReleasesLock(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "board.json")}
	func() {
		defer func() {
			if recover() != "callback panic" {
				t.Error("callback panic was lost")
			}
		}()
		_ = s.Update(func(*model.Board) error { panic("callback panic") })
	}()
	if _, err := s.Load(); !errors.Is(err, ErrNotInitialized) {
		t.Fatalf("panic initialized board: %v", err)
	}
	if err := s.Update(func(*model.Board) error { return nil }); err != nil {
		t.Fatalf("lock was not released: %v", err)
	}
}

func TestInvalidArguments(t *testing.T) {
	s := &Store{}
	if _, err := s.Load(); err == nil || errors.Is(err, ErrNotInitialized) {
		t.Fatalf("empty path Load error = %v", err)
	}
	if created, err := s.Init(); created || err == nil {
		t.Fatalf("empty path Init = %v, %v", created, err)
	}
	if err := s.Update(func(*model.Board) error { return nil }); err == nil {
		t.Fatal("empty path Update succeeded")
	}
	dir := t.TempDir()
	s.Path = filepath.Join(dir, "private", "board.json")
	if err := s.Update(nil); err == nil {
		t.Fatal("nil callback succeeded")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("nil callback created files: %v, %v", entries, err)
	}
}

func TestFailedWritesCleanUp(t *testing.T) {
	injected := errors.New("injected encode failure")
	for _, stage := range []string{"encode", "sync", "verify"} {
		t.Run(stage, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "board.json")
			before := boardBytes(t, model.NewBoard())
			if err := os.WriteFile(path, before, 0600); err != nil {
				t.Fatal(err)
			}
			board := model.NewBoard()
			board.Tasks = append(board.Tasks, testTask(1))
			encode := func(w io.Writer, board model.Board) error {
				if stage == "encode" {
					if _, err := io.WriteString(w, `{"partial":`); err != nil {
						return err
					}
					return injected
				}
				if stage == "verify" {
					_, err := io.WriteString(w, "null\n")
					return err
				}
				if err := exchange.JSON(w, board); err != nil {
					return err
				}
				if stage == "sync" {
					return w.(*os.File).Close()
				}
				return nil
			}
			committed, err := writeBoard(path, board, false, encode, syncDirectory)
			if committed || err == nil || !strings.Contains(err.Error(), path) {
				t.Fatalf("failed write = %v, %v", committed, err)
			}
			if stage == "encode" && !errors.Is(err, injected) {
				t.Fatalf("encode error not wrapped: %v", err)
			}
			assertUnchanged(t, path, before)
			assertNoTemps(t, filepath.Dir(path))
		})
	}
}

func TestCreateOnlyDoesNotClobberRacingCreator(t *testing.T) {
	for _, valid := range []bool{false, true} {
		t.Run(fmt.Sprint(valid), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "board.json")
			existing := model.NewBoard()
			existing.Tasks = append(existing.Tasks, testTask(1))
			before := boardBytes(t, existing)
			if !valid {
				before = []byte("{broken")
			}
			committed, err := writeBoard(path, model.NewBoard(), true, func(w io.Writer, board model.Board) error {
				if err := os.WriteFile(path, before, 0600); err != nil {
					return err
				}
				return exchange.JSON(w, board)
			}, syncDirectory)
			if committed || (err == nil) != valid {
				t.Fatalf("racing create = %v, %v; valid existing board = %v", committed, err, valid)
			}
			assertUnchanged(t, path, before)
			assertNoTemps(t, filepath.Dir(path))
		})
	}
}

func TestOversizedUpdateLeavesBoardUnchanged(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "board.json")}
	if _, err := s.Init(); err != nil {
		t.Fatal(err)
	}
	before := readBytes(t, s.Path)
	err := s.Update(func(board *model.Board) error {
		task := testTask(1)
		// Model validation accepts this text, but the complete JSON exceeds
		// exchange.Decode's 32 MiB limit and must never replace the old board.
		task.Description = strings.Repeat("x", 32<<20)
		board.Tasks = append(board.Tasks, task)
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "32 MiB") {
		t.Fatalf("oversized Update error = %v", err)
	}
	assertUnchanged(t, s.Path, before)
	assertNoTemps(t, filepath.Dir(s.Path))
	if err := s.Update(func(*model.Board) error { return nil }); err != nil {
		t.Fatalf("failed oversized write did not release the lock: %v", err)
	}
}

func TestPostPublicationSyncErrorReportsCommitted(t *testing.T) {
	for _, createOnly := range []bool{false, true} {
		t.Run(fmt.Sprint(createOnly), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "board.json")
			if !createOnly {
				if err := os.WriteFile(path, boardBytes(t, model.NewBoard()), 0600); err != nil {
					t.Fatal(err)
				}
			}
			board := model.NewBoard()
			board.Tasks = append(board.Tasks, testTask(1))
			injected := errors.New("injected directory sync failure")
			committed, err := writeBoard(path, board, createOnly, exchange.JSON, func(dir string) error {
				if dir != filepath.Dir(path) {
					t.Errorf("sync directory = %q", dir)
				}
				return injected
			})
			if !committed || !errors.Is(err, injected) || !strings.Contains(err.Error(), "committed, durability uncertain") {
				t.Fatalf("directory sync failure = %v, %v", committed, err)
			}
			loaded, err := (&Store{Path: path}).Load()
			if err != nil || !reflect.DeepEqual(loaded, board) {
				t.Fatalf("committed board = %#v, %v", loaded, err)
			}
			assertNoTemps(t, filepath.Dir(path))
		})
	}
}

func TestNonregularDestinationRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "board.json")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(path, "keep")
	if err := os.WriteFile(marker, []byte("unchanged"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &Store{Path: path}
	if _, err := s.Load(); err == nil || errors.Is(err, ErrNotInitialized) {
		t.Fatalf("directory Load error = %v", err)
	}
	if created, err := s.Init(); created || err == nil {
		t.Fatalf("directory Init = %v, %v", created, err)
	}
	called := false
	if err := s.Update(func(*model.Board) error { called = true; return nil }); err == nil || called {
		t.Fatalf("directory Update = %v, called = %v", err, called)
	}
	assertUnchanged(t, marker, []byte("unchanged"))
	assertNoTemps(t, filepath.Dir(path))
}

func TestSymlinkDestinationRejected(t *testing.T) {
	for _, dangling := range []bool{false, true} {
		t.Run(fmt.Sprint(dangling), func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "target.json")
			before := boardBytes(t, model.NewBoard())
			if !dangling {
				if err := os.WriteFile(target, before, 0600); err != nil {
					t.Fatal(err)
				}
			}
			s := &Store{Path: filepath.Join(dir, "board.json")}
			if err := os.Symlink(target, s.Path); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
			if _, err := s.Load(); err == nil || errors.Is(err, ErrNotInitialized) {
				t.Fatalf("symlink Load = %v", err)
			}
			if created, err := s.Init(); created || err == nil {
				t.Fatalf("symlink Init = %v, %v", created, err)
			}
			called := false
			if err := s.Update(func(*model.Board) error { called = true; return nil }); err == nil || called {
				t.Fatalf("symlink Update = %v, called = %v", err, called)
			}
			if got, err := os.Readlink(s.Path); err != nil || got != target {
				t.Fatalf("symlink replaced: %q, %v", got, err)
			}
			if dangling {
				if _, err := os.Stat(target); !errors.Is(err, fs.ErrNotExist) {
					t.Fatalf("dangling target changed: %v", err)
				}
			} else {
				assertUnchanged(t, target, before)
			}
			assertNoTemps(t, dir)
		})
	}
}

func TestLockTimeoutAndPersistence(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "board.json")}
	if _, err := s.Init(); err != nil {
		t.Fatal(err)
	}
	lockPath := s.Path + ".lock"
	before, err := os.Stat(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	lock, err := acquireLock(lockPath, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lock.Close() })
	start := time.Now()
	second, err := acquireLock(lockPath, 60*time.Millisecond)
	if second != nil {
		second.Close()
		t.Fatal("second exclusive lock succeeded")
	}
	if err == nil || !strings.Contains(err.Error(), lockPath) || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("lock timeout error = %v", err)
	}
	if elapsed := time.Since(start); elapsed < 50*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("lock wait = %s", elapsed)
	}
	if _, err := s.Load(); err != nil {
		t.Fatalf("Load should work while locked: %v", err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	if err := s.Update(func(*model.Board) error { return nil }); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(lockPath)
	if err != nil || !os.SameFile(before, after) {
		t.Fatalf("persistent lock replaced or removed: %v", err)
	}
}

func TestUnsafeLockPathsRejected(t *testing.T) {
	for _, symlink := range []bool{false, true} {
		t.Run(fmt.Sprint(symlink), func(t *testing.T) {
			dir := t.TempDir()
			s := &Store{Path: filepath.Join(dir, "board.json")}
			target := filepath.Join(dir, "target")
			if symlink {
				if err := os.WriteFile(target, []byte("keep"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, s.Path+".lock"); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
			} else if err := os.Mkdir(s.Path+".lock", 0700); err != nil {
				t.Fatal(err)
			}
			if created, err := s.Init(); created || err == nil {
				t.Fatalf("unsafe lock Init = %v, %v", created, err)
			}
			if err := s.Update(func(*model.Board) error { t.Error("callback called"); return nil }); err == nil {
				t.Fatal("unsafe lock Update succeeded")
			}
			if _, err := os.Stat(s.Path); !errors.Is(err, fs.ErrNotExist) {
				t.Fatalf("store unexpectedly created: %v", err)
			}
			if symlink {
				assertUnchanged(t, target, []byte("keep"))
			}
		})
	}
}

func TestParentSymlinkUsesSameLock(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real")
	if err := os.Mkdir(real, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias")
	if err := os.Symlink(real, alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	s := &Store{Path: filepath.Join(real, "private", "board.json")}
	other := &Store{Path: filepath.Join(alias, "private", "board.json")}
	p1, err := s.resolvePath(true)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := other.resolvePath(true)
	if err != nil || p1 != p2 {
		t.Fatalf("canonical paths differ: %q, %q, %v", p1, p2, err)
	}
	lock, err := acquireLock(p1+".lock", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	result := make(chan error, 1)
	go func() { result <- other.Update(func(*model.Board) error { return nil }) }()
	select {
	case err := <-result:
		t.Fatalf("alias bypassed lock: %v", err)
	case <-time.After(75 * time.Millisecond):
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("alias did not acquire released lock")
	}
	if _, err := s.Load(); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentWritersAndReaders(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "board.json")}
	if _, err := s.Init(); err != nil {
		t.Fatal(err)
	}
	const writers, updates = 12, 4
	start := make(chan struct{})
	stop := make(chan struct{})
	readerResult := make(chan error, 1)
	go func() {
		last := 0
		for {
			select {
			case <-stop:
				readerResult <- nil
				return
			default:
			}
			board, err := s.Load()
			if err != nil {
				readerResult <- err
				return
			}
			if len(board.Tasks) < last {
				readerResult <- fmt.Errorf("reader went backwards: %d < %d", len(board.Tasks), last)
				return
			}
			last = len(board.Tasks)
			time.Sleep(time.Millisecond)
		}
	}()
	errs := make(chan error, writers)
	var wg sync.WaitGroup
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			local := &Store{Path: s.Path}
			for j := 0; j < updates; j++ {
				if err := local.Update(func(board *model.Board) error {
					time.Sleep(time.Millisecond)
					board.Tasks = append(board.Tasks, testTask(len(board.Tasks)+1))
					return nil
				}); err != nil {
					errs <- err
					return
				}
			}
		}()
	}
	close(start)
	wg.Wait()
	close(stop)
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if err := <-readerResult; err != nil {
		t.Errorf("concurrent reader: %v", err)
	}
	board, err := s.Load()
	if err != nil || len(board.Tasks) != writers*updates {
		t.Fatalf("lost updates: tasks = %d, want %d; error %v", len(board.Tasks), writers*updates, err)
	}
	assertNoTemps(t, filepath.Dir(s.Path))
}

func TestConcurrentInitCreatesOnce(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "private", "board.json")}
	type result struct {
		created bool
		err     error
	}
	results := make(chan result, 10)
	for i := 0; i < cap(results); i++ {
		go func() {
			created, err := s.Init()
			results <- result{created, err}
		}()
	}
	count := 0
	for i := 0; i < cap(results); i++ {
		r := <-results
		if r.err != nil {
			t.Error(r.err)
		}
		if r.created {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("Init reported creation %d times", count)
	}
	assertNoTemps(t, filepath.Dir(s.Path))
}

func TestOpenReaderKeepsCompleteOldSnapshot(t *testing.T) {
	s := &Store{Path: filepath.Join(t.TempDir(), "board.json")}
	if _, err := s.Init(); err != nil {
		t.Fatal(err)
	}
	old, err := openBoard(s.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	if err := s.Update(func(board *model.Board) error {
		board.Tasks = append(board.Tasks, testTask(1))
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	board, err := exchange.Decode(old)
	if err != nil || len(board.Tasks) != 0 {
		t.Fatalf("old reader saw incomplete/changed data: %#v, %v", board, err)
	}
	board, err = s.Load()
	if err != nil || len(board.Tasks) != 1 {
		t.Fatalf("new reader did not see update: %#v, %v", board, err)
	}
}

func TestStoreProcessHelper(t *testing.T) {
	mode := os.Getenv("KANBAN_STORE_TEST_HELPER")
	if mode == "" {
		t.Skip("subprocess helper")
	}
	path := os.Getenv("KANBAN_STORE_TEST_PATH")
	if mode == "hold" {
		lock, err := acquireLock(path+".lock", time.Second)
		if err != nil {
			t.Fatal(err)
		}
		defer lock.Close()
		fmt.Fprintln(os.Stdout, "locked")
		time.Sleep(time.Minute)
		return
	}
	if mode != "write" {
		t.Fatalf("unknown helper mode %q", mode)
	}
	s := &Store{Path: path}
	for i := 0; i < 5; i++ {
		if err := s.Update(func(board *model.Board) error {
			time.Sleep(2 * time.Millisecond)
			board.Tasks = append(board.Tasks, testTask(len(board.Tasks)+1))
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestConcurrentProcessesDoNotLoseUpdates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "board.json")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	const processes = 4
	commands := make([]*exec.Cmd, processes)
	outputs := make([]bytes.Buffer, processes)
	for i := range commands {
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStoreProcessHelper$")
		cmd.Env = append(os.Environ(), "KANBAN_STORE_TEST_HELPER=write", "KANBAN_STORE_TEST_PATH="+path)
		cmd.Stdout, cmd.Stderr = &outputs[i], &outputs[i]
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		commands[i] = cmd
	}
	for i, cmd := range commands {
		if err := cmd.Wait(); err != nil {
			t.Errorf("writer %d: %v\n%s", i, err, outputs[i].String())
		}
	}
	board, err := (&Store{Path: path}).Load()
	if err != nil || len(board.Tasks) != processes*5 {
		t.Fatalf("process updates: tasks = %d, error %v", len(board.Tasks), err)
	}
	assertNoTemps(t, filepath.Dir(path))
}

func TestProcessExitReleasesPersistentLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "board.json")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStoreProcessHelper$")
	cmd.Env = append(os.Environ(), "KANBAN_STORE_TEST_HELPER=hold", "KANBAN_STORE_TEST_PATH="+path)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cmd.Process.Kill()
		cmd.Wait()
	}()
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != "locked\n" {
		// Wait joins the stderr copier before reading its buffer.
		cmd.Process.Kill()
		cmd.Wait()
		t.Fatalf("helper readiness = %q, %v; stderr: %s", line, err, stderr.String())
	}
	before, err := os.Stat(path + ".lock")
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	lock, err := acquireLock(path+".lock", time.Second)
	if err != nil {
		t.Fatalf("crashed process left lock held: %v", err)
	}
	lock.Close()
	after, err := os.Stat(path + ".lock")
	if err != nil || !os.SameFile(before, after) {
		t.Fatalf("lock file was stolen/replaced: %v", err)
	}
}
