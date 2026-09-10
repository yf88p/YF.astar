//go:build unix

package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Run with -v to show reproducible, credential-free CLI demonstrations.
func TestCLICompatibilityDemonstrations(t *testing.T) {
	demonstrate := func(t *testing.T, binary string) map[string]any {
		f := newFixture(t, binary)
		f.models("alpha-pi", "beta-pi")
		f.draft("demo", "Demo Run", "")
		f.write(filepath.Join(f.app, "model-presets.yaml"), "schema_version: 1\npresets:\n  comparison:\n    display_name: Comparison\n    models: [alpha-pi, beta-pi]\n")
		observed := map[string]any{}
		for _, args := range [][]string{{"--help"}, {"models"}, {"presets"}, {"validate", "demo", "--preset", "comparison", "--model", "alpha-pi"}} {
			r := f.ok(args...)
			t.Logf("automator %s\n%s", strings.Join(args, " "), strings.ReplaceAll(r.stdout, f.dir, "<fixture>"))
			if args[0] == "--help" {
				for _, command := range []string{"tui", "run", "validate", "attach", "start", "retry", "stop", "continue", "report", "models", "presets", "reprice", "init"} {
					if !strings.Contains(r.stdout, command) {
						t.Errorf("help is missing %s", command)
					}
				}
			} else {
				observed[args[0]] = f.output(r, args[0])
			}
		}
		f.exists(f.root, false)
		f.exists(filepath.Join(f.dir, "agent-calls"), false)
		return observed
	}
	var native, reference map[string]any
	t.Run("Go", func(t *testing.T) { native = demonstrate(t, goBinary) })
	ref := os.Getenv("AUTOMATOR_RUST_REFERENCE")
	if ref == "" {
		ref = filepath.Join(moduleRoot, ".automator-reference", "automator-rust")
	}
	if _, err := os.Stat(ref); os.IsNotExist(err) && os.Getenv("AUTOMATOR_REQUIRE_PARITY") != "1" {
		t.Log("Optional Rust reference absent; native demonstrations passed")
		return
	}
	t.Run("Rust", func(t *testing.T) { reference = demonstrate(t, ref) })
	compareParity(t, native, reference)
}
