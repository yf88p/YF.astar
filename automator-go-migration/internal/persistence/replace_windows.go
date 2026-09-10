package persistence

import (
	"fmt"

	"golang.org/x/sys/windows"
)

func replaceFile(tmp, path string) error {
	from, err := windows.UTF16PtrFromString(tmp)
	if err != nil {
		return fmt.Errorf("atomic rename %s: %w", path, err)
	}
	to, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return fmt.Errorf("atomic rename %s: %w", path, err)
	}
	// Windows cannot fsync a directory handle opened by os.Open. Request a
	// write-through rename instead; omit COPY_ALLOWED to prevent copy/delete.
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return fmt.Errorf("atomic rename %s: %w", path, err)
	}
	return nil
}
