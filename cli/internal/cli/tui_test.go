package cli

import (
	"reflect"
	"testing"

	"kanban/internal/model"
)

func TestTUICursorSelected(t *testing.T) {
	board := model.Board{Tasks: []model.Task{
		{ID: "00000001", Status: "todo"},
		{ID: "00000002", Status: "doing"},
		{ID: "00000003", Status: "todo"},
		{ID: "00000004", Status: "done"},
		{ID: "00000005", Status: "doing"},
	}}
	wantLanes := [3][]model.Task{
		{board.Tasks[0], board.Tasks[2]},
		{board.Tasks[1], board.Tasks[4]},
		{board.Tasks[3]},
	}
	for _, tt := range []struct {
		name string
		c    cursor
		want cursor
		id   string
	}{
		{"negative indices", cursor{-5, [3]int{-3, -2, -1}}, cursor{0, [3]int{}}, "00000001"},
		{"overflow indices", cursor{8, [3]int{99, 99, 99}}, cursor{2, [3]int{1, 1, 0}}, "00000004"},
		{"remember each lane", cursor{1, [3]int{1, 1, 0}}, cursor{1, [3]int{1, 1, 0}}, "00000005"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			selected, lanes := tt.c.selected(board)
			if selected == nil || selected.ID != tt.id || tt.c != tt.want {
				t.Fatalf("selected = %+v, cursor = %+v; want %s, %+v", selected, tt.c, tt.id, tt.want)
			}
			if !reflect.DeepEqual(lanes, wantLanes) {
				t.Fatalf("lane grouping/order = %+v; want %+v", lanes, wantLanes)
			}
		})
	}
	for _, tt := range []struct {
		name  string
		empty bool
	}{{"empty selected lane", false}, {"empty board", true}} {
		t.Run(tt.name, func(t *testing.T) {
			b := model.NewBoard()
			if !tt.empty {
				b.Tasks = []model.Task{board.Tasks[0], board.Tasks[2]}
			}
			c := cursor{1, [3]int{99, 99, -1}}
			selected, lanes := c.selected(b)
			want := cursor{1, [3]int{}}
			if !tt.empty {
				want.rows[0] = 1
			}
			if selected != nil || c != want || len(lanes[0]) != len(b.Tasks) || len(lanes[1])+len(lanes[2]) != 0 {
				t.Fatalf("selected = %+v, cursor = %+v, lanes = %+v; want nil, %+v", selected, c, lanes, want)
			}
		})
	}
}

func TestTUICursorFollow(t *testing.T) {
	board := model.Board{Tasks: []model.Task{
		{ID: "00000001", Status: "doing"},
		{ID: "00000002", Status: "done"},
		{ID: "00000003", Status: "todo"},
		{ID: "00000004", Status: "todo"},
		{ID: "00000005", Status: "doing"},
	}}
	c := cursor{0, [3]int{1, 1, 0}}
	board.Tasks[3].Status = "done"
	c.follow(board, "00000004")
	if want := (cursor{2, [3]int{0, 1, 1}}); c != want {
		t.Fatalf("follow moved task = %+v; want %+v", c, want)
	}
	// Reload can reorder tasks and remove the remembered row in another lane.
	board.Tasks = []model.Task{board.Tasks[3], board.Tasks[2], board.Tasks[1]}
	c.follow(board, "00000004")
	if want := (cursor{2, [3]int{0, 0, 0}}); c != want {
		t.Fatalf("follow reordered task = %+v; want %+v", c, want)
	}
	c.follow(board, "00000003")
	if want := (cursor{0, [3]int{}}); c != want {
		t.Fatalf("follow back to todo = %+v; want %+v", c, want)
	}
	c = cursor{2, [3]int{9, -1, 9}}
	c.follow(board, "missing")
	if want := (cursor{2, [3]int{0, 0, 1}}); c != want {
		t.Fatalf("missing ID must only clamp cursor: %+v; want %+v", c, want)
	}
	c.follow(model.NewBoard(), "00000004")
	if want := (cursor{2, [3]int{}}); c != want {
		t.Fatalf("follow on empty board = %+v; want %+v", c, want)
	}
}
