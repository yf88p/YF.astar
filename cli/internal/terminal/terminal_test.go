package terminal

import (
	"os"
	"testing"
)

func TestNonTerminals(t *testing.T) {
	regular, err := os.CreateTemp(t.TempDir(), "not-a-terminal")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { regular.Close() })
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reader.Close(); writer.Close() })
	null, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { null.Close() })
	closed, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatal(err)
	}
	closed.Close()
	for name, file := range map[string]*os.File{"nil": nil, "file": regular, "pipe reader": reader, "pipe writer": writer, "null device": null, "closed": closed} {
		t.Run(name, func(t *testing.T) {
			if IsTerminal(file) {
				t.Error("non-TTY reported as terminal")
			}
			if w, h := Size(file); w != 80 || h != 24 {
				t.Errorf("Size = %d,%d, want 80,24", w, h)
			}
			if restore, err := Raw(file); err == nil || restore != nil {
				t.Errorf("Raw = (%v, %v), want nil restore and an error", restore != nil, err)
			}
		})
	}
}
