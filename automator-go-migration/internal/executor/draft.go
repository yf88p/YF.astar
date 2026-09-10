// Package executor resolves drafts, schedules native workers, and manages runs.
package executor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"automator/internal/adapter"
	"automator/internal/config"
	"automator/internal/herdr"
	"automator/internal/persistence"
	"automator/internal/process"
	"automator/internal/report"
	"automator/internal/util"
	"automator/internal/worker"
)

const herdrSession = "Automator"

func checkKey(key string) error {
	if !util.IsSafePathComponent(key) || filepath.VolumeName(key) != "" {
		return fmt.Errorf("unsafe model key: %q", key)
	}
	switch strings.ToLower(key) {
	case ".automator", ".automator-locks", "run.yaml", "prompt.md", "report.md", "report.json", "report.html":
		return fmt.Errorf("model key conflicts with run metadata: %s", key)
	}
	return nil
}

// Configuration's public readers initialize home. Resolution deliberately reads
// existing files directly so unsafe keys cannot cause initialization writes.
func loadRegistry(name string, out any, version *uint32) error {
	if err := persistence.LoadYAML(filepath.Join(config.HomeDir(), name), out); err != nil {
		return err
	}
	if *version != 1 {
		return fmt.Errorf("unsupported schema_version %d in %s", *version, name)
	}
	return nil
}

func resolveDraft(ctx context.Context, name string, selection config.ModelSelection, requireBins bool) (config.RunSnapshot, error) {
	var snapshot config.RunSnapshot
	if err := ctx.Err(); err != nil {
		return snapshot, err
	}
	if !util.IsSafePathComponent(name) {
		return snapshot, fmt.Errorf("unsafe draft name: %q", name)
	}
	for _, key := range selection.Models {
		if err := checkKey(key); err != nil {
			return snapshot, err
		}
	}
	for _, key := range selection.Presets {
		if !util.IsSafePathComponent(key) {
			return snapshot, fmt.Errorf("unsafe model preset key: %q", key)
		}
	}
	dir := filepath.Join(config.HomeDir(), "drafts", name)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return snapshot, fmt.Errorf("draft not found: %s: %w", name, err)
	}
	var latest string
	var version uint64
	for _, entry := range entries {
		stem := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if entry.IsDir() || !strings.HasPrefix(stem, "v") {
			continue
		}
		n, err := strconv.ParseUint(strings.TrimPrefix(stem[1:], "+"), 10, 32)
		if err == nil && (latest == "" || n > version) {
			latest, version = filepath.Join(dir, entry.Name()), n
		}
	}
	if latest == "" {
		return snapshot, fmt.Errorf("no draft versions for %s", name)
	}
	var draft config.DraftRun
	if err := persistence.LoadYAML(latest, &draft); err != nil {
		return snapshot, err
	}
	if draft.SchemaVersion != 1 {
		return snapshot, fmt.Errorf("unsupported draft schema_version: %d", draft.SchemaVersion)
	}
	if !util.IsSafePathComponent(draft.Name) || util.Slug(draft.Name) == "" {
		return snapshot, fmt.Errorf("unsafe draft name: %q", draft.Name)
	}
	if !util.IsSafePathComponent(draft.Template) {
		return snapshot, fmt.Errorf("unsafe template key: %q", draft.Template)
	}
	if draft.Root == "" || strings.ContainsRune(draft.Root, 0) {
		return snapshot, fmt.Errorf("invalid run root: %q", draft.Root)
	}
	var providers config.ProvidersFile
	var models config.ModelsFile
	var presets config.ModelPresetsFile
	var templates config.TemplatesFile
	for _, item := range []struct {
		name    string
		out     any
		version *uint32
	}{
		{"providers.yaml", &providers, &providers.SchemaVersion},
		{"models.yaml", &models, &models.SchemaVersion},
		{"templates.yaml", &templates, &templates.SchemaVersion},
	} {
		if err := loadRegistry(item.name, item.out, item.version); err != nil {
			return snapshot, err
		}
	}
	if err := loadRegistry("model-presets.yaml", &presets, &presets.SchemaVersion); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return snapshot, err
		}
		// Legacy homes predate presets. EnsureHome seeds from the entire model
		// registry, so check its keys before allowing initialization to write.
		for _, key := range config.SortedKeys(models.Models) {
			if err := checkKey(key); err != nil {
				return snapshot, err
			}
			if !util.IsSafePathComponent(models.Models[key].Provider) {
				return snapshot, fmt.Errorf("unsafe provider key for %s: %q", key, models.Models[key].Provider)
			}
		}
		root, err := canonicalPath(util.ExpandPath(draft.Root))
		if err != nil {
			return snapshot, err
		}
		if err := rejectSymlinks(root, filepath.Join(root, ".automator-locks", "allocation.lock")); err != nil {
			return snapshot, err
		}
		for _, name := range []string{".init.lock", "drafts", "config.yaml", "providers.yaml", "models.yaml", "templates.yaml", "runs-index.yaml", "model-presets.yaml"} {
			if err := rejectSymlinks(config.HomeDir(), filepath.Join(config.HomeDir(), name)); err != nil {
				return snapshot, err
			}
		}
		if err := ctx.Err(); err != nil {
			return snapshot, err
		}
		presets, err = config.ModelPresets()
		if err != nil {
			return snapshot, err
		}
	}
	template, ok := templates.Templates[draft.Template]
	if !ok {
		return snapshot, fmt.Errorf("template not found: %s", draft.Template)
	}
	keys := make(map[string]bool)
	for _, presetKey := range selection.Presets {
		preset, ok := presets.Presets[presetKey]
		if !ok {
			return snapshot, fmt.Errorf("model preset not found: %s", presetKey)
		}
		for _, key := range preset.Models {
			if err := checkKey(key); err != nil {
				return snapshot, fmt.Errorf("model preset %s: %w", presetKey, err)
			}
			keys[key] = true
		}
	}
	for _, key := range selection.Models {
		keys[key] = true
	}
	if len(keys) == 0 {
		return snapshot, errors.New("no models selected; pass --model/--preset or select models in the TUI")
	}
	selected := make(map[string]config.Model, len(keys))
	for _, key := range config.SortedKeys(keys) {
		model, ok := models.Models[key]
		if !ok {
			return snapshot, fmt.Errorf("model not found: %s", key)
		}
		if !util.IsSafePathComponent(model.Provider) {
			return snapshot, fmt.Errorf("unsafe provider key for %s: %q", key, model.Provider)
		}
		if _, ok := providers.Providers[model.Provider]; !ok {
			return snapshot, fmt.Errorf("provider not found for %s: %s", key, model.Provider)
		}
		if err := adapter.ValidateModel(key, model); err != nil {
			return snapshot, err
		}
		if requireBins {
			if _, err := exec.LookPath(adapter.ToolBinary(model.Tool)); err != nil {
				return snapshot, fmt.Errorf("required binary not found: %s", adapter.ToolBinary(model.Tool))
			}
		}
		selected[key] = model
	}
	if requireBins && draft.Mode == config.Headful {
		if _, err := exec.LookPath("herdr"); err != nil {
			return snapshot, errors.New("herdr not found; install herdr or use mode: headless")
		}
	}
	return config.RunSnapshot{
		SchemaVersion: 1, Name: draft.Name, Root: draft.Root, HerdrSession: herdrSession,
		Concurrency: max(1, draft.Concurrency), Mode: draft.Mode, Template: template,
		TemplateKey: draft.Template, Models: selected, Heavy: draft.Heavy && !selection.RunHeavy,
		Prompt: draft.Prompt, Pre: draft.Pre, PostEach: draft.PostEach, PostAll: draft.PostAll,
	}, ctx.Err()
}

// ValidateDraft previews redacted commands without creating a run or invoking
// tools. Like config readers, it initializes missing presets in legacy homes.
// Missing binaries are listed, not fatal.
func ValidateDraft(ctx context.Context, name string, selection config.ModelSelection) (string, error) {
	snapshot, err := resolveDraft(ctx, name, selection, false)
	if err != nil {
		return "", err
	}
	dir := NextRunDir(util.ExpandPath(snapshot.Root), snapshot.Name)
	var out strings.Builder
	mode := "Headless"
	if snapshot.Mode == config.Headful {
		mode = "Headful"
	}
	fmt.Fprintf(&out, "resolved run folder: %s\nherdr session: %s\nherdr workspace: %s\nmode: %s\nconcurrency: %d\nheavy: %t\nmodels:\n", dir, herdrSession, filepath.Base(dir), mode, snapshot.Concurrency, snapshot.Heavy)
	tools := make(map[config.Tool]bool)
	for _, key := range config.SortedKeys(snapshot.Models) {
		model := snapshot.Models[key]
		project := filepath.Join(dir, key)
		preview, err := previewCommand(model, project, filepath.Join(dir, "prompt.md"), snapshot.Prompt, snapshot.Name+":"+key)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&out, "  - %s\n    command: %s\n    reopen: %s\n", adapter.ModelKeyDisplay(key, model),
			util.RedactSecrets(preview),
			util.RedactSecrets(adapter.ReopenCommand(model, project, "")))
		tools[model.Tool] = true
	}
	for _, group := range []struct {
		name  string
		steps []config.ShellStep
	}{
		{"template", snapshot.Template.Steps}, {"pre", snapshot.Pre}, {"post_each", snapshot.PostEach}, {"post_all", snapshot.PostAll},
	} {
		fmt.Fprintf(&out, "%s steps:\n", group.name)
		for _, step := range group.steps {
			fmt.Fprintf(&out, "  - %s\n", util.RedactSecrets(step.Shell))
		}
	}
	out.WriteString("binary checks:\n")
	for _, tool := range []config.Tool{config.Pi, config.Opencode, config.Claude} {
		if tools[tool] {
			binaryCheck(&out, adapter.ToolBinary(tool))
		}
	}
	if snapshot.Mode == config.Headful {
		binaryCheck(&out, "herdr")
	}
	return util.RedactSecrets(out.String()), ctx.Err()
}

func binaryCheck(out *strings.Builder, bin string) {
	status := "ok"
	if _, err := exec.LookPath(bin); err != nil {
		status = "missing"
	}
	fmt.Fprintf(out, "  %s: %s\n", status, bin)
}

// Preview and execution share argv construction, without writing a prompt file.
func previewCommand(model config.Model, project, promptPath, prompt, title string) (string, error) {
	argv, err := adapter.BuildCommandWithPrompt(model, project, promptPath, prompt, title)
	if err != nil {
		return "", err
	}
	args := make([]string, len(argv.Args))
	for i, arg := range argv.Args {
		args[i] = util.ShellQuote(arg)
	}
	command := argv.Program + " " + strings.Join(args, " ")
	if model.Tool != config.Opencode {
		command = "cd " + util.ShellQuote(project) + " && " + command
	}
	return command, nil
}

// NextRunDir selects an unused version; callers must serialize allocation. It
// also skips tombstoned versions that may still have stale queued processes.
func NextRunDir(root, name string) string {
	slug := util.Slug(name)
	for n := 1; ; n++ {
		base := slug
		if n > 1 {
			base = fmt.Sprintf("%s-v%d", slug, n)
		}
		path := filepath.Join(root, base)
		_, err := os.Lstat(path)
		if err == nil {
			continue
		}
		if !errors.Is(err, os.ErrNotExist) {
			return path
		}
		canonical, canonicalErr := canonicalTarget(path)
		if canonicalErr != nil {
			return path
		}
		_, deleted := os.Lstat(worker.RunLockPath(canonical) + ".deleted")
		if errors.Is(err, os.ErrNotExist) && errors.Is(deleted, os.ErrNotExist) {
			return path
		}
	}
}

// RunDraft creates an immutable snapshot and runs bounded child workers using
// the current executable's worker subcommand. Individual worker failures,
// including exit 130, remain local; orchestrator cancellation wraps
// context.Canceled so the CLI can return 130.
func RunDraft(ctx context.Context, name string, selection config.ModelSelection) error {
	snapshot, err := resolveDraft(ctx, name, selection, true)
	if err != nil {
		return err
	}
	root, err := canonicalPath(util.ExpandPath(snapshot.Root))
	if err != nil {
		return err
	}
	if err := rejectSymlinks(root, filepath.Join(root, ".automator-locks", "allocation.lock")); err != nil {
		return err
	}
	for _, path := range []string{indexLockPath(), filepath.Join(config.HomeDir(), "runs-index.yaml")} {
		if err := rejectSymlinks(config.HomeDir(), path); err != nil {
			return err
		}
	}
	for _, model := range snapshot.Models {
		if model.Tool == config.Opencode {
			if err := warmUpOpencode(ctx); err != nil {
				return err
			}
			break
		}
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return err
	}
	if err := func() error {
		unlock, err := persistence.Lock(ctx, filepath.Join(root, ".automator-locks", "allocation.lock"))
		if err != nil {
			return err
		}
		defer unlock()
		if err := ctx.Err(); err != nil {
			return err
		}
		snapshot.RunDir = NextRunDir(root, snapshot.Name)
		snapshot.Name = filepath.Base(snapshot.RunDir)
		snapshot.HerdrWorkspaceLabel = snapshot.Name
		if err := os.Mkdir(snapshot.RunDir, 0755); err != nil {
			return fmt.Errorf("create run without overwriting: %w", err)
		}
		if err := persistence.SaveYAML(filepath.Join(snapshot.RunDir, "run.yaml"), snapshot); err != nil {
			return err
		}
		if err := persistence.WriteFile(filepath.Join(snapshot.RunDir, "prompt.md"), []byte(snapshot.Prompt), 0600); err != nil {
			return err
		}
		status := worker.Queued
		if snapshot.Heavy {
			status = worker.Paused
		}
		for _, key := range config.SortedKeys(snapshot.Models) {
			if err := writeInitialState(snapshot, key, status); err != nil {
				return err
			}
		}
		return updateIndex(ctx, func(index *config.RunsIndex) {
			index.Runs = append(index.Runs, config.RunIndexEntry{Name: snapshot.Name, Path: snapshot.RunDir, StartedAt: time.Now().UTC().Format(time.RFC3339Nano), Mode: snapshot.Mode})
		})
	}(); err != nil {
		return err
	}
	if snapshot.Heavy {
		if snapshot.Mode == config.Headful {
			err = dispatchHerdr(ctx, &snapshot, "", "", "")
		}
		err = errors.Join(err, refreshReport(snapshot.RunDir))
		if err != nil {
			return err
		}
		fmt.Printf("heavy run created paused: %s\nstart one model: automator start %s <model>\nreport: %s\n", snapshot.RunDir, snapshot.Name, filepath.Join(snapshot.RunDir, "report.md"))
		return nil
	}
	if snapshot.Mode == config.Headful {
		err = runHeadful(ctx, &snapshot)
	} else {
		err = runHeadless(ctx, snapshot)
	}
	if err != nil {
		for _, key := range config.SortedKeys(snapshot.Models) {
			err = errors.Join(err, worker.MarkFailed(snapshot.RunDir, key, "run launch failed: "+err.Error()))
		}
		return errors.Join(err, refreshReport(snapshot.RunDir))
	}
	for _, step := range snapshot.PostAll {
		if ctx.Err() != nil {
			break
		}
		if _, err := os.Stat(snapshot.RunDir); errors.Is(err, os.ErrNotExist) {
			break
		}
		cmd := process.CommandContext(ctx, util.PreferredShell(), "-lc", step.Shell)
		cmd.Dir, cmd.Stdout, cmd.Stderr = snapshot.RunDir, os.Stdout, os.Stderr
		_ = cmd.Run()
	}
	if err := errors.Join(ctx.Err(), refreshReport(snapshot.RunDir)); err != nil {
		return err
	}
	fmt.Printf("run complete: %s\nreport: %s\n", snapshot.RunDir, filepath.Join(snapshot.RunDir, "report.md"))
	return nil
}

func warmUpOpencode(ctx context.Context) error {
	// OpenCode's first invocation initializes shared user state. Serialize that
	// operation across run roots/homes, never the independent model executions.
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	path := filepath.Join(home, ".automator-opencode-warmup.lock")
	if err := rejectSymlinks(home, path); err != nil {
		return err
	}
	unlock, err := persistence.Lock(ctx, path)
	if err != nil {
		return err
	}
	defer unlock()
	if err := process.CommandContext(ctx, "opencode", "session", "list").Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("opencode state warm-up failed: %w", err)
	}
	return nil
}

func writeInitialState(snapshot config.RunSnapshot, key string, status worker.Status) error {
	model := snapshot.Models[key]
	old, _ := worker.LoadState(snapshot.RunDir, key)
	state := worker.State{Model: key, Provider: model.Provider, Tool: string(model.Tool), Status: status,
		ProjectPath: filepath.Join(snapshot.RunDir, key), HerdrWorkspaceID: old.HerdrWorkspaceID,
		HerdrTabID: old.HerdrTabID, HerdrPaneID: old.HerdrPaneID}
	state.NativeReopen = adapter.ReopenCommand(model, state.ProjectPath, "")
	if snapshot.Mode == config.Headful {
		state.HerdrSession = &snapshot.HerdrSession
		if snapshot.HerdrWorkspaceID != nil {
			state.HerdrWorkspaceID = snapshot.HerdrWorkspaceID
		}
		attach := herdr.AttachCommand(snapshot, state)
		state.HerdrAttach = &attach
	}
	return worker.SaveState(snapshot.RunDir, key, state)
}

func indexLockPath() string { return filepath.Join(config.HomeDir(), ".runs-index.lock") }

func updateIndex(ctx context.Context, update func(*config.RunsIndex)) error {
	unlock, err := persistence.Lock(ctx, indexLockPath())
	if err != nil {
		return err
	}
	defer unlock()
	index, err := config.LoadRunsIndex()
	if err != nil {
		return err
	}
	update(&index)
	return config.SaveRunsIndex(index)
}

func refreshReport(runDir string) error {
	// Report owns its own locks; never call it while holding transition locks.
	if _, err := os.Stat(filepath.Join(runDir, "run.yaml")); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	err := report.Write(runDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
