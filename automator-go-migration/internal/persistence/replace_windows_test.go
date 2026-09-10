package persistence

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsWriteFileCreatesAndReplaces(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "state-\u4e16\u754c.yaml")
	for _, content := range []string{"first contents", "shorter", ""} {
		if err := WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatalf("write %q: %v", content, err)
		}
		if got, err := os.ReadFile(path); err != nil || string(got) != content {
			t.Fatalf("contents = %q, %v; want %q", got, err, content)
		}
		assertNoTemps(t, filepath.Dir(path))
	}
	for _, content := range []string{"first", "replacement"} {
		want := map[string]string{"value": content}
		if err := SaveYAML(path, want); err != nil {
			t.Fatal(err)
		}
		var got map[string]string
		if err := LoadYAML(path, &got); err != nil || got["value"] != content {
			t.Fatalf("YAML replacement = %v, %v", got, err)
		}
	}
}

func TestWindowsReplaceErrorsLeaveOriginal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "target")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(path, "keep")
	if err := os.WriteFile(original, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(path, []byte("replacement"), 0600); err == nil || !strings.Contains(err.Error(), "atomic rename") {
		t.Fatalf("replacement error = %v", err)
	}
	if got, err := os.ReadFile(original); err != nil || string(got) != "original" {
		t.Fatalf("failed replacement changed original: %q, %v", got, err)
	}
	assertNoTemps(t, dir)
	for _, paths := range [][2]string{{"invalid\x00", path}, {original, "invalid\x00"}} {
		if err := replaceFile(paths[0], paths[1]); err == nil {
			t.Errorf("accepted invalid path %q", paths)
		}
	}
}
