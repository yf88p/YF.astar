//go:build unix

package tests

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestRustReferenceParity(t *testing.T) {
	ref := os.Getenv("AUTOMATOR_RUST_REFERENCE")
	if ref == "" {
		ref = filepath.Join(moduleRoot, ".automator-reference", "automator-rust")
	}
	if !filepath.IsAbs(ref) {
		t.Fatal("AUTOMATOR_RUST_REFERENCE must be absolute, not resolved through fixture PATH")
	}
	info, err := os.Stat(ref)
	if errors.Is(err, os.ErrNotExist) {
		if os.Getenv("AUTOMATOR_REQUIRE_PARITY") == "1" {
			t.Fatalf("Rust reference required but absent: %s", ref)
		}
		t.Skipf("Rust reference absent: %s; set AUTOMATOR_REQUIRE_PARITY=1 in migration CI", ref)
	}
	if err != nil || info.IsDir() || info.Mode()&0111 == 0 {
		t.Fatalf("Rust reference is not executable: %s (%v)", ref, err)
	}
	for _, test := range append(append([]scenario{}, basicScenarios...), scenario{"opencode_sqlite_session_tree", openCodeScenario}, scenario{"continue_native_session_recovery", recoveryScenario}, scenario{"headful_heavy_herdr_fixture", herdrScenario}) {
		t.Run(test.name, func(t *testing.T) {
			var native, reference map[string]any
			goOK := t.Run("go", func(t *testing.T) { native = test.run(t, newFixture(t, goBinary)) })
			rustOK := t.Run("rust", func(t *testing.T) { reference = test.run(t, newFixture(t, ref)) })
			if goOK && rustOK {
				compareParity(t, native, reference)
			}
		})
	}
	for _, test := range invalidCases() {
		t.Run("validation/"+test.name, func(t *testing.T) {
			var native, reference map[string]any
			goOK := t.Run("go", func(t *testing.T) { native = validationFailure(t, newFixture(t, goBinary), test) })
			rustOK := t.Run("rust", func(t *testing.T) { reference = validationFailure(t, newFixture(t, ref), test) })
			if goOK && rustOK {
				compareParity(t, native, reference)
			}
		})
	}
	t.Run("cli-exit-classes", func(t *testing.T) {
		compareParity(t, cliScenario(t, newFixture(t, goBinary)), cliScenario(t, newFixture(t, ref)))
	})
}

func compareParity(t *testing.T, native, reference map[string]any) {
	t.Helper()
	if reflect.DeepEqual(native, reference) {
		return
	}
	keys := make(map[string]bool)
	for key := range native {
		keys[key] = true
	}
	for key := range reference {
		keys[key] = true
	}
	names := make([]string, 0, len(keys))
	for key := range keys {
		names = append(names, key)
	}
	sort.Strings(names)
	for _, key := range names {
		if !reflect.DeepEqual(native[key], reference[key]) {
			goJSON, _ := json.MarshalIndent(native[key], "", "  ")
			rustJSON, _ := json.MarshalIndent(reference[key], "", "  ")
			t.Errorf("semantic parity failure in %s\nGo:\n%s\nRust:\n%s", key, goJSON, rustJSON)
		}
	}
}

func (f *fixture) capture(runs ...string) map[string]any {
	f.t.Helper()
	obs := map[string]any{"runs-index": f.normalize(f.yaml(filepath.Join(f.app, "runs-index.yaml")), "")}
	for _, run := range runs {
		dir := filepath.Join(f.root, run)
		obs[run+"/run.yaml"] = f.normalize(f.yaml(filepath.Join(dir, "run.yaml")), "")
		obs[run+"/prompt.md"] = f.text(filepath.Join(dir, "prompt.md"))
		entries, err := os.ReadDir(filepath.Join(dir, ".automator", "state"))
		if err != nil {
			f.t.Fatal(err)
		}
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".yaml") {
				obs[run+"/state/"+entry.Name()] = f.normalize(f.yaml(filepath.Join(dir, ".automator", "state", entry.Name())), "")
			}
		}
		obs[run+"/report.md"] = f.report(f.text(filepath.Join(dir, "report.md")))
	}
	return obs
}

func (f *fixture) normalize(value any, field string) any {
	if value == nil {
		// serde and yaml.v3 differ only in empty collection serialization.
		switch field {
		case "pre", "post_each", "post_all", "steps":
			return []any{}
		case "args":
			return map[string]any{}
		}
		return nil
	}
	switch field {
	case "started_at", "finished_at":
		return "<timestamp>"
	case "duration_seconds":
		return "<duration>"
	}
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, child := range v {
			if key == "error" && child != nil {
				// Keep the outcome and known agent exit status, not Rust/Go's
				// different wrapping of the same subprocess error.
				out[key] = fmt.Sprint(v["status"])
				if strings.Contains(fmt.Sprint(child), "42") {
					out[key] = "agent-exit-42"
				}
			} else {
				out[key] = f.normalize(child, key)
			}
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, child := range v {
			out[i] = f.normalize(child, "")
		}
		return out
	case string:
		return strings.ReplaceAll(v, f.dir, "<fixture>")
	default:
		return value
	}
}

func (f *fixture) report(text string) any {
	var rows []any
	var reopen []string
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "| ") && !strings.HasPrefix(line, "| Model |") {
			cells := strings.Split(strings.Trim(line, "|"), "|")
			for i := range cells {
				cells[i] = strings.TrimSpace(cells[i])
			}
			if len(cells) != 14 {
				f.t.Fatalf("unexpected report row: %s", line)
			}
			cells[3] = strings.ToLower(cells[3])
			if cells[4] != "" {
				cells[4] = "<duration>"
			}
			rows = append(rows, cells)
		}
		if strings.HasPrefix(line, "- ") || strings.HasPrefix(line, "# ") {
			reopen = append(reopen, strings.ReplaceAll(line, f.dir, "<fixture>"))
		}
	}
	return map[string]any{"rows": rows, "reopen": reopen}
}

func exitClass(code int) string {
	switch {
	case code == 0:
		return "success"
	case code == 2:
		return "usage"
	case code == 130 || code == 143 || code < 0:
		return "interrupted"
	default:
		return "failure"
	}
}

func errorClass(text string) string {
	lower := strings.ToLower(text)
	for _, key := range []string{"no models selected", "unsafe model preset key", "unsafe model key", "model preset not found", "model not found", "provider not found", "template not found", "schema_version", "unsupported tool arg", "finite non-negative", "run not found", "native session", "already running"} {
		if strings.Contains(lower, key) {
			return key
		}
	}
	if strings.Contains(lower, "tool") || strings.Contains(lower, "variant") {
		return "invalid-tool"
	}
	return "invalid-input"
}

func (f *fixture) output(r result, verb string) any {
	obs := map[string]any{"exit": exitClass(r.code)}
	if r.code != 0 {
		obs["error"] = errorClass(r.stderr)
		return obs
	}
	if verb == "report" {
		obs["report"] = f.report(r.stdout)
		return obs
	}
	var lines []string
	for _, raw := range strings.Split(r.stdout, "\n") {
		line := strings.TrimSpace(strings.ReplaceAll(raw, f.dir, "<fixture>"))
		if line == "" {
			continue
		}
		if verb == "validate" {
			// Commands are verified as real argv by native runs, not by their
			// display-only shell quoting. Keep selection, mode and binary checks.
			if strings.HasPrefix(line, "command:") || strings.HasPrefix(line, "reopen:") {
				continue
			}
			if strings.HasPrefix(line, "mode:") {
				line = strings.ToLower(line)
			}
			lines = append(lines, line)
		} else if verb == "models" || verb == "presets" {
			lines = append(lines, strings.ToLower(strings.Join(strings.Fields(line), " ")))
		} else {
			for _, prefix := range []string{"run complete:", "heavy run created paused:", "start one model:", "report:", "started ", "retry started ", "continue started "} {
				if strings.HasPrefix(line, prefix) {
					lines = append(lines, line)
				}
			}
		}
	}
	obs["stdout"] = lines
	return obs
}

func cliScenario(t *testing.T, f *fixture) map[string]any {
	obs := map[string]any{}
	for _, args := range [][]string{{"--help"}, {"run", "--help"}, {"not-a-command"}, {"run"}, {"start", "missing"}, {"validate", "missing", "--unknown"}, {"report", "missing"}} {
		r := f.run(args...)
		wantSuccess := args[len(args)-1] == "--help"
		if (r.code == 0) != wantSuccess {
			t.Errorf("%v: %s", args, r)
		}
		obs[strings.Join(args, " ")] = map[string]any{"exit": exitClass(r.code), "has-output": r.stdout != "" || r.stderr != ""}
	}
	f.exists(filepath.Join(f.dir, "agent-calls"), false)
	return obs
}

func TestNativeCLIExitClasses(t *testing.T) {
	cliScenario(t, newFixture(t, goBinary))
}
