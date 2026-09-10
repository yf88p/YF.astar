// Package model defines and validates versioned kanban boards.
package model

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type Task struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Priority    string    `json:"priority"`
	Tags        []string  `json:"tags"`
	Due         string    `json:"due,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Board struct {
	Version int    `json:"version"`
	Tasks   []Task `json:"tasks"`
}

func NewBoard() Board {
	return Board{Version: 1, Tasks: []Task{}}
}

func NewTask(title, description, priority string, tags []string, due string, now time.Time) (Task, error) {
	if err := validateText(title, false); err != nil {
		return Task{}, fmt.Errorf("title: %w", err)
	}
	normalized, err := NormalizeTags(tags)
	if err != nil {
		return Task{}, err
	}
	if priority == "" {
		priority = "medium"
	}
	var id [4]byte
	if _, err := rand.Read(id[:]); err != nil {
		return Task{}, fmt.Errorf("generate task ID: %w", err)
	}
	task := Task{
		ID:          hex.EncodeToString(id[:]),
		Title:       strings.TrimSpace(title),
		Description: description,
		Status:      "todo",
		Priority:    priority,
		Tags:        normalized,
		Due:         due,
		CreatedAt:   now.UTC(),
		UpdatedAt:   now.UTC(),
	}
	if err := ValidateTask(task); err != nil {
		return Task{}, err
	}
	return task, nil
}

func ValidateTask(task Task) error {
	if len(task.ID) != 8 {
		return fmt.Errorf("task ID must be 8 lowercase hexadecimal characters")
	}
	for _, c := range task.ID {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return fmt.Errorf("task ID must be 8 lowercase hexadecimal characters")
		}
	}
	if strings.TrimSpace(task.Title) == "" {
		return fmt.Errorf("title must not be blank")
	}
	if err := validateText(task.Title, false); err != nil {
		return fmt.Errorf("title: %w", err)
	}
	if err := validateText(task.Description, true); err != nil {
		return fmt.Errorf("description: %w", err)
	}
	if err := ValidateStatus(task.Status); err != nil {
		return err
	}
	if err := ValidatePriority(task.Priority); err != nil {
		return err
	}
	for i, tag := range task.Tags {
		if strings.TrimSpace(tag) == "" {
			return fmt.Errorf("tag %d must not be blank", i+1)
		}
		if err := validateText(tag, false); err != nil {
			return fmt.Errorf("tag %d: %w", i+1, err)
		}
	}
	if err := ValidateDue(task.Due); err != nil {
		return err
	}
	for _, stamp := range []struct {
		name string
		time time.Time
	}{{"created_at", task.CreatedAt}, {"updated_at", task.UpdatedAt}} {
		if stamp.time.IsZero() || stamp.time.Year() < 1 || stamp.time.Year() > 9999 ||
			stamp.time.UTC().Year() < 1 || stamp.time.UTC().Year() > 9999 {
			return fmt.Errorf("%s must be a nonzero timestamp in years 0001 through 9999, including in UTC", stamp.name)
		}
		if _, err := stamp.time.MarshalJSON(); err != nil {
			return fmt.Errorf("%s: %w", stamp.name, err)
		}
	}
	if task.UpdatedAt.Before(task.CreatedAt) {
		return fmt.Errorf("updated_at must not precede created_at")
	}
	return nil
}

func ValidateBoard(board Board) error {
	if board.Version != 1 {
		return fmt.Errorf("unsupported board version %d (want 1)", board.Version)
	}
	seen := make(map[string]struct{}, len(board.Tasks))
	for i, task := range board.Tasks {
		if err := ValidateTask(task); err != nil {
			return fmt.Errorf("task %d: %w", i+1, err)
		}
		if _, exists := seen[task.ID]; exists {
			return fmt.Errorf("duplicate task ID %q", task.ID)
		}
		seen[task.ID] = struct{}{}
	}
	return nil
}

func ValidateStatus(status string) error {
	switch status {
	case "todo", "doing", "done":
		return nil
	default:
		return fmt.Errorf("invalid status %q (want todo, doing, or done)", status)
	}
}

func ValidatePriority(priority string) error {
	switch priority {
	case "low", "medium", "high", "urgent":
		return nil
	default:
		return fmt.Errorf("invalid priority %q (want low, medium, high, or urgent)", priority)
	}
}

func ValidateDue(due string) error {
	if due == "" {
		return nil
	}
	date, err := time.Parse("2006-01-02", due)
	if err != nil || date.Year() < 1 || date.Format("2006-01-02") != due {
		return fmt.Errorf("invalid due date %q (want a real YYYY-MM-DD date)", due)
	}
	return nil
}

// NormalizeTags returns an independent, nonnil slice. Empty tags are rejected;
// duplicates are compared case-sensitively, preserving the first occurrence.
func NormalizeTags(tags []string) ([]string, error) {
	normalized := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for i, tag := range tags {
		if err := validateText(tag, false); err != nil {
			return nil, fmt.Errorf("tag %d: %w", i+1, err)
		}
		tag = strings.TrimSpace(tag)
		if tag == "" {
			return nil, fmt.Errorf("tag %d must not be blank", i+1)
		}
		if _, exists := seen[tag]; !exists {
			normalized = append(normalized, tag)
			seen[tag] = struct{}{}
		}
	}
	return normalized, nil
}

func validateText(text string, multiline bool) error {
	if !utf8.ValidString(text) {
		return fmt.Errorf("text must be valid UTF-8")
	}
	for _, c := range text {
		if unicode.IsControl(c) && !(multiline && (c == '\n' || c == '\t')) {
			return fmt.Errorf("text contains forbidden control character %U", c)
		}
	}
	return nil
}
