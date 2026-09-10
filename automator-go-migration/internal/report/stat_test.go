package report

import (
	"math"
	"path/filepath"
	"strings"
	"testing"

	"automator/internal/worker"
)

func TestStatFormatting(t *testing.T) {
	for _, test := range []struct {
		name, got, want string
	}{
		{"missing tokens", optUint(nil), ""},
		{"zero tokens", optUint(pointer(uint64(0))), "0"},
		{"max tokens", optUint(pointer(uint64(math.MaxUint64))), "18446744073709551615"},
		{"missing duration", fmtDuration(nil), ""},
		{"zero duration", fmtDuration(pointer(uint64(0))), "0m 0s"},
		{"seconds", fmtDuration(pointer(uint64(59))), "0m 59s"},
		{"minute", fmtDuration(pointer(uint64(60))), "1m 0s"},
		{"hours stay minutes", fmtDuration(pointer(uint64(3661))), "61m 1s"},
		{"max duration", fmtDuration(pointer(uint64(math.MaxUint64))), "307445734561825860m 15s"},
		{"missing cost", fmtCost(nil), ""},
		{"zero cost", fmtCost(pointer(0.0)), "$0.0000"},
		{"small cost", fmtCost(pointer(0.00001)), "$0.0000"},
		{"rounded cost", fmtCost(pointer(1.23456)), "$1.2346"},
		{"ties to even down", fmtCost(pointer(0.03125)), "$0.0312"},
		{"ties to even up", fmtCost(pointer(0.09375)), "$0.0938"},
		{"negative cost", fmtCost(pointer(-1.25)), "$-1.2500"},
		{"negative zero", fmtCost(pointer(math.Copysign(0, -1))), "$-0.0000"},
		{"large cost", fmtCost(pointer(1000000.5)), "$1000000.5000"},
		{"NaN", fmtCost(pointer(math.NaN())), "$NaN"},
		{"positive infinity", fmtCost(pointer(math.Inf(1))), "$inf"},
		{"negative infinity", fmtCost(pointer(math.Inf(-1))), "$-inf"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.got != test.want {
				t.Fatalf("got %q; want %q", test.got, test.want)
			}
		})
	}
}

func TestLegacyTokenLabels(t *testing.T) {
	for _, test := range []struct {
		name                 string
		input, cache, reason *uint64
		legacy               bool
	}{
		{"all absent", nil, nil, nil, false},
		{"legacy zero input", pointer(uint64(0)), nil, nil, true},
		{"legacy positive input", pointer(uint64(7)), nil, nil, true},
		{"cache zero is modern", pointer(uint64(7)), pointer(uint64(0)), nil, false},
		{"reasoning zero is modern", pointer(uint64(7)), nil, pointer(uint64(0)), false},
		{"separate fields without input", nil, pointer(uint64(2)), pointer(uint64(3)), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			runDir, _ := fixture(t)
			// A modern row must not mask a later legacy row. Cache writes alone
			// do not make the original input metric non-legacy.
			saveYAML(t, worker.StatePath(runDir, "a"), worker.State{
				Model: "a", Status: worker.Done, InputTokens: pointer(uint64(1)), CacheReadTokens: pointer(uint64(0)),
			})
			saveYAML(t, worker.StatePath(runDir, "z"), worker.State{
				Model: "z", Status: worker.Done, InputTokens: test.input, CacheReadTokens: test.cache,
				ReasoningTokens: test.reason, CacheWriteTokens: pointer(uint64(5)),
			})
			if err := Write(runDir); err != nil {
				t.Fatal(err)
			}
			md := readFile(t, filepath.Join(runDir, "report.md"))
			if strings.Contains(md, "| Input* |") != test.legacy ||
				strings.Contains(md, "| Input (cache miss) |") == test.legacy ||
				strings.Count(md, "\n* Legacy Input can include cache and reasoning tokens because the original state predates separate token fields.\n") != boolInt(test.legacy) {
				t.Fatalf("legacy label/footnote mismatch: %s", md)
			}
		})
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func TestStatuses(t *testing.T) {
	runDir, _ := fixture(t)
	for status, label := range map[worker.Status]string{
		worker.Queued: "Queued", worker.Paused: "Paused", worker.Running: "Running",
		worker.Done: "Done", worker.Failed: "Failed", worker.Cancelled: "Cancelled",
	} {
		saveYAML(t, worker.StatePath(runDir, label), worker.State{Model: label, Status: status})
	}
	if err := Write(runDir); err != nil {
		t.Fatal(err)
	}
	md := readFile(t, filepath.Join(runDir, "report.md"))
	previous := -1
	for _, label := range []string{"Cancelled", "Done", "Failed", "Paused", "Queued", "Running"} {
		index := strings.Index(md, "| "+label+" |  |  | "+label+" |")
		if index <= previous {
			t.Fatalf("missing, out-of-order or incorrectly cased status %s: %s", label, md)
		}
		previous = index
	}
}

func TestRelativeProjects(t *testing.T) {
	for _, test := range []struct{ base, path, want string }{
		{"/runs/demo", "/runs/demo/model", "./model"},
		{"/runs/demo", "/runs/demo", "./"},
		{"/runs/demo/", "/runs/demo/model", "./model"},
		{"/runs/demo", "/runs/demo-other/model", "/runs/demo-other/model"},
		{"/runs/demo", "/elsewhere/model", "/elsewhere/model"},
		{"/runs/demo", "model", "model"},
		{"/runs/demo", "", ""},
		{"runs/demo", "runs/demo/model", "./model"},
		{"runs/demo", "other/model", "other/model"},
		{"runs/demo", "/runs/demo/model", "/runs/demo/model"},
		{"/", "/runs/demo/model", "./runs/demo/model"},
		{".", "./model", "./model"},
		{".", "model", "model"},
		{"./runs/demo", "runs/demo/model", "runs/demo/model"},
		{"/runs/demo", "/runs//demo/./model//sub/./leaf/", "./model//sub/./leaf"},
		{"/runs/./demo", "/runs/demo/../other", "./../other"},
		{"/runs/demo/..", "/runs/other", "/runs/other"},
		{"/runs/demo", "/runs/demo/model/./", "./model"},
		{"", "a/model", "./a/model"},
		{"", "", "./"},
	} {
		t.Run(test.base+":"+test.path, func(t *testing.T) {
			if got := relativeProject(test.base, test.path); got != test.want {
				t.Fatalf("relativeProject(%q, %q) = %q; want %q", test.base, test.path, got, test.want)
			}
		})
	}
}
