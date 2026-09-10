package config

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"automator/internal/persistence"
	"automator/internal/util"
)

func HomeDir() string {
	if home, ok := os.LookupEnv("AUTOMATOR_HOME"); ok {
		return home
	}
	home, err := os.UserHomeDir()
	if err != nil {
		panic("home dir: " + err.Error())
	}
	return filepath.Join(home, ".automator")
}

func EnsureHome() error {
	home := HomeDir()
	if err := os.MkdirAll(filepath.Join(home, "drafts"), 0700); err != nil {
		return fmt.Errorf("create automator home: %w", err)
	}
	unlock, err := persistence.Lock(context.Background(), filepath.Join(home, ".init.lock"))
	if err != nil {
		return err
	}
	defer unlock()
	defaults := []struct {
		name    string
		content string
	}{
		{"config.yaml", "schema_version: 1\ndefault_concurrency: 6\n"},
		{"providers.yaml", "schema_version: 1\nproviders:\n  anthropic:\n    display_name: Anthropic\n    auth: external\n  openrouter:\n    display_name: OpenRouter\n    auth: external\n"},
		{"models.yaml", "schema_version: 1\nmodels: {}\n"},
		{"templates.yaml", "schema_version: 1\ntemplates:\n  empty:\n    display_name: Empty directory\n    steps: []\n"},
		{"runs-index.yaml", "schema_version: 1\nruns: []\n"},
	}
	for _, file := range defaults {
		path := filepath.Join(home, file.name)
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			if err := persistence.WriteFile(path, []byte(file.content), 0600); err != nil {
				return err
			}
		} else if err != nil {
			return fmt.Errorf("stat %s: %w", path, err)
		}
	}
	path := filepath.Join(home, "model-presets.yaml")
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	keys := []string{}
	var models ModelsFile
	if persistence.LoadYAML(filepath.Join(home, "models.yaml"), &models) == nil {
		for _, key := range SortedKeys(models.Models) {
			if isOpenModelPresetCandidate(key, models.Models[key]) {
				keys = append(keys, key)
			}
		}
	}
	return persistence.SaveYAML(path, ModelPresetsFile{
		SchemaVersion: 1,
		Presets:       map[string]ModelPreset{"open-models": {DisplayName: "Open models", Models: keys}},
	})
}

func isOpenModelPresetCandidate(key string, model Model) bool {
	haystack := strings.Map(func(c rune) rune {
		if c >= 'A' && c <= 'Z' {
			return c + 'a' - 'A'
		}
		return c
	}, key+" "+model.DisplayName+" "+model.Provider+" "+model.Model)
	for _, needle := range []string{"qwen", "deepseek", "kimi", "moonshot", "glm", "zhipu", "yi-", "yi/", "baichuan", "minimax", "doubao", "hunyuan", "ernie", "alibaba", "tencent", "baidu"} {
		if strings.Contains(haystack, needle) {
			return true
		}
	}
	return false
}

func requireSchema(version uint32, path string) error {
	if version != 1 {
		return fmt.Errorf("unsupported schema_version %d in %s; expected 1", version, path)
	}
	return nil
}

func loadRegistry(name string, out any, version *uint32) error {
	if err := EnsureHome(); err != nil {
		return err
	}
	path := filepath.Join(HomeDir(), name)
	if err := persistence.LoadYAML(path, out); err != nil {
		return err
	}
	return requireSchema(*version, path)
}

func Providers() (ProvidersFile, error) {
	var file ProvidersFile
	err := loadRegistry("providers.yaml", &file, &file.SchemaVersion)
	return file, err
}

func Models() (ModelsFile, error) {
	var file ModelsFile
	err := loadRegistry("models.yaml", &file, &file.SchemaVersion)
	return file, err
}

func ModelPresets() (ModelPresetsFile, error) {
	var file ModelPresetsFile
	err := loadRegistry("model-presets.yaml", &file, &file.SchemaVersion)
	return file, err
}

func Templates() (TemplatesFile, error) {
	var file TemplatesFile
	err := loadRegistry("templates.yaml", &file, &file.SchemaVersion)
	return file, err
}

func LoadRunsIndex() (RunsIndex, error) {
	var file RunsIndex
	err := loadRegistry("runs-index.yaml", &file, &file.SchemaVersion)
	return file, err
}

func SaveRunsIndex(index RunsIndex) error {
	return persistence.SaveYAML(filepath.Join(HomeDir(), "runs-index.yaml"), index)
}

func LatestDraft(name string) (string, DraftRun, error) {
	if !util.IsSafePathComponent(name) {
		return "", DraftRun{}, fmt.Errorf("invalid draft name: %q", name)
	}
	if err := EnsureHome(); err != nil {
		return "", DraftRun{}, err
	}
	dir := filepath.Join(HomeDir(), "drafts", name)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", DraftRun{}, fmt.Errorf("draft not found: %s: %w", dir, err)
	}
	var best uint64
	var path string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		stem := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if !strings.HasPrefix(stem, "v") {
			continue
		}
		n, err := strconv.ParseUint(strings.TrimPrefix(stem[1:], "+"), 10, 32)
		if err == nil && (path == "" || n > best) {
			best, path = n, filepath.Join(dir, entry.Name())
		}
	}
	if path == "" {
		return "", DraftRun{}, fmt.Errorf("no draft versions for %s", name)
	}
	var draft DraftRun
	if err := persistence.LoadYAML(path, &draft); err != nil {
		return "", DraftRun{}, err
	}
	if err := requireSchema(draft.SchemaVersion, path); err != nil {
		return "", DraftRun{}, err
	}
	return path, draft, nil
}

func FindRun(run string) (string, error) {
	if _, err := os.Stat(run); err == nil {
		return run, nil
	}
	index, err := LoadRunsIndex()
	if err != nil {
		return "", err
	}
	for i := len(index.Runs) - 1; i >= 0; i-- {
		entry := index.Runs[i]
		if entry.Name == run || filepath.Base(entry.Path) == run {
			return entry.Path, nil
		}
	}
	return "", fmt.Errorf("run not found: %s", run)
}

func SortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func PrintModels() error {
	file, err := Models()
	if err != nil {
		return err
	}
	for _, key := range SortedKeys(file.Models) {
		model := file.Models[key]
		tool := map[Tool]string{Pi: "Pi", Opencode: "Opencode", Claude: "Claude"}[model.Tool]
		fmt.Printf("%s\t%s\t%s\t%s/%s\n", key, model.DisplayName, tool, model.Provider, model.Model)
	}
	return nil
}

func PrintModelPresets() error {
	file, err := ModelPresets()
	if err != nil {
		return err
	}
	for _, key := range SortedKeys(file.Presets) {
		preset := file.Presets[key]
		fmt.Printf("%s\t%s\t%s\n", key, preset.DisplayName, strings.Join(preset.Models, ","))
	}
	return nil
}
