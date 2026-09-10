package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"automator/internal/config"
)

// Metrics preserves missing values separately from measured zeroes. JSON/YAML
// names match Rust, including cost and session_id. Per-model usage is ephemeral:
// recover native metrics before repricing persisted state.
type Metrics struct {
	InputTokens             *uint64  `json:"input_tokens" yaml:"input_tokens"`
	OutputTokens            *uint64  `json:"output_tokens" yaml:"output_tokens"`
	ReasoningTokens         *uint64  `json:"reasoning_tokens" yaml:"reasoning_tokens"`
	CacheReadTokens         *uint64  `json:"cache_read_tokens" yaml:"cache_read_tokens"`
	CacheWriteTokens        *uint64  `json:"cache_write_tokens" yaml:"cache_write_tokens"`
	TotalTokens             *uint64  `json:"total_tokens" yaml:"total_tokens"`
	CostUSD                 *float64 `json:"cost" yaml:"cost"`
	NativeSessionID         *string  `json:"session_id" yaml:"session_id"`
	ToolVersion             *string  `json:"tool_version" yaml:"tool_version"`
	InputTokensIncludeCache *bool    `json:"input_tokens_include_cache,omitempty" yaml:"input_tokens_include_cache,omitempty"`

	usageByModel map[string]usageBreakdown
	pricingModel string
}

type usageBreakdown struct {
	input, output, reasoning, cacheRead, cacheWrite uint64
	nativeCost                                      float64
}

// CollectMetrics uses the start time minus the native five-minute grace window.
// Missing/unreadable session data yields empty metrics, not an error. Pricing is
// explicit: call ApplyPricing on the result if an override is wanted.
func CollectMetrics(ctx context.Context, model config.Model, project, title string, started time.Time) (Metrics, error) {
	since := started.Add(-5 * time.Minute)
	if since.Before(time.Unix(0, 0)) {
		since = time.Unix(0, 0)
	}
	return collectMetrics(ctx, model, project, title, since, false, "")
}

// RecoverMetrics scans all history, deliberately ignoring started. OpenCode
// requires directory AND title, and an optional known ID must also match both.
// Claude requires directory and optional ID, not title. Pi recovery is unsupported.
func RecoverMetrics(ctx context.Context, model config.Model, project, title string, started time.Time, knownSessionID string) (Metrics, error) {
	return collectMetrics(ctx, model, project, title, time.Unix(0, 0), true, knownSessionID)
}

func collectMetrics(ctx context.Context, model config.Model, project, title string, since time.Time, recovery bool, sessionID string) (Metrics, error) {
	if err := ctx.Err(); err != nil {
		return Metrics{}, err
	}
	var m Metrics
	switch model.Tool {
	case config.Pi:
		if !recovery {
			m = parsePiMetrics(ctx, project, title, since)
		}
	case config.Opencode:
		m = parseOpencodeMetrics(ctx, project, title, since, !recovery, sessionID)
	case config.Claude:
		m = parseClaudeMetrics(ctx, project, since, sessionID)
	default:
		return Metrics{}, fmt.Errorf("unsupported tool: %s", model.Tool)
	}
	m.pricingModel = usageKey(model.Provider, model.Model)
	if m.ToolVersion == nil {
		m.ToolVersion = InstalledVersion(ctx, model.Tool)
	}
	return m, ctx.Err()
}

// ApplyPricing replaces only the selected provider/model's native contribution
// when OpenCode records model identities, preserving child agents' other costs.
// Like Rust, call once on freshly collected/recovered metrics, not repeatedly on
// the same already-priced result.
func ApplyPricing(metrics *Metrics, pricing *config.ModelPricing) {
	if metrics == nil || pricing == nil {
		return
	}
	if len(metrics.usageByModel) != 0 {
		usage, ok := metrics.usageByModel[metrics.pricingModel]
		if !ok {
			return
		}
		metrics.CostUSD = ptr(value(metrics.CostUSD) - usage.nativeCost + pricedCost(usage, pricing))
		return
	}
	if metrics.InputTokens == nil && metrics.OutputTokens == nil && metrics.ReasoningTokens == nil && metrics.CacheReadTokens == nil && metrics.CacheWriteTokens == nil {
		return
	}
	metrics.CostUSD = ptr(pricedCost(usageBreakdown{
		input: value(metrics.InputTokens), output: value(metrics.OutputTokens),
		reasoning: value(metrics.ReasoningTokens), cacheRead: value(metrics.CacheReadTokens),
		cacheWrite: value(metrics.CacheWriteTokens),
	}, pricing))
}

func pricedCost(usage usageBreakdown, pricing *config.ModelPricing) float64 {
	return (float64(usage.input)*pricing.InputPerMillion +
		float64(usage.output)*pricing.OutputPerMillion +
		float64(usage.reasoning)*pricing.OutputPerMillion +
		float64(usage.cacheRead)*pricing.CacheReadPerMillion +
		float64(usage.cacheWrite)*pricing.CacheWritePerMillion) / 1_000_000
}

func usageKey(provider, model string) string { return provider + "\x00" + model }

func ptr[T any](v T) *T { return &v }

func value[T any](v *T) T {
	if v != nil {
		return *v
	}
	var zero T
	return zero
}

func jsonObject(text string) map[string]any {
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	var v map[string]any
	if decoder.Decode(&v) != nil {
		return nil
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil
	}
	return v
}

func object(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func jsonUint(v any) uint64 {
	n, ok := v.(json.Number)
	if !ok {
		return 0
	}
	result, err := strconv.ParseUint(string(n), 10, 64)
	if err != nil {
		return 0
	}
	return result
}

func optionalUint(v any) (uint64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	result, err := strconv.ParseUint(string(n), 10, 64)
	return result, err == nil
}

func jsonFloat(v any) float64 {
	n, ok := v.(json.Number)
	if !ok {
		return 0
	}
	result, err := strconv.ParseFloat(string(n), 64)
	if err != nil || math.IsInf(result, 0) || math.IsNaN(result) {
		return 0
	}
	return result
}

func firstField(v map[string]any, first, second string) any {
	if result, ok := v[first]; ok {
		return result
	}
	return v[second]
}

func readText(path string) (string, bool) {
	path, err := nonCredentialPath(path)
	if err != nil {
		return "", false
	}
	b, err := os.ReadFile(path)
	return string(b), err == nil && utf8.Valid(b)
}

// Tool data directories also contain auth.json and credential stores. Inspect
// path names, never their contents, and reject aliases into those stores too.
func nonCredentialPath(path string) (string, error) {
	for pass := 0; pass < 2; pass++ {
		for _, component := range strings.Split(filepath.ToSlash(path), "/") {
			switch strings.ToLower(component) {
			case ".ssh", ".aws", ".gnupg", ".netrc", ".env", ".git-credentials":
				return "", fmt.Errorf("refusing to read credential path")
			}
			name := strings.TrimLeft(strings.ToLower(component), ".")
			stem := strings.TrimSuffix(name, filepath.Ext(name))
			switch stem {
			case "auth", "credential", "credentials", "oauth", "secret", "secrets", "token", "tokens", "api_keys", "api-keys":
				return "", fmt.Errorf("refusing to read credential path")
			}
		}
		if pass == 0 {
			resolved, err := filepath.EvalSymlinks(path)
			if err != nil {
				return "", err
			}
			path = resolved
		}
	}
	return path, nil
}

type sessionFile struct {
	path     string
	modified time.Time
}

// Follow directory symlinks like Rust, but do not recurse through symlink cycles.
func collectFiles(ctx context.Context, dir, ext string, out *[]sessionFile) {
	ancestors := make(map[string]bool)
	var visit func(string)
	visit = func(dir string) {
		if ctx.Err() != nil {
			return
		}
		real, err := nonCredentialPath(dir)
		if err != nil || ancestors[real] {
			return
		}
		ancestors[real] = true
		defer delete(ancestors, real)
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if ctx.Err() != nil {
				return
			}
			path := filepath.Join(dir, entry.Name())
			real, err := nonCredentialPath(path)
			if err != nil {
				continue
			}
			info, err := os.Stat(real)
			if err != nil {
				continue
			}
			if info.IsDir() {
				visit(path)
			} else if filepath.Ext(path) == "."+ext {
				*out = append(*out, sessionFile{path, info.ModTime()})
			}
		}
	}
	visit(dir)
}

func sortFiles(files []sessionFile) {
	sort.SliceStable(files, func(i, j int) bool { return files[i].modified.Before(files[j].modified) })
}
