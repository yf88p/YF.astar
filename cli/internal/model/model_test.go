package model

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func validTask() Task {
	now := time.Date(2026, time.September, 7, 12, 30, 0, 123456789, time.UTC)
	return Task{
		ID: "0123abcd", Title: "Ship a feature", Description: "First line\n\tSecond line",
		Status: "todo", Priority: "medium", Tags: []string{"work"}, Due: "2028-02-29",
		CreatedAt: now, UpdatedAt: now,
	}
}

func TestNewBoard(t *testing.T) {
	board := NewBoard()
	if board.Version != 1 || board.Tasks == nil || len(board.Tasks) != 0 {
		t.Fatalf("NewBoard() = %#v, want version 1 and nonnil empty tasks", board)
	}
	if err := ValidateBoard(board); err != nil {
		t.Fatal(err)
	}
}

func TestNewTask(t *testing.T) {
	now := time.Date(2026, time.September, 7, 10, 15, 30, 123456789, time.FixedZone("local", -7*60*60))
	tags := []string{" work ", "work", "Work", "caf\u00e9"}
	original := append([]string(nil), tags...)
	task, err := NewTask("  Ship \u4e16\u754c  ", "Details\n\tPreserve whitespace  ", "", tags, "2028-02-29", now)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateTask(task); err != nil {
		t.Fatal(err)
	}
	if task.Title != "Ship \u4e16\u754c" || task.Description != "Details\n\tPreserve whitespace  " ||
		task.Status != "todo" || task.Priority != "medium" || task.Due != "2028-02-29" {
		t.Fatalf("unexpected defaults or normalization: %#v", task)
	}
	if !reflect.DeepEqual(task.Tags, []string{"work", "Work", "caf\u00e9"}) {
		t.Fatalf("normalized tags = %#v", task.Tags)
	}
	if !reflect.DeepEqual(tags, original) {
		t.Fatalf("input tags changed: %#v", tags)
	}
	if !task.CreatedAt.Equal(now) || !task.UpdatedAt.Equal(now) ||
		task.CreatedAt.Location() != time.UTC || task.UpdatedAt.Location() != time.UTC {
		t.Fatalf("timestamps did not preserve the instant in UTC: %#v", task)
	}
	tags[0] = "changed"
	if task.Tags[0] != "work" {
		t.Fatal("task shares caller's tag storage")
	}
	for _, priority := range []string{"low", "medium", "high", "urgent"} {
		task, err := NewTask("Title", "", priority, nil, "", now)
		if err != nil || task.Priority != priority || task.Tags == nil || len(task.Tags) != 0 {
			t.Fatalf("NewTask with priority %q: %#v, %v", priority, task, err)
		}
	}
}

func TestNewTaskRejectsInvalidInput(t *testing.T) {
	for _, test := range []struct {
		name, title, description, priority, due string
		tags                                    []string
		now                                     time.Time
	}{
		{name: "blank title", title: "  ", now: validTask().CreatedAt},
		{name: "title control before trimming", title: "\tTitle", now: validTask().CreatedAt},
		{name: "bad description", title: "Title", description: "\x1b[31m", now: validTask().CreatedAt},
		{name: "bad priority", title: "Title", priority: "critical", now: validTask().CreatedAt},
		{name: "bad date", title: "Title", due: "2026-02-29", now: validTask().CreatedAt},
		{name: "bad tag", title: "Title", tags: []string{"x\ny"}, now: validTask().CreatedAt},
		{name: "empty tag", title: "Title", tags: []string{"work", ""}, now: validTask().CreatedAt},
		{name: "whitespace tag", title: "Title", tags: []string{"work", "  "}, now: validTask().CreatedAt},
		{name: "Unicode whitespace tag", title: "Title", tags: []string{"work", "\u2003"}, now: validTask().CreatedAt},
		{name: "zero time", title: "Title"},
	} {
		t.Run(test.name, func(t *testing.T) {
			task, err := NewTask(test.title, test.description, test.priority, test.tags, test.due, test.now)
			if err == nil || !reflect.DeepEqual(task, Task{}) {
				t.Fatalf("got %#v, %v; want zero task and error", task, err)
			}
		})
	}
}

func TestValidateTask(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*Task)
	}{
		{"missing ID", func(v *Task) { v.ID = "" }},
		{"short ID", func(v *Task) { v.ID = "123abcd" }},
		{"long ID", func(v *Task) { v.ID = "01234abcd" }},
		{"uppercase ID", func(v *Task) { v.ID = "0123ABCd" }},
		{"nonhex ID", func(v *Task) { v.ID = "0123abcg" }},
		{"empty title", func(v *Task) { v.Title = "" }},
		{"blank title", func(v *Task) { v.Title = " \u2003 " }},
		{"title newline", func(v *Task) { v.Title = "a\nb" }},
		{"title tab", func(v *Task) { v.Title = "a\tb" }},
		{"title escape", func(v *Task) { v.Title = "a\x1b[31mb" }},
		{"title delete", func(v *Task) { v.Title = "a\x7fb" }},
		{"title C1", func(v *Task) { v.Title = "a\u009bb" }},
		{"title UTF8", func(v *Task) { v.Title = string([]byte{0xff}) }},
		{"description escape", func(v *Task) { v.Description = "a\x1bb" }},
		{"description carriage return", func(v *Task) { v.Description = "a\r\nb" }},
		{"description NUL", func(v *Task) { v.Description = "a\x00b" }},
		{"description C1", func(v *Task) { v.Description = "a\u0085b" }},
		{"description UTF8", func(v *Task) { v.Description = string([]byte{0xc0, 0xaf}) }},
		{"missing status", func(v *Task) { v.Status = "" }},
		{"unknown status", func(v *Task) { v.Status = "blocked" }},
		{"missing priority", func(v *Task) { v.Priority = "" }},
		{"unknown priority", func(v *Task) { v.Priority = "critical" }},
		{"empty tag", func(v *Task) { v.Tags = []string{"ok", ""} }},
		{"blank tag", func(v *Task) { v.Tags = []string{"ok", "  "} }},
		{"Unicode blank tag", func(v *Task) { v.Tags = []string{"ok", "\u2003"} }},
		{"tag tab", func(v *Task) { v.Tags = []string{"a\tb"} }},
		{"tag newline", func(v *Task) { v.Tags = []string{"a\nb"} }},
		{"tag escape", func(v *Task) { v.Tags = []string{"a\x1bb"} }},
		{"tag UTF8", func(v *Task) { v.Tags = []string{string([]byte{0xff})} }},
		{"impossible due", func(v *Task) { v.Due = "2026-02-29" }},
		{"zero created", func(v *Task) { v.CreatedAt = time.Time{} }},
		{"zero updated", func(v *Task) { v.UpdatedAt = time.Time{} }},
		{"updated before created", func(v *Task) { v.UpdatedAt = v.CreatedAt.Add(-time.Nanosecond) }},
		{"year zero", func(v *Task) { v.CreatedAt = time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC) }},
		{"year too large", func(v *Task) { v.UpdatedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC) }},
		{"UTC year zero", func(v *Task) { v.CreatedAt = time.Date(1, 1, 1, 0, 0, 0, 0, time.FixedZone("east", 3600)) }},
		{"UTC year too large", func(v *Task) { v.UpdatedAt = time.Date(9999, 12, 31, 23, 30, 0, 0, time.FixedZone("west", -3600)) }},
		{"invalid zone", func(v *Task) { v.UpdatedAt = v.UpdatedAt.In(time.FixedZone("bad", 24*60*60)) }},
	} {
		t.Run(test.name, func(t *testing.T) {
			task := validTask()
			test.change(&task)
			before := task
			before.Tags = append([]string(nil), task.Tags...)
			if err := ValidateTask(task); err == nil {
				t.Fatalf("accepted invalid task: %#v", task)
			}
			if !reflect.DeepEqual(before, task) {
				t.Fatal("validation mutated the task")
			}
		})
	}

	task := validTask()
	task.Title = "Unicode \u4e16\u754c \U0001f469\u200d\U0001f4bb " + strings.Repeat("x", 65536)
	task.Description += "\n\n" + strings.Repeat("more text\t", 10000)
	task.Tags = nil
	task.UpdatedAt = task.CreatedAt.In(time.FixedZone("same instant", 3600))
	if err := ValidateTask(task); err != nil {
		t.Fatalf("rejected valid Unicode, long text, nil tags, or equal timestamps: %v", err)
	}
}

func TestValidateEnumsAndDue(t *testing.T) {
	for _, status := range []string{"todo", "doing", "done"} {
		if err := ValidateStatus(status); err != nil {
			t.Errorf("ValidateStatus(%q): %v", status, err)
		}
	}
	for _, status := range []string{"", "Todo", "done ", "blocked", "todo\n"} {
		if ValidateStatus(status) == nil {
			t.Errorf("accepted status %q", status)
		}
	}
	for _, priority := range []string{"low", "medium", "high", "urgent"} {
		if err := ValidatePriority(priority); err != nil {
			t.Errorf("ValidatePriority(%q): %v", priority, err)
		}
	}
	for _, priority := range []string{"", "High", "Urgent", " low", "critical", "medium\t", "urgent "} {
		if ValidatePriority(priority) == nil {
			t.Errorf("accepted priority %q", priority)
		}
	}
	for _, due := range []string{"", "2000-02-29", "2028-02-29", "2026-04-30", "0001-01-01", "9999-12-31"} {
		if err := ValidateDue(due); err != nil {
			t.Errorf("ValidateDue(%q): %v", due, err)
		}
	}
	for _, due := range []string{" ", "2026-2-01", "2026-02-1", "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-10", "2026-01-00", "0000-01-01", "2026-01-01Z", "2026-01-01\n"} {
		if ValidateDue(due) == nil {
			t.Errorf("accepted due %q", due)
		}
	}
}

func TestNormalizeTags(t *testing.T) {
	for _, test := range []struct {
		name string
		in   []string
		want []string
	}{
		{"nil", nil, []string{}},
		{"empty", []string{}, []string{}},
		{"trim and deduplicate", []string{" a ", "b", "a", "B", " b ", "\u2003caf\u00e9\u2003"}, []string{"a", "b", "B", "caf\u00e9"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeTags(test.in)
			if err != nil || !reflect.DeepEqual(got, test.want) {
				t.Fatalf("NormalizeTags(%#v) = %#v, %v; want %#v", test.in, got, err, test.want)
			}
		})
	}
	for _, tag := range []string{"", " ", "\u2003"} {
		tags := []string{" work ", tag}
		before := append([]string(nil), tags...)
		got, err := NormalizeTags(tags)
		if err == nil || !strings.Contains(err.Error(), "tag 2 must not be blank") || got != nil {
			t.Errorf("NormalizeTags(%#v) = %#v, %v; want nil and a blank-tag error", tags, got, err)
		}
		if !reflect.DeepEqual(tags, before) {
			t.Errorf("failed normalization changed input: got %#v, want %#v", tags, before)
		}
	}
	for _, tag := range []string{"\t", "\nvalid", "a\rb", "a\x1bb", "a\u009bb", string([]byte{0xff})} {
		if _, err := NormalizeTags([]string{tag}); err == nil {
			t.Errorf("accepted invalid tag %q", tag)
		}
	}
}

func TestValidateBoard(t *testing.T) {
	task := validTask()
	for _, test := range []struct {
		name  string
		board Board
		valid bool
	}{
		{"empty", NewBoard(), true},
		{"nil tasks", Board{Version: 1}, true},
		{"one task", Board{Version: 1, Tasks: []Task{task}}, true},
		{"zero version", Board{Tasks: []Task{task}}, false},
		{"future version", Board{Version: 2, Tasks: []Task{task}}, false},
		{"invalid task", Board{Version: 1, Tasks: []Task{{}}}, false},
		{"duplicate ID", Board{Version: 1, Tasks: []Task{task, task}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateBoard(test.board); (err == nil) != test.valid {
				t.Fatalf("ValidateBoard() = %v, want valid=%v", err, test.valid)
			}
		})
	}
}
