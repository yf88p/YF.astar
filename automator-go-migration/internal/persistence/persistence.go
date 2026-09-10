// Package persistence provides durable YAML storage and advisory file locks.
package persistence

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"time"

	"github.com/gofrs/flock"
	"go.yaml.in/yaml/v3"
)

func LoadYAML(path string, out any) error {
	if value := reflect.ValueOf(out); !value.IsValid() || value.Kind() != reflect.Pointer || value.IsNil() {
		return fmt.Errorf("parse %s: output must be a non-nil pointer", path)
	}
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	defer f.Close()
	d := yaml.NewDecoder(f)
	var document yaml.Node
	if err := d.Decode(&document); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		if err == nil {
			err = errors.New("expected a single YAML document")
		}
		return fmt.Errorf("parse %s: %w", path, err)
	}
	// yaml.v3 skips custom unmarshallers for null nodes. Invoke the root
	// unmarshaller explicitly so schema types can reject a null document.
	if custom, ok := out.(yaml.Unmarshaler); ok {
		err = custom.UnmarshalYAML(document.Content[0])
	} else {
		err = document.Decode(out)
	}
	if err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}

// SaveYAML preserves an existing file's permissions; new files are private.
func SaveYAML(path string, value any) error {
	data, err := yaml.Marshal(value)
	if err != nil {
		return fmt.Errorf("serialize %s: %w", path, err)
	}
	mode := os.FileMode(0600)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	return WriteFile(path, data, mode)
}

// WriteFile replaces path atomically with a uniquely named file in the same
// directory. Both the contents and the rename are synced before success.
func WriteFile(path string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create parent of %s: %w", path, err)
	}
	f, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary file for %s: %w", path, err)
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	defer f.Close()
	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	if err := f.Chmod(mode); err != nil {
		return fmt.Errorf("chmod %s: %w", path, err)
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("sync %s: %w", path, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close %s: %w", path, err)
	}
	return replaceFile(tmp, path)
}

// ErrLocked means that a nonblocking lock attempt found an existing owner.
var ErrLocked = errors.New("file is locked")

// Lock waits until the advisory lock is acquired or ctx is canceled. Lock files
// are intentionally retained: unlinking them can create two independent locks.
func Lock(ctx context.Context, path string) (unlock func(), err error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return lock(ctx, path, true)
}

func TryLock(path string) (unlock func(), err error) {
	return lock(context.Background(), path, false)
}

func lock(ctx context.Context, path string, wait bool) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, fmt.Errorf("create lock directory: %w", err)
	}
	f := flock.New(path, flock.SetPermissions(0600))
	var acquired bool
	var err error
	if wait {
		acquired, err = f.TryLockContext(ctx, 10*time.Millisecond)
	} else {
		acquired, err = f.TryLock()
	}
	if err != nil || !acquired {
		_ = f.Close()
		if err == nil {
			err = ErrLocked
		}
		return nil, fmt.Errorf("lock %s: %w", path, err)
	}
	var once sync.Once
	return func() { once.Do(func() { _ = f.Close() }) }, nil
}
