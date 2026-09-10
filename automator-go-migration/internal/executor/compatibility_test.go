//go:build unix

package executor

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
	"automator/internal/persistence"
	"automator/internal/worker"
)

func TestLegacyHomeSeedsMissingPresets(t *testing.T) {
	for _, usePreset := range []bool{false, true} {
		t.Run(strconv.FormatBool(usePreset), func(t *testing.T) {
			f := newFixture(t)
			draft := f.draft("qwen", "ordinary")
			draft.Heavy = true
			f.saveDraft(draft)
			path := filepath.Join(config.HomeDir(), "model-presets.yaml")
			must(t, os.Remove(path))
			selection := config.ModelSelection{Models: []string{"ordinary"}}
			if usePreset {
				selection = config.ModelSelection{Presets: []string{"open-models"}}
			}
			out, err := ValidateDraft(context.Background(), "example", selection)
			must(t, err)
			if !strings.Contains(out, "models:\n") || exists(f.runDir()) || exists(filepath.Join(f.events, "warmup")) {
				t.Fatal("legacy validation executed a run/tool")
			}
			var presets config.ModelPresetsFile
			must(t, persistence.LoadYAML(path, &presets))
			if got := presets.Presets["open-models"].Models; !reflect.DeepEqual(got, []string{"qwen"}) {
				t.Fatalf("wrong auto-seeded preset: %v", got)
			}
			must(t, os.Remove(path))
			must(t, RunDraft(context.Background(), "example", selection))
			snapshot, err := loadSnapshot(f.runDir())
			must(t, err)
			want := "ordinary"
			if usePreset {
				want = "qwen"
			}
			if _, ok := snapshot.Models[want]; !ok || len(snapshot.Models) != 1 {
				t.Fatalf("incorrect legacy selection: %v", snapshot.Models)
			}
		})
	}
}

func TestLegacyInitializationRejectsUnsafeKeysBeforeWrites(t *testing.T) {
	for _, bad := range []string{"explicit", "preset", "expanded", "draft", "template", "provider", "root", "reserved-case", "init-symlink", "root-lock-symlink"} {
		t.Run(bad, func(t *testing.T) {
			f := newFixture(t)
			draft := f.draft("qwen")
			selection := config.ModelSelection{Models: []string{"qwen"}}
			switch bad {
			case "explicit":
				selection.Models = []string{"../escape"}
			case "preset":
				selection = config.ModelSelection{Presets: []string{"../open-models"}}
			case "expanded":
				draft = f.draft("../qwen")
				selection = config.ModelSelection{Presets: []string{"open-models"}}
			case "draft":
				draft.Name = "../run"
			case "template":
				draft.Template = "../template"
			case "root":
				draft.Root = "bad\x00root"
			case "reserved-case":
				draft = f.draft(".AUTOMATOR")
				selection.Models = []string{".AUTOMATOR"}
			case "provider":
				models, err := config.Models()
				must(t, err)
				model := models.Models["qwen"]
				model.Provider = "../provider"
				models.Models["qwen"] = model
				must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
			case "init-symlink":
				path := filepath.Join(config.HomeDir(), ".init.lock")
				must(t, os.Remove(path))
				must(t, os.Symlink(filepath.Join(f.home, "untouched"), path))
			case "root-lock-symlink":
				must(t, os.Symlink(f.home, filepath.Join(f.root, ".automator-locks")))
			}
			f.saveDraft(draft)
			presets := filepath.Join(config.HomeDir(), "model-presets.yaml")
			must(t, os.Remove(presets))
			for _, run := range []bool{false, true} {
				var err error
				if run {
					err = RunDraft(context.Background(), "example", selection)
				} else {
					_, err = ValidateDraft(context.Background(), "example", selection)
				}
				if err == nil {
					t.Fatal("unsafe legacy config accepted")
				}
				if exists(presets) || exists(f.runDir()) || exists(filepath.Join(f.home, "untouched")) {
					t.Fatal("unsafe legacy initialization wrote files")
				}
				entries, err := os.ReadDir(f.events)
				must(t, err)
				if len(entries) != 0 {
					t.Fatal("unsafe config invoked tools")
				}
			}
		})
	}
}

func TestTrustedParentAliasesPreserveLifecycleAndIndexIdentity(t *testing.T) {
	f := newFixture(t)
	parentAlias := filepath.Join(f.home, "var-alias")
	must(t, os.Symlink(filepath.Dir(f.root), parentAlias))
	rootAlias := filepath.Join(parentAlias, "runs", "new", "nested")
	homeAlias := filepath.Join(f.home, "automator-alias")
	must(t, os.Symlink(config.HomeDir(), homeAlias))
	t.Setenv("AUTOMATOR_HOME", homeAlias)
	draft := f.draft("one", "two")
	draft.Heavy, draft.Root = true, rootAlias
	f.saveDraft(draft)
	must(t, os.Remove(filepath.Join(homeAlias, "model-presets.yaml")))
	must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"one", "two"}}))
	dirAlias := filepath.Join(rootAlias, "example-run")
	dir, err := filepath.EvalSymlinks(dirAlias)
	must(t, err)
	snapshot, err := loadSnapshot(dirAlias)
	must(t, err)
	if snapshot.RunDir != dir {
		t.Fatalf("snapshot not canonical: %s != %s", snapshot.RunDir, dir)
	}
	// Exercise historical snapshots and index entries retaining the alias.
	snapshot.RunDir = dirAlias
	must(t, persistence.SaveYAML(filepath.Join(dir, "run.yaml"), snapshot))
	index, err := config.LoadRunsIndex()
	must(t, err)
	aliasEntry := index.Runs[0]
	aliasEntry.Path = dirAlias
	index.Runs = append(index.Runs, aliasEntry)
	must(t, config.SaveRunsIndex(index))
	must(t, StartModel(context.Background(), dirAlias, "one", false))
	waitState(t, dir, "one", worker.Done)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	must(t, os.Remove(filepath.Join(f.events, "report-example-run")))
	must(t, RetryModel(context.Background(), dirAlias, "one", false))
	waitState(t, dir, "one", worker.Done)
	waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
	state, err := worker.LoadState(dir, "one")
	must(t, err)
	state.ProjectPath = filepath.Join(dirAlias, "one")
	must(t, worker.SaveState(dir, "one", state))
	must(t, DeleteModel(context.Background(), dirAlias, "one"))
	must(t, DeleteRun(context.Background(), dirAlias))
	if exists(dir) {
		t.Fatal("alias deletion left run files")
	}
	index, err = config.LoadRunsIndex()
	must(t, err)
	if len(index.Runs) != 0 {
		t.Fatal("alias deletion left duplicate index entries")
	}
	if got, want := NextRunDir(rootAlias, "Example Run"), filepath.Join(rootAlias, "example-run-v2"); got != want {
		t.Fatalf("tombstoned alias reused: %s != %s", got, want)
	}
}

func TestNextRunDirSkipsSymlinkCandidates(t *testing.T) {
	f := newFixture(t)
	alias := filepath.Join(f.home, "root-alias")
	must(t, os.Symlink(f.root, alias))
	must(t, os.Symlink(f.home, filepath.Join(f.root, "example-run")))
	must(t, os.Symlink(filepath.Join(f.home, "missing"), filepath.Join(f.root, "example-run-v2")))
	if got, want := NextRunDir(alias, "Example Run"), filepath.Join(alias, "example-run-v3"); got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestRelativeSnapshotsRemainUsableFromAnotherCWD(t *testing.T) {
	for _, relativeSnapshot := range []bool{false, true} {
		t.Run(strconv.FormatBool(relativeSnapshot), func(t *testing.T) {
			f := newFixture(t)
			origin := filepath.Dir(f.root)
			t.Chdir(origin)
			draft := f.draft("model")
			draft.Heavy, draft.Root = true, "runs"
			f.saveDraft(draft)
			must(t, RunDraft(context.Background(), "example", config.ModelSelection{Models: []string{"model"}}))
			if relativeSnapshot {
				snapshot, err := loadSnapshot(f.runDir())
				must(t, err)
				snapshot.RunDir = filepath.Join("runs", "example-run")
				must(t, persistence.SaveYAML(filepath.Join(f.runDir(), "run.yaml"), snapshot))
				state, err := worker.LoadState(f.runDir(), "model")
				must(t, err)
				state.ProjectPath = filepath.Join(snapshot.RunDir, "model")
				must(t, worker.SaveState(f.runDir(), "model", state))
			}
			t.Chdir(f.home)
			must(t, StartModel(context.Background(), f.runDir(), "model", false))
			waitState(t, f.runDir(), "model", worker.Done)
			waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
			must(t, os.Remove(filepath.Join(f.events, "report-example-run")))
			must(t, RetryModel(context.Background(), f.runDir(), "model", false))
			waitState(t, f.runDir(), "model", worker.Done)
			waitFor(t, func() bool { return exists(filepath.Join(f.events, "report-example-run")) })
			if err := DeleteRun(context.Background(), f.runDir()); err == nil {
				t.Fatal("deletion accepted unresolvable relative root")
			}
			t.Chdir(origin)
			must(t, DeleteRun(context.Background(), filepath.Join("runs", "example-run")))
		})
	}
}

func TestOpenCodeWarmupAcrossRootsDoesNotSerializeWorkers(t *testing.T) {
	f := newFixture(t)
	draft := f.draft("alpha", "beta")
	models, err := config.Models()
	must(t, err)
	for key, model := range models.Models {
		model.Tool = config.Opencode
		models.Models[key] = model
	}
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	for _, key := range []string{"alpha", "beta"} {
		draft.Root = filepath.Join(f.root, key)
		must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "drafts", key, "v1.yaml"), draft))
	}
	t.Setenv("EXECUTOR_TEST_WARMUP_DELAY", "200ms")
	t.Setenv("EXECUTOR_TEST_DELAY", "800ms")
	errs := make(chan error, 2)
	for _, key := range []string{"alpha", "beta"} {
		go func(key string) {
			errs <- RunDraft(context.Background(), key, config.ModelSelection{Models: []string{key}})
		}(key)
	}
	for i := 0; i < 2; i++ {
		must(t, <-errs)
	}
	if exists(filepath.Join(f.events, "warmup-overlap")) {
		t.Fatal("OpenCode initialization overlapped across roots")
	}
	stamp := func(name string) int64 {
		t.Helper()
		value, err := strconv.ParseInt(readText(t, filepath.Join(f.events, name)), 10, 64)
		must(t, err)
		return value
	}
	if stamp("alpha.start") >= stamp("beta.finish") || stamp("beta.start") >= stamp("alpha.finish") {
		t.Fatal("warmup lock serialized independent worker execution")
	}
}

func TestOpenCodeWarmupLockIsCancellable(t *testing.T) {
	f := newFixture(t)
	f.draft("model")
	models, err := config.Models()
	must(t, err)
	model := models.Models["model"]
	model.Tool = config.Opencode
	models.Models["model"] = model
	must(t, persistence.SaveYAML(filepath.Join(config.HomeDir(), "models.yaml"), models))
	unlock, err := persistence.Lock(context.Background(), filepath.Join(f.home, ".automator-opencode-warmup.lock"))
	must(t, err)
	defer unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if err := RunDraft(ctx, "example", config.ModelSelection{Models: []string{"model"}}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("warmup wait was not cancellable: %v", err)
	}
	if exists(f.runDir()) || exists(filepath.Join(f.events, "warmup")) {
		t.Fatal("cancelled warmup wait created run or invoked tool")
	}
}
