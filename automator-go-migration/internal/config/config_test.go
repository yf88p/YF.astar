package config

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"automator/internal/persistence"
	"go.yaml.in/yaml/v3"
)

const minimalDraft = "schema_version: 1\nname: example\nroot: ~/runs\ntemplate: empty\nprompt: hello\n"
const minimalModel = "display_name: Example\ntool: pi\nprovider: external\nmodel: example-v1\n"
const minimalSnapshot = "schema_version: 1\nname: example\nroot: ~/runs\nrun_dir: /not-accessed/run\nconcurrency: 3\nmode: headless\ntemplate: {display_name: Empty}\ntemplate_key: empty\nmodels: {}\nprompt: hello\n"

func isolatedHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	home = filepath.Join(home, "automator")
	t.Setenv("AUTOMATOR_HOME", home)
	return home
}

func writeTestFile(t *testing.T, path, data string) {
	t.Helper()
	if err := persistence.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestSchemasRequireFields(t *testing.T) {
	for _, test := range []struct {
		name     string
		out      any
		input    string
		required []string
	}{
		{"app", &AppConfig{}, "schema_version: 1\n", []string{"schema_version"}},
		{"providers", &ProvidersFile{}, "schema_version: 1\n", []string{"schema_version"}},
		{"provider", &Provider{}, "display_name: External\n", []string{"display_name"}},
		{"models", &ModelsFile{}, "schema_version: 1\n", []string{"schema_version"}},
		{"model", &Model{}, minimalModel, []string{"display_name", "tool", "provider", "model"}},
		{"pricing", &ModelPricing{}, "input_per_million: 1\noutput_per_million: 2\ncache_read_per_million: 0\ncache_write_per_million: 0.5\n", []string{"input_per_million", "output_per_million", "cache_read_per_million", "cache_write_per_million"}},
		{"presets", &ModelPresetsFile{}, "schema_version: 1\n", []string{"schema_version"}},
		{"preset", &ModelPreset{}, "display_name: Open\n", []string{"display_name"}},
		{"templates", &TemplatesFile{}, "schema_version: 1\n", []string{"schema_version"}},
		{"template", &Template{}, "display_name: Empty\n", []string{"display_name"}},
		{"step", &ShellStep{}, "shell: echo ok\n", []string{"shell"}},
		{"draft", &DraftRun{}, minimalDraft, []string{"schema_version", "name", "root", "template", "prompt"}},
		{"index", &RunsIndex{}, "schema_version: 1\n", []string{"schema_version"}},
		{"entry", &RunIndexEntry{}, "name: example\npath: /not-accessed/run\nstarted_at: '2026-01-01T00:00:00Z'\nmode: headless\n", []string{"name", "path", "started_at", "mode"}},
		{"snapshot", &RunSnapshot{}, minimalSnapshot, []string{"schema_version", "name", "root", "run_dir", "concurrency", "mode", "template", "template_key", "models", "prompt"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			fresh := func() any { return reflect.New(reflect.TypeOf(test.out).Elem()).Interface() }
			if err := yaml.Unmarshal([]byte(test.input), fresh()); err != nil {
				t.Fatalf("valid schema: %v", err)
			}
			if err := yaml.Unmarshal([]byte(test.input+"future_field: {unknown: [anything]}\n"), fresh()); err != nil {
				t.Fatalf("unknown field: %v", err)
			}
			if err := yaml.Unmarshal([]byte("[]"), fresh()); err == nil {
				t.Error("accepted sequence instead of mapping")
			}
			for _, field := range test.required {
				t.Run(field, func(t *testing.T) {
					var fields map[string]any
					if err := yaml.Unmarshal([]byte(test.input), &fields); err != nil {
						t.Fatal(err)
					}
					delete(fields, field)
					data, err := yaml.Marshal(fields)
					if err != nil {
						t.Fatal(err)
					}
					if err := yaml.Unmarshal(data, fresh()); err == nil || !strings.Contains(err.Error(), field) {
						t.Errorf("missing %s error = %v", field, err)
					}
					fields[field] = nil
					data, err = yaml.Marshal(fields)
					if err != nil {
						t.Fatal(err)
					}
					if err := yaml.Unmarshal(data, fresh()); err == nil || !strings.Contains(err.Error(), field) {
						t.Errorf("null %s error = %v", field, err)
					}
				})
			}
		})
	}
}

func TestSchemaDefaultsAndExplicitValues(t *testing.T) {
	var app AppConfig
	if err := yaml.Unmarshal([]byte("schema_version: 1"), &app); err != nil || app.DefaultConcurrency != 6 {
		t.Fatalf("app defaults: %#v, %v", app, err)
	}
	var provider Provider
	if err := yaml.Unmarshal([]byte("display_name: External"), &provider); err != nil || provider.Auth != "external" {
		t.Fatalf("provider defaults: %#v, %v", provider, err)
	}
	var model Model
	if err := yaml.Unmarshal([]byte(minimalModel), &model); err != nil || model.Args == nil || model.Pricing != nil {
		t.Fatalf("model defaults: %#v, %v", model, err)
	}
	var draft DraftRun
	if err := yaml.Unmarshal([]byte(minimalDraft), &draft); err != nil {
		t.Fatal(err)
	}
	if draft.Concurrency != 6 || draft.Mode != Headful || draft.Heavy || draft.Pre == nil || draft.PostEach == nil || draft.PostAll == nil {
		t.Errorf("draft defaults: %#v", draft)
	}
	if err := yaml.Unmarshal([]byte(minimalDraft+"concurrency: 0\nmode: headless\nheavy: true\npre: [{shell: 'echo pre'}]\npost_each: [{shell: 'echo each'}]\npost_all: [{shell: 'echo all'}]\n"), &draft); err != nil {
		t.Fatal(err)
	}
	if draft.Concurrency != 0 || draft.Mode != Headless || !draft.Heavy || draft.Pre[0].Shell != "echo pre" || draft.PostEach[0].Shell != "echo each" || draft.PostAll[0].Shell != "echo all" {
		t.Errorf("draft explicit values: %#v", draft)
	}
	var snapshot RunSnapshot
	if err := yaml.Unmarshal([]byte(minimalSnapshot), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.HerdrSession != "Automator" || snapshot.TmuxSession != "" || snapshot.HerdrWorkspaceLabel != "" || snapshot.HerdrWorkspaceID != nil || snapshot.HerdrRootTabID != nil || snapshot.HerdrRootPaneID != nil || snapshot.Heavy || snapshot.Pre == nil || snapshot.PostEach == nil || snapshot.PostAll == nil {
		t.Errorf("snapshot defaults: %#v", snapshot)
	}
	if err := yaml.Unmarshal([]byte(minimalSnapshot+"herdr_session: ''\nherdr_workspace_id: null\nherdr_root_tab_id: ''\nherdr_root_pane_id: '1-2'\n"), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.HerdrSession != "" || snapshot.HerdrWorkspaceID != nil || snapshot.HerdrRootTabID == nil || *snapshot.HerdrRootTabID != "" || snapshot.HerdrRootPaneID == nil || *snapshot.HerdrRootPaneID != "1-2" {
		t.Errorf("snapshot nullable values: %#v", snapshot)
	}
	if err := yaml.Unmarshal([]byte("display_name: ''\nauth: ''\n"), &provider); err != nil || provider.DisplayName != "" || provider.Auth != "" {
		t.Errorf("empty strings are values: %#v, %v", provider, err)
	}
	for _, out := range []any{&ProvidersFile{}, &ModelsFile{}, &ModelPresetsFile{}, &TemplatesFile{}, &RunsIndex{}} {
		if err := yaml.Unmarshal([]byte("schema_version: 1\n"), out); err != nil {
			t.Fatal(err)
		}
		if reflect.ValueOf(out).Elem().Field(1).IsNil() {
			t.Errorf("nil default collection: %T", out)
		}
	}
	for _, out := range []any{&Template{}, &ModelPreset{}} {
		if err := yaml.Unmarshal([]byte("display_name: Test\n"), out); err != nil {
			t.Fatal(err)
		}
		if reflect.ValueOf(out).Elem().Field(1).IsNil() {
			t.Errorf("nil default collection: %T", out)
		}
	}
}

func TestRejectInvalidFields(t *testing.T) {
	for _, test := range []struct {
		input string
		out   any
	}{
		{"schema_version: -1", &AppConfig{}},
		{"schema_version: 4294967296", &AppConfig{}},
		{"schema_version: 1.5", &AppConfig{}},
		{"schema_version: '1'", &AppConfig{}},
		{"schema_version: 1\ndefault_concurrency: -1", &AppConfig{}},
		{"schema_version: 1\ndefault_concurrency: 1.5", &AppConfig{}},
		{"schema_version: 1\ndefault_concurrency: null", &AppConfig{}},
		{"display_name: External\nauth: null", &Provider{}},
		{"schema_version: 1\nproviders: null", &ProvidersFile{}},
		{"schema_version: 1\nproviders: {bad: null}", &ProvidersFile{}},
		{"schema_version: 1\nmodels: {bad: {tool: pi}}", &ModelsFile{}},
		{"schema_version: 1\nmodels: {bad: null}", &ModelsFile{}},
		{"display_name: Test\nmodels: [null]", &ModelPreset{}},
		{"display_name: Test\nsteps: [null]", &Template{}},
		{"display_name: Test\nsteps: [{}]", &Template{}},
		{minimalModel + "pricing: {input_per_million: 1}", &Model{}},
		{"input_per_million: '1'\noutput_per_million: 2\ncache_read_per_million: 0\ncache_write_per_million: 0", &ModelPricing{}},
		{minimalModel + "args: null", &Model{}},
		{minimalDraft + "concurrency: -1", &DraftRun{}},
		{minimalDraft + "mode: null", &DraftRun{}},
		{minimalDraft + "heavy: null", &DraftRun{}},
		{minimalDraft + "heavy: yes", &DraftRun{}},
		{minimalDraft + "heavy: 'true'", &DraftRun{}},
		{minimalDraft + "pre: null", &DraftRun{}},
		{minimalSnapshot + "herdr_session: null", &RunSnapshot{}},
		{strings.Replace(minimalSnapshot, "concurrency: 3", "concurrency: -1", 1), &RunSnapshot{}},
		{"schema_version: 1\nruns: [null]", &RunsIndex{}},
	} {
		t.Run(fmt.Sprintf("%T/%s", test.out, strings.ReplaceAll(test.input, "\n", ";")), func(t *testing.T) {
			if err := yaml.Unmarshal([]byte(test.input), test.out); err == nil {
				t.Errorf("accepted invalid input %q", test.input)
			}
		})
	}
	for _, value := range []string{"Pi", "unknown", "''", "[]", "{}", "42"} {
		var tool Tool
		if err := yaml.Unmarshal([]byte(value), &tool); err == nil {
			t.Errorf("accepted tool %s", value)
		}
	}
	for _, value := range []string{"Headful", "unknown", "''", "[]", "{}", "42"} {
		var mode RunMode
		if err := yaml.Unmarshal([]byte(value), &mode); err == nil {
			t.Errorf("accepted mode %s", value)
		}
	}
	for _, value := range []Tool{Pi, Opencode, Claude} {
		var tool Tool
		if err := yaml.Unmarshal([]byte(value), &tool); err != nil || tool != value {
			t.Errorf("valid tool %s: %v", value, err)
		}
	}
}

func TestPricingAndArgsRoundTrip(t *testing.T) {
	var model Model
	input := minimalModel + "pricing:\n  input_per_million: 1.25\n  output_per_million: 3.5\n  cache_read_per_million: 0\n  cache_write_per_million: 0.75\nargs:\n  count: 4\n  enabled: true\n  text: 'yes'\n  nothing: null\n  list: [a, 2]\n  nested: {key: value}\n"
	if err := yaml.Unmarshal([]byte(input), &model); err != nil {
		t.Fatal(err)
	}
	if model.Pricing == nil || *model.Pricing != (ModelPricing{1.25, 3.5, 0, 0.75}) {
		t.Fatalf("pricing = %#v", model.Pricing)
	}
	if model.Args["count"] != 4 || model.Args["enabled"] != true || model.Args["text"] != "yes" || model.Args["nothing"] != nil {
		t.Errorf("args = %#v", model.Args)
	}
	path := filepath.Join(t.TempDir(), "model.yaml")
	if err := persistence.SaveYAML(path, model); err != nil {
		t.Fatal(err)
	}
	var loaded Model
	if err := persistence.LoadYAML(path, &loaded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(loaded, model) {
		t.Errorf("model roundtrip: %#v, want %#v", loaded, model)
	}
	if err := yaml.Unmarshal([]byte(minimalModel+"pricing: null"), &model); err != nil || model.Pricing != nil {
		t.Errorf("null pricing: %#v, %v", model, err)
	}
}

func TestHomeDir(t *testing.T) {
	home := isolatedHome(t)
	if got := HomeDir(); got != home {
		t.Errorf("HomeDir = %q, want %q", got, home)
	}
	if err := os.Unsetenv("AUTOMATOR_HOME"); err != nil {
		t.Fatal(err)
	}
	if got, want := HomeDir(), filepath.Join(os.Getenv("HOME"), ".automator"); got != want {
		t.Errorf("fallback = %q, want %q", got, want)
	}
	t.Setenv("AUTOMATOR_HOME", "")
	if got := HomeDir(); got != "" {
		t.Errorf("explicit empty override = %q", got)
	}
	if err := os.Unsetenv("AUTOMATOR_HOME"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", "")
	defer func() {
		if recover() == nil {
			t.Error("missing home did not panic")
		}
	}()
	HomeDir()
}

func TestEnsureHomeDefaultsAndPreservation(t *testing.T) {
	home := isolatedHome(t)
	if err := EnsureHome(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"config.yaml", "providers.yaml", "models.yaml", "model-presets.yaml", "templates.yaml", "runs-index.yaml"} {
		info, err := os.Stat(filepath.Join(home, name))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0600 {
			t.Errorf("%s mode = %o", name, info.Mode().Perm())
		}
	}
	if info, err := os.Stat(filepath.Join(home, "drafts")); err != nil || !info.IsDir() {
		t.Fatalf("drafts directory: %v, %v", info, err)
	}
	providers, err := Providers()
	if err != nil || len(providers.Providers) != 2 || providers.Providers["anthropic"].Auth != "external" || providers.Providers["openrouter"].DisplayName != "OpenRouter" {
		t.Errorf("default providers: %#v, %v", providers, err)
	}
	models, err := Models()
	if err != nil || len(models.Models) != 0 {
		t.Errorf("default models: %#v, %v", models, err)
	}
	presets, err := ModelPresets()
	if err != nil || presets.Presets["open-models"].DisplayName != "Open models" || len(presets.Presets["open-models"].Models) != 0 {
		t.Errorf("default presets: %#v, %v", presets, err)
	}
	templates, err := Templates()
	if err != nil || templates.Templates["empty"].DisplayName != "Empty directory" || len(templates.Templates["empty"].Steps) != 0 {
		t.Errorf("default templates: %#v, %v", templates, err)
	}
	index, err := LoadRunsIndex()
	if err != nil || len(index.Runs) != 0 {
		t.Errorf("default index: %#v, %v", index, err)
	}
	custom := "# deliberately invalid, never replace\nlocal user content\n"
	for _, name := range []string{"config.yaml", "providers.yaml", "models.yaml", "model-presets.yaml", "templates.yaml", "runs-index.yaml"} {
		writeTestFile(t, filepath.Join(home, name), custom)
	}
	if err := EnsureHome(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"config.yaml", "providers.yaml", "models.yaml", "model-presets.yaml", "templates.yaml", "runs-index.yaml"} {
		data, err := os.ReadFile(filepath.Join(home, name))
		if err != nil || string(data) != custom {
			t.Errorf("replaced %s: %q, %v", name, data, err)
		}
	}
}

func TestEnsureHomeConcurrent(t *testing.T) {
	isolatedHome(t)
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for i := 0; i < cap(errs); i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- EnsureHome() }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Error(err)
		}
	}
	if _, err := ModelPresets(); err != nil {
		t.Fatal(err)
	}
}

func TestOpenModelPresetSeeding(t *testing.T) {
	home := isolatedHome(t)
	file := ModelsFile{SchemaVersion: 1, Models: map[string]Model{
		"z-last":           {DisplayName: "QWEN", Tool: Pi, Provider: "external", Model: "example"},
		"a: special # key": {DisplayName: "DeepSeek", Tool: Opencode, Provider: "external", Model: "example"},
		"closed":           {DisplayName: "Claude", Tool: Claude, Provider: "anthropic", Model: "claude"},
	}}
	if err := persistence.SaveYAML(filepath.Join(home, "models.yaml"), file); err != nil {
		t.Fatal(err)
	}
	presets, err := ModelPresets()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"a: special # key", "z-last"}
	if got := presets.Presets["open-models"].Models; !reflect.DeepEqual(got, want) {
		t.Errorf("seed = %v, want %v", got, want)
	}
	file.Models["new"] = Model{DisplayName: "Kimi", Tool: Pi, Provider: "external", Model: "kimi"}
	if err := persistence.SaveYAML(filepath.Join(home, "models.yaml"), file); err != nil {
		t.Fatal(err)
	}
	presets, err = ModelPresets()
	if err != nil || !reflect.DeepEqual(presets.Presets["open-models"].Models, want) {
		t.Errorf("existing presets changed: %#v, %v", presets, err)
	}
	if err := os.Remove(filepath.Join(home, "model-presets.yaml")); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(home, "models.yaml"), "invalid: [")
	presets, err = ModelPresets()
	if err != nil || len(presets.Presets["open-models"].Models) != 0 {
		t.Errorf("invalid models fallback: %#v, %v", presets, err)
	}
}

func TestOpenModelCandidates(t *testing.T) {
	for _, needle := range []string{"qwen", "deepseek", "kimi", "moonshot", "glm", "zhipu", "yi-", "yi/", "baichuan", "minimax", "doubao", "hunyuan", "ernie", "alibaba", "tencent", "baidu"} {
		for _, field := range []string{"key", "display", "provider", "model"} {
			var model Model
			key := "neutral"
			switch field {
			case "key":
				key = strings.ToUpper(needle)
			case "display":
				model.DisplayName = strings.ToUpper(needle)
			case "provider":
				model.Provider = strings.ToUpper(needle)
			case "model":
				model.Model = strings.ToUpper(needle)
			}
			if !isOpenModelPresetCandidate(key, model) {
				t.Errorf("missed %s in %s", needle, field)
			}
		}
	}
	if isOpenModelPresetCandidate("claude", Model{DisplayName: "Sonnet", Provider: "anthropic", Model: "claude"}) {
		t.Error("matched closed model")
	}
	if isOpenModelPresetCandidate("\u212aIMI", Model{}) {
		t.Error("candidate matching must only lowercase ASCII")
	}
}

func TestRegistryVersionsAndMalformedFiles(t *testing.T) {
	for _, test := range []struct {
		name string
		load func() error
	}{
		{"providers.yaml", func() error { _, err := Providers(); return err }},
		{"models.yaml", func() error { _, err := Models(); return err }},
		{"model-presets.yaml", func() error { _, err := ModelPresets(); return err }},
		{"templates.yaml", func() error { _, err := Templates(); return err }},
		{"runs-index.yaml", func() error { _, err := LoadRunsIndex(); return err }},
	} {
		t.Run(test.name, func(t *testing.T) {
			home := isolatedHome(t)
			if err := test.load(); err != nil {
				t.Fatalf("initial load: %v", err)
			}
			path := filepath.Join(home, test.name)
			for _, version := range []int{0, 2, 99} {
				writeTestFile(t, path, fmt.Sprintf("schema_version: %d\n", version))
				if err := test.load(); err == nil || !strings.Contains(err.Error(), "unsupported schema_version") || !strings.Contains(err.Error(), path) {
					t.Errorf("version %d error = %v", version, err)
				}
			}
			for _, input := range []string{"{}", "null", "---\n", "invalid: ["} {
				writeTestFile(t, path, input)
				if err := test.load(); err == nil {
					t.Errorf("accepted malformed registry %q", input)
				}
			}
			writeTestFile(t, path, "schema_version: 1\nfuture_field: true\n")
			if err := test.load(); err != nil {
				t.Errorf("unknown field: %v", err)
			}
		})
	}
}

func TestSnapshotFutureVersionAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshot.yaml")
	writeTestFile(t, path, strings.Replace(minimalSnapshot, "schema_version: 1", "schema_version: 99", 1)+"herdr_workspace_id: '1'\nherdr_root_tab_id: '1:2'\nherdr_root_pane_id: '1-3'\n")
	var snapshot RunSnapshot
	if err := persistence.LoadYAML(path, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != 99 {
		t.Errorf("version = %d", snapshot.SchemaVersion)
	}
	if err := persistence.SaveYAML(path, snapshot); err != nil {
		t.Fatal(err)
	}
	var got RunSnapshot
	if err := persistence.LoadYAML(path, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, snapshot) {
		t.Errorf("snapshot roundtrip = %#v, want %#v", got, snapshot)
	}
	writeTestFile(t, path, "null")
	if err := persistence.LoadYAML(path, &got); err == nil {
		t.Error("accepted null snapshot")
	}
}

func TestLatestDraft(t *testing.T) {
	home := isolatedHome(t)
	if _, _, err := LatestDraft("missing"); err == nil || !strings.Contains(err.Error(), "draft not found") {
		t.Errorf("missing draft error: %v", err)
	}
	dir := filepath.Join(home, "drafts", "example")
	for _, name := range []string{"v0.yaml", "v2.yaml", "v10.txt", "v4294967296.yaml", "v-1.yaml", "version99.yaml", "notes.txt", "v.yaml"} {
		writeTestFile(t, filepath.Join(dir, name), minimalDraft)
	}
	if err := os.Mkdir(filepath.Join(dir, "v100.yaml"), 0700); err != nil {
		t.Fatal(err)
	}
	path, draft, err := LatestDraft("example")
	if err != nil || path != filepath.Join(dir, "v10.txt") || draft.Name != "example" || draft.Concurrency != 6 {
		t.Fatalf("latest draft = %s, %#v, %v", path, draft, err)
	}
	writeTestFile(t, filepath.Join(dir, "v11.yaml"), strings.Replace(minimalDraft, "schema_version: 1", "schema_version: 2", 1))
	if _, _, err := LatestDraft("example"); err == nil || !strings.Contains(err.Error(), "unsupported schema_version") {
		t.Errorf("future draft error: %v", err)
	}
	writeTestFile(t, filepath.Join(dir, "v11.yaml"), "schema_version: 1\n")
	if _, _, err := LatestDraft("example"); err == nil || !strings.Contains(err.Error(), "missing required field") {
		t.Errorf("invalid latest draft error: %v", err)
	}
	for _, name := range []string{"", ".", "..", "../outside", "a/b", "a\\b", "a\x00b"} {
		if _, _, err := LatestDraft(name); err == nil || !strings.Contains(err.Error(), "invalid draft name") {
			t.Errorf("unsafe draft %q: %v", name, err)
		}
	}
	writeTestFile(t, filepath.Join(home, "drafts", "empty", "notes.txt"), "ignored")
	if _, _, err := LatestDraft("empty"); err == nil || !strings.Contains(err.Error(), "no draft versions") {
		t.Errorf("no versions error: %v", err)
	}
	writeTestFile(t, filepath.Join(home, "drafts", "zero", "v0.yaml"), minimalDraft)
	if path, _, err := LatestDraft("zero"); err != nil || filepath.Base(path) != "v0.yaml" {
		t.Errorf("version zero = %q, %v", path, err)
	}
}

func TestFindRunAndSaveIndex(t *testing.T) {
	home := isolatedHome(t)
	index := RunsIndex{SchemaVersion: 1, Runs: []RunIndexEntry{
		{Name: "example", Path: filepath.Join(home, "older"), StartedAt: "old", Mode: Headful},
		{Name: "example", Path: filepath.Join(home, "newer"), StartedAt: "new", Mode: Headless},
		{Name: "other", Path: filepath.Join(home, "other-basename"), StartedAt: "new", Mode: Headless},
	}}
	if err := SaveRunsIndex(index); err != nil {
		t.Fatal(err)
	}
	got, err := LoadRunsIndex()
	if err != nil || !reflect.DeepEqual(got, index) {
		t.Fatalf("index roundtrip: %#v, %v", got, err)
	}
	for _, test := range []struct{ query, want string }{{"example", index.Runs[1].Path}, {"older", index.Runs[0].Path}, {"other-basename", index.Runs[2].Path}} {
		if got, err := FindRun(test.query); err != nil || got != test.want {
			t.Errorf("FindRun(%s) = %q, %v; want %q", test.query, got, err, test.want)
		}
	}
	if _, err := FindRun("not-in-index"); err == nil || !strings.Contains(err.Error(), "run not found") {
		t.Errorf("missing run error: %v", err)
	}
	direct := filepath.Join(home, "direct-run")
	if err := os.Mkdir(direct, 0700); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(home, "runs-index.yaml"), "broken: [")
	if got, err := FindRun(direct); err != nil || got != direct {
		t.Errorf("direct path should bypass index: %s, %v", got, err)
	}
	if _, err := FindRun("example"); err == nil {
		t.Error("ignored malformed index")
	}
}

func TestEnsureHomeErrors(t *testing.T) {
	home := isolatedHome(t)
	writeTestFile(t, home, "not a directory")
	if err := EnsureHome(); err == nil {
		t.Error("accepted file as home")
	}
	if _, err := Models(); err == nil {
		t.Error("registry ignored home initialization error")
	}
	if _, _, err := LatestDraft("example"); err == nil {
		t.Error("draft ignored home initialization error")
	}
	if err := SaveRunsIndex(RunsIndex{SchemaVersion: 1}); err == nil {
		t.Error("saved index below a file")
	}
	if _, err := os.Stat(filepath.Join(home, "models.yaml")); err == nil || errors.Is(err, os.ErrExist) {
		t.Errorf("unexpected stat: %v", err)
	}
}

func TestSortedKeys(t *testing.T) {
	want := []string{"A", "a", "z"}
	values := map[string]int{"z": 3, "a": 2, "A": 1}
	if got := SortedKeys(values); !reflect.DeepEqual(got, want) {
		t.Errorf("SortedKeys = %v, want %v", got, want)
	}
	if got := SortedKeys[Model](nil); len(got) != 0 {
		t.Errorf("nil map keys = %v", got)
	}
	if len(values) != 3 {
		t.Error("SortedKeys mutated input")
	}
}

func TestPrintRegistries(t *testing.T) {
	home := isolatedHome(t)
	models := ModelsFile{SchemaVersion: 1, Models: map[string]Model{
		"z": {DisplayName: "Last", Tool: Claude, Provider: "p", Model: "last"},
		"a": {DisplayName: "First", Tool: Pi, Provider: "p", Model: "first"},
	}}
	if err := persistence.SaveYAML(filepath.Join(home, "models.yaml"), models); err != nil {
		t.Fatal(err)
	}
	presets := ModelPresetsFile{SchemaVersion: 1, Presets: map[string]ModelPreset{"z": {DisplayName: "Last", Models: []string{"a", "z"}}, "a": {DisplayName: "First"}}}
	if err := persistence.SaveYAML(filepath.Join(home, "model-presets.yaml"), presets); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		print func() error
		want  string
	}{
		{PrintModels, "a\tFirst\tPi\tp/first\nz\tLast\tClaude\tp/last\n"},
		{PrintModelPresets, "a\tFirst\t\nz\tLast\ta,z\n"},
	} {
		read, write, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		original := os.Stdout
		os.Stdout = write
		err = test.print()
		os.Stdout = original
		_ = write.Close()
		var out bytes.Buffer
		_, readErr := io.Copy(&out, read)
		_ = read.Close()
		if err != nil || readErr != nil || out.String() != test.want {
			t.Errorf("print = %q, %v, %v; want %q", out.String(), err, readErr, test.want)
		}
	}
	writeTestFile(t, filepath.Join(home, "models.yaml"), "invalid: [")
	if err := PrintModels(); err == nil {
		t.Error("PrintModels ignored error")
	}
	writeTestFile(t, filepath.Join(home, "model-presets.yaml"), "invalid: [")
	if err := PrintModelPresets(); err == nil {
		t.Error("PrintModelPresets ignored error")
	}
}
