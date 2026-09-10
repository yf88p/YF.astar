package util

import "testing"

func TestWindowsPathComponentsRejectVolumes(t *testing.T) {
	for _, path := range []string{"C:", "c:relative", "Z:..", `C:\absolute`, `\\server\share`, `\\?\C:\path`, `\\.\C:\path`} {
		if IsSafePathComponent(path) {
			t.Errorf("accepted Windows volume path %q", path)
		}
	}
}
