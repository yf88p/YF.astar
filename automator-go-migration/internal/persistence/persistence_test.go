package persistence

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestYAMLRoundTripAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "state.yaml")
	type state struct {
		Name string         `yaml:"name"`
		Args map[string]any `yaml:"args"`
	}
	want := state{Name: "run\nname", Args: map[string]any{"bool": true, "number": 4, "text": "yes"}}
	if err := SaveYAML(path, want); err != nil {
		t.Fatal(err)
	}
	var got state
	if err := LoadYAML(path, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("roundtrip = %#v, want %#v", got, want)
	}
	assertMode(t, path, 0600)
	assertMode(t, filepath.Dir(path), 0700)
	if err := os.Chmod(path, 0640); err != nil {
		t.Fatal(err)
	}
	if err := SaveYAML(path, want); err != nil {
		t.Fatal(err)
	}
	assertMode(t, path, 0640)
	assertNoTemps(t, filepath.Dir(path))
}

func TestLoadYAMLErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "input.yaml")
	var out struct {
		Name string `yaml:"name"`
	}
	if err := LoadYAML(path, &out); !errors.Is(err, os.ErrNotExist) || !strings.Contains(err.Error(), path) {
		t.Fatalf("missing file error: %v", err)
	}
	for _, input := range []string{"", "[unterminated", "name: one\nname: two\n", "name: one\n---\nname: two\n", "name: one\n---\n[invalid"} {
		if err := os.WriteFile(path, []byte(input), 0600); err != nil {
			t.Fatal(err)
		}
		if err := LoadYAML(path, &out); err == nil || !strings.Contains(err.Error(), path) {
			t.Errorf("LoadYAML(%q) error = %v", input, err)
		}
	}
	if err := os.WriteFile(path, []byte("name: known\nfuture_field: {nested: true}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := LoadYAML(path, &out); err != nil || out.Name != "known" {
		t.Errorf("unknown fields: %#v, %v", out, err)
	}
	for _, out := range []any{nil, (*string)(nil), "not a pointer"} {
		if err := LoadYAML(path, out); err == nil {
			t.Errorf("accepted invalid output %T", out)
		}
	}
}

type failingMarshaler struct{}

func (failingMarshaler) MarshalYAML() (any, error) {
	return nil, errors.New("test serialization failure")
}

func TestSaveYAMLErrorsPreserveFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.yaml")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := SaveYAML(path, failingMarshaler{}); err == nil || !strings.Contains(err.Error(), "serialize") {
		t.Errorf("serialization error = %v", err)
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "original" {
		t.Errorf("failed save changed file: %q, %v", data, err)
	}
	if err := SaveYAML(filepath.Join(path, "child"), "value"); err == nil {
		t.Error("ignored stat failure")
	}
	assertNoTemps(t, filepath.Dir(path))
}

func TestWriteFileReplacesSymlinkNotTarget(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "link")
	if err := os.Symlink(target, path); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink creation unavailable: %v", err)
		}
		t.Fatal(err)
	}
	if err := WriteFile(path, []byte("replacement"), 0640); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "original" {
		t.Errorf("symlink target changed: %q, %v", data, err)
	}
	if info, err := os.Lstat(path); err != nil || !info.Mode().IsRegular() {
		t.Errorf("replacement is not regular: %v, %v", info, err)
	}
	assertMode(t, path, 0640)
}

func TestWriteFileReplacesAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "file")
	if err := WriteFile(path, []byte("long original contents"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(path, []byte("short"), 0750); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "short" {
		t.Fatalf("replacement = %q, %v", got, err)
	}
	assertMode(t, path, 0750)
	if err := WriteFile(filepath.Join(path, "child"), nil, 0600); err == nil {
		t.Error("accepted non-directory parent")
	}
	target := filepath.Join(dir, "directory")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(target, []byte("cannot replace directory"), 0600); err == nil {
		t.Error("replaced a directory")
	}
	assertNoTemps(t, dir)
	if err := WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(path); err != nil || info.Size() != 0 {
		t.Errorf("empty replacement: %v, %v", info, err)
	}
}

func TestConcurrentAtomicWrites(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.ReadFile does not share delete access required for concurrent Windows replacement")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "shared")
	const size = 64 * 1024
	if err := WriteFile(path, bytes.Repeat([]byte{'A'}, size), 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	errs := make(chan error, 32)
	var reader sync.WaitGroup
	reader.Add(1)
	go func() {
		defer reader.Done()
		for {
			select {
			case <-done:
				return
			default:
			}
			data, err := os.ReadFile(path)
			if err != nil {
				errs <- err
				return
			}
			if len(data) != size || !bytes.Equal(data, bytes.Repeat(data[:1], size)) {
				errs <- errors.New("reader observed a partial or mixed write")
				return
			}
		}
	}()
	var writers sync.WaitGroup
	for i := 0; i < 24; i++ {
		writers.Add(1)
		go func(i int) {
			defer writers.Done()
			if err := WriteFile(path, bytes.Repeat([]byte{byte('A' + i)}, size), 0600); err != nil {
				errs <- err
			}
		}(i)
	}
	writers.Wait()
	close(done)
	reader.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	assertNoTemps(t, dir)
}

func TestLocks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "run.lock")
	unlock, err := TryLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	assertMode(t, path, 0600)
	if second, err := TryLock(path); second != nil || !errors.Is(err, ErrLocked) {
		if second != nil {
			second()
		}
		t.Fatalf("contended TryLock = %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if second, err := Lock(ctx, path); second != nil || !errors.Is(err, context.DeadlineExceeded) {
		if second != nil {
			second()
		}
		t.Fatalf("contended Lock deadline = %v", err)
	}
	acquired := make(chan func(), 1)
	errs := make(chan error, 1)
	ctx, cancelWait := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelWait()
	go func() {
		second, err := Lock(ctx, path)
		if err != nil {
			errs <- err
			return
		}
		acquired <- second
	}()
	select {
	case second := <-acquired:
		second()
		t.Fatal("Lock acquired before release")
	case err := <-errs:
		t.Fatal(err)
	case <-time.After(30 * time.Millisecond):
	}
	unlock()
	unlock() // Release is safe to defer and call explicitly.
	select {
	case second := <-acquired:
		second()
	case err := <-errs:
		t.Fatal(err)
	case <-ctx.Done():
		t.Fatal("Lock did not acquire after release")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("lock file must remain: %v", err)
	}
}

func TestLockErrors(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "not-created.lock")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if unlock, err := Lock(ctx, path); unlock != nil || !errors.Is(err, context.Canceled) {
		t.Errorf("canceled Lock = %v", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("canceled Lock created a file: %v", err)
	}
	if unlock, err := TryLock(dir); unlock != nil || err == nil {
		if unlock != nil {
			unlock()
		}
		t.Errorf("locking directory = %v", err)
	}
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if unlock, err := TryLock(filepath.Join(path, "child")); unlock != nil || err == nil {
		if unlock != nil {
			unlock()
		}
		t.Errorf("non-directory lock parent = %v", err)
	}
}

func TestLockAcrossProcesses(t *testing.T) {
	if path := os.Getenv("AUTOMATOR_TEST_LOCK_CHILD"); path != "" {
		unlock, err := TryLock(path)
		if unlock != nil {
			unlock()
		}
		if !errors.Is(err, ErrLocked) {
			t.Fatalf("child lock: %v", err)
		}
		return
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "cross-process.lock")
	unlock, err := Lock(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestLockAcrossProcesses$")
	cmd.Env = []string{"HOME=" + dir, "AUTOMATOR_HOME=" + dir, "AUTOMATOR_TEST_LOCK_CHILD=" + path}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("child: %v\n%s", err, out)
	}
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" {
		// Windows chmod only maps the owner-write bit to the read-only attribute.
		writable := want&0200 != 0
		want = 0444
		if writable {
			want |= 0222
		}
		if info.IsDir() {
			want |= 0111
		}
	}
	if got := info.Mode().Perm(); got != want {
		t.Errorf("mode %s = %o, want %o", path, got, want)
	}
}

func assertNoTemps(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			t.Error(fmt.Errorf("leaked temporary file %s", entry.Name()))
		}
	}
}
