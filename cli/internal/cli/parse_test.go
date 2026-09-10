package cli

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseOptionsAndPositionals(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		command string
		args    []string
		flags   map[string][]string
	}{
		{"empty", nil, "", nil, map[string][]string{}},
		{"all add fields after title", []string{"add", "Ship API", "--desc", "two words", "--priority", "urgent", "--tag", "backend", "--tag=release", "--due=2028-02-29"}, "add", []string{"Ship API"}, map[string][]string{"desc": {"two words"}, "priority": {"urgent"}, "tag": {"backend", "release"}, "due": {"2028-02-29"}}},
		{"interspersed title", []string{"add", "--tag=first", "Title", "--tag", "second", "--tag=first"}, "add", []string{"Title"}, map[string][]string{"tag": {"first", "second", "first"}}},
		{"flags after id", []string{"edit", "a1b2c3d4", "--title=new title", "--desc=", "--due", "", "--clear-tags"}, "edit", []string{"a1b2c3d4"}, map[string][]string{"title": {"new title"}, "desc": {""}, "due": {""}, "clear-tags": {"true"}}},
		{"db before command", []string{"--db", "some board.json", "move", "a1b2c3d4", "doing"}, "move", []string{"a1b2c3d4", "doing"}, map[string][]string{"db": {"some board.json"}}},
		{"db after command", []string{"move", "--db=board.json", "a1b2c3d4", "doing"}, "move", []string{"a1b2c3d4", "doing"}, map[string][]string{"db": {"board.json"}}},
		{"db between positionals", []string{"move", "a1b2c3d4", "--db", "board.json", "doing"}, "move", []string{"a1b2c3d4", "doing"}, map[string][]string{"db": {"board.json"}}},
		{"db after positionals", []string{"move", "a1b2c3d4", "doing", "--db=board.json"}, "move", []string{"a1b2c3d4", "doing"}, map[string][]string{"db": {"board.json"}}},
		{"literal title", []string{"add", "--priority=low", "--", "--db=not-a-path"}, "add", []string{"--db=not-a-path"}, map[string][]string{"priority": {"low"}}},
		{"delimiter stays literal", []string{"add", "--", "--help", "--", "-y"}, "add", []string{"--help", "--", "-y"}, map[string][]string{}},
		{"flag values via equals", []string{"add", "Title", "--desc=--db", "--tag=--help", "--tag=-y", "--db=--literal.json"}, "add", []string{"Title"}, map[string][]string{"desc": {"--db"}, "tag": {"--help", "-y"}, "db": {"--literal.json"}}},
		{"equals preserved in value", []string{"add", "Title", "--desc=a=b=c"}, "add", []string{"Title"}, map[string][]string{"desc": {"a=b=c"}}},
		{"stdin positional", []string{"import", "-"}, "import", []string{"-"}, map[string][]string{}},
		{"short help", []string{"add", "-h"}, "add", nil, map[string][]string{"help": {"true"}}},
		{"short yes", []string{"delete", "a1b2c3d4", "-y"}, "delete", []string{"a1b2c3d4"}, map[string][]string{"yes": {"true"}}},
		{"false bool", []string{"delete", "--yes=false", "a1b2c3d4"}, "delete", []string{"a1b2c3d4"}, map[string][]string{"yes": {"false"}}},
		{"global help before command", []string{"--help", "add"}, "add", nil, map[string][]string{"help": {"true"}}},
		{"version", []string{"--version"}, "", nil, map[string][]string{"version": {"true"}}},
		{"filters", []string{"list", "--tag", "a", "--status=doing", "--tag=b"}, "list", nil, map[string][]string{"tag": {"a", "b"}, "status": {"doing"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parse(tt.input)
			if err != nil {
				t.Fatal(err)
			}
			want := invocation{command: tt.command, args: tt.args, flags: tt.flags}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("parse(%q) = %#v; want %#v", tt.input, got, want)
			}
			for name, values := range tt.flags {
				if !got.has(name) || got.value(name) != values[0] || got.enabled(name) != (values[0] == "true") {
					t.Errorf("flag accessors disagree for %q: %#v", name, got)
				}
			}
			if got.has("absent") || got.value("absent") != "" || got.enabled("absent") {
				t.Error("absent flag must be unset, empty, and disabled")
			}
		})
	}
}

func TestParseRejectsInvalidOptions(t *testing.T) {
	tests := []struct {
		name  string
		input []string
		want  string
	}{
		{"unknown command", []string{"frobnicate"}, "unknown command"},
		{"unknown long flag", []string{"add", "Title", "--bogus"}, "unknown option"},
		{"unknown short flag", []string{"list", "-z"}, "unknown option"},
		{"command flag before command", []string{"--priority=high", "add", "Title"}, "unknown option"},
		{"flag on wrong command", []string{"list", "--priority=low"}, "unknown option"},
		{"yes on wrong command", []string{"done", "a1b2c3d4", "-y"}, "unknown option"},
		{"duplicate value", []string{"add", "Title", "--priority=low", "--priority", "high"}, "may only be specified once"},
		{"duplicate db across command", []string{"--db=a.json", "list", "--db=b.json"}, "may only be specified once"},
		{"duplicate bool aliases", []string{"delete", "a1b2c3d4", "--yes=false", "-y"}, "may only be specified once"},
		{"duplicate help aliases", []string{"--help", "add", "-h"}, "may only be specified once"},
		{"invalid bool", []string{"delete", "a1b2c3d4", "--yes=maybe"}, "expects true or false"},
		{"empty bool", []string{"--help="}, "expects true or false"},
		{"missing trailing value", []string{"add", "Title", "--due"}, "requires a value"},
		{"missing repeated value", []string{"add", "Title", "--tag=a", "--tag"}, "requires a value"},
		{"missing db", []string{"--db"}, "requires a value"},
		{"empty db", []string{"list", "--db="}, "nonempty file path"},
		{"blank db", []string{"--db", " \t ", "list"}, "nonempty file path"},
		{"value is another option", []string{"add", "Title", "--desc", "--db", "other.json"}, "requires a value"},
		{"value is delimiter", []string{"add", "Title", "--desc", "--", "literal"}, "requires a value"},
		{"value is short help", []string{"add", "Title", "--desc", "-h"}, "requires a value"},
		{"value is short yes", []string{"add", "Title", "--desc", "-y"}, "requires a value"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := parse(tt.input); err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("parse(%q) error = %v; want %q", tt.input, err, tt.want)
			}
		})
	}
}
