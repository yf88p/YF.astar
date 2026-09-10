package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"automator/internal/config"
)

func assertTokens(t *testing.T, m Metrics, input, output uint64, reasoning *uint64, read, write, total uint64) {
	t.Helper()
	for _, tc := range []struct {
		name      string
		got, want *uint64
	}{
		{"input", m.InputTokens, &input}, {"output", m.OutputTokens, &output},
		{"reasoning", m.ReasoningTokens, reasoning}, {"cache read", m.CacheReadTokens, &read},
		{"cache write", m.CacheWriteTokens, &write}, {"total", m.TotalTokens, &total},
	} {
		if !reflect.DeepEqual(tc.got, tc.want) {
			t.Errorf("%s = %v (%d), want %v (%d)", tc.name, tc.got, value(tc.got), tc.want, value(tc.want))
		}
	}
	if m.InputTokensIncludeCache != nil {
		t.Error("cache inclusion flag has no source value")
	}
}

func assertCost(t *testing.T, m Metrics, want float64) {
	t.Helper()
	if m.CostUSD == nil || math.Abs(*m.CostUSD-want) > 1e-12 {
		t.Fatalf("cost = %v (%g), want %g", m.CostUSD, value(m.CostUSD), want)
	}
}

func setModified(t *testing.T, path string, when time.Time) {
	t.Helper()
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
}

func testPricing() *config.ModelPricing {
	return &config.ModelPricing{InputPerMillion: 3, OutputPerMillion: 15, CacheReadPerMillion: 0.3, CacheWritePerMillion: 3}
}

func TestOpencodeMetricsPreserveCacheAndReasoning(t *testing.T) {
	rows := []string{
		`{"role":"assistant","cost":0.5,"tokens":{"input":10,"output":20,"reasoning":3,"cache":{"read":100,"write":7},"total":140}}`,
		`{"role":"assistant","cost":0.25,"tokens":{"input":1,"output":2,"cache":{"read":4,"write":5},"total":12}}`,
		`{"role":"user","tokens":{"input":999,"output":999,"total":1998}}`,
		`not json`,
	}
	m := metricsFromOpencodeRows("ses_test", rows, false)
	assertTokens(t, m, 11, 22, ptr(uint64(3)), 104, 12, 152)
	if value(m.NativeSessionID) != "ses_test" {
		t.Fatal("session ID missing")
	}
	assertCost(t, m, 0.75)
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 0.0004752)
}

func TestPricingOverridePreservesOtherModelsNativeCost(t *testing.T) {
	rows := []string{
		`{"role":"assistant","providerID":"kimi-for-coding","modelID":"k3","cost":0.2,"tokens":{"input":10,"output":20,"reasoning":3,"cache":{"read":100,"write":7},"total":140}}`,
		`{"role":"assistant","providerID":"other","modelID":"model","cost":0.8,"tokens":{"input":50,"output":5,"reasoning":0,"cache":{"read":0,"write":0},"total":55}}`,
		`{"role":"assistant","cost":0.4,"tokens":{"input":50,"output":5}}`,
	}
	m := metricsFromOpencodeRows("ses_test", rows, false)
	m.pricingModel = usageKey("kimi-for-coding", "k3")
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 1.200426)
	m = metricsFromOpencodeRows("ses_test", rows, false)
	m.pricingModel = usageKey("unknown", "k3")
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 1.4)
	if usageKey("a\x00b", "c") == usageKey("a", "bc") {
		t.Fatal("usage keys collide")
	}
}

func TestPricingMissingAndZeroUsage(t *testing.T) {
	ApplyPricing(nil, testPricing())
	m := Metrics{CostUSD: ptr(7.0), TotalTokens: ptr(uint64(100))}
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 7)
	m.InputTokens = ptr(uint64(0))
	ApplyPricing(&m, nil)
	assertCost(t, m, 7)
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 0)
	m = Metrics{ReasoningTokens: ptr(uint64(100))}
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 0.0015)
}

func TestMetricsMissingValuesAndExactUint64(t *testing.T) {
	m := metricsFromOpencodeRows("", []string{`{"role":"assistant"}`}, false)
	if !reflect.DeepEqual(m, Metrics{}) {
		t.Fatalf("empty metrics = %#v", m)
	}
	m = metricsFromOpencodeRows("", []string{`{"role":"assistant","tokens":null,"cost":null}`}, false)
	assertTokens(t, m, 0, 0, ptr(uint64(0)), 0, 0, 0)
	assertCost(t, m, 0)
	m = metricsFromOpencodeRows("", []string{`{"role":"assistant","tokens":{"input":9007199254740993,"output":-1,"reasoning":2.0,"cache":{"read":"3"}}}`}, false)
	assertTokens(t, m, 9007199254740993, 0, ptr(uint64(0)), 0, 0, 9007199254740993)
	if m.CostUSD != nil {
		t.Fatal("absent native cost became zero")
	}
	for _, row := range []string{`[]`, `null`, `1`, `{"role":"assistant","tokens":{}} garbage`, `{"role":"assistant","tokens":{}} {}`} {
		if m := metricsFromOpencodeRows("", []string{row}, false); m.InputTokens != nil {
			t.Errorf("accepted invalid row %s", row)
		}
	}
	encoded, err := json.Marshal(Metrics{TotalTokens: ptr(uint64(5)), CostUSD: ptr(0.5), NativeSessionID: ptr("ses_x"), usageByModel: map[string]usageBreakdown{"hidden": {input: 3}}, pricingModel: "hidden"})
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, expected := range []string{`"total_tokens":5`, `"cost":0.5`, `"session_id":"ses_x"`, `"reasoning_tokens":null`} {
		if !strings.Contains(text, expected) {
			t.Errorf("serialization %s lacks %s", text, expected)
		}
	}
	if strings.Contains(text, "hidden") || strings.Contains(text, "include_cache") {
		t.Fatal(text)
	}
}

func TestPiMetricsAndCorrelation(t *testing.T) {
	text := strings.Join([]string{
		`{"cwd":"/tmp/project","name":"run:model"}`,
		`broken line`,
		`{"message":{"usage":{"input":10,"output":20,"cacheRead":30,"cacheWrite":4,"totalTokens":99,"cost":{"total":0.5}}}}`,
		`{"usage":{"input":1,"output":2,"cache_read":3,"cache_write":4,"cost":{"total":0.25}}}`,
	}, "\n")
	m := piMetricsFromText("/tmp/2026-09-09_session_with_underscores.jsonl", text)
	assertTokens(t, m, 11, 22, ptr(uint64(0)), 33, 8, 109)
	assertCost(t, m, 0.75)
	if value(m.NativeSessionID) != "session_with_underscores" {
		t.Fatal(value(m.NativeSessionID))
	}
	for _, tc := range []struct {
		text  string
		score int
	}{
		{`{"cwd":"/tmp/project"}`, 3}, {`{"name":"run:model"}`, 2},
		{`some /tmp/project mention`, 2}, {`some run:model mention`, 1}, {`unrelated`, 0},
		{strings.Repeat("{}\n", 20) + `{"cwd":"/tmp/project"}`, 2},
	} {
		if got := piCorrelationScore(tc.text, "/tmp/project", "run:model"); got != tc.score {
			t.Errorf("score %d, want %d", got, tc.score)
		}
	}
	m = piMetricsFromText("plain.jsonl", `{"message":{"usage":null},"usage":{"input":999}}`)
	assertTokens(t, m, 0, 0, ptr(uint64(0)), 0, 0, 0)
	if value(m.NativeSessionID) != "plain" {
		t.Fatal("filename session ID fallback failed")
	}
	m = piMetricsFromText("plain.jsonl", `{"usage":{"cacheRead":null,"cache_read":999,"totalTokens":null,"total_tokens":999}}`)
	assertTokens(t, m, 0, 0, ptr(uint64(0)), 0, 0, 0)
}

func TestPiSelectionAndUnsupportedRecovery(t *testing.T) {
	home := isolatedHome(t)
	fakeTool(t, home, "pi", "printf 'fake-pi\\n'")
	root := os.Getenv("PI_CODING_AGENT_SESSION_DIR")
	started := time.Now()
	older := filepath.Join(root, "date_older.jsonl")
	newer := filepath.Join(root, "date_newer.jsonl")
	writeFixture(t, older, `{"cwd":"/project","usage":{"input":10}}`)
	writeFixture(t, newer, `{"name":"title","usage":{"input":20}}`)
	setModified(t, older, started.Add(-4*time.Minute))
	setModified(t, newer, started)
	model := config.Model{Tool: config.Pi}
	m, err := CollectMetrics(context.Background(), model, "/project", "title", started)
	if err != nil || value(m.NativeSessionID) != "older" || value(m.ToolVersion) != "fake-pi" {
		t.Fatalf("selection: %#v, %v", m, err)
	}
	writeFixture(t, newer, `{"cwd":"/project","usage":{"input":20}}`)
	m, _ = CollectMetrics(context.Background(), model, "/project", "title", started)
	if value(m.NativeSessionID) != "newer" {
		t.Fatal("newest equal score should win")
	}
	writeFixture(t, older, `{"usage":{"input":10}}`)
	writeFixture(t, newer, `{"usage":{"input":20}}`)
	m, _ = CollectMetrics(context.Background(), model, "/project", "title", started)
	if m.NativeSessionID != nil {
		t.Fatal("multiple unrelated files were accepted")
	}
	setModified(t, older, started.Add(-6*time.Minute))
	m, _ = CollectMetrics(context.Background(), model, "/project", "title", started)
	if value(m.NativeSessionID) != "newer" {
		t.Fatal("single recent file fallback failed")
	}
	m, _ = RecoverMetrics(context.Background(), model, "/project", "title", started, "newer")
	if m.NativeSessionID != nil || m.InputTokens != nil || value(m.ToolVersion) != "fake-pi" {
		t.Fatalf("Pi recovery must be empty except version: %#v", m)
	}
}

func TestClaudeDeduplicatesUpdatesAndIgnoresSidechains(t *testing.T) {
	text := strings.Join([]string{
		`{"type":"assistant","cwd":"/tmp/claude-project","isSidechain":false,"sessionId":"session-id","uuid":"first","message":{"id":"msg_1","usage":{"input_tokens":99,"output_tokens":0}}}`,
		`{"type":"assistant","cwd":"/tmp/claude-project","isSidechain":false,"sessionId":"session-id","uuid":"second","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":4,"cache_read_input_tokens":30,"cache_creation_input_tokens":2}}}`,
		`{"type":"assistant","cwd":"/tmp/claude-project","isSidechain":false,"sessionId":"session-id","uuid":"third","message":{"id":"msg_2","usage":{"input_tokens":1,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}}`,
		`{"type":"assistant","cwd":"/tmp/claude-project","isSidechain":true,"sessionId":"session-id","uuid":"sidechain","message":{"id":"msg_3","usage":{"input_tokens":1000,"output_tokens":1000}}}`,
		`{"type":"assistant","cwd":"/tmp/claude-project","sessionId":"other","message":{"usage":{"input_tokens":1000}}}`,
		`{"type":"assistant","cwd":"/tmp/elsewhere","sessionId":"session-id","message":{"usage":{"input_tokens":1000}}}`,
	}, "\n")
	m, ok := claudeMetricsFromText("/tmp/session-id.jsonl", text, "/tmp/claude-project", "session-id")
	if !ok {
		t.Fatal("session did not correlate")
	}
	assertTokens(t, m, 11, 6, nil, 33, 2, 52)
	if value(m.NativeSessionID) != "session-id" || m.CostUSD != nil {
		t.Fatalf("Claude identity/native cost: %#v", m)
	}
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 0.0001389)
	if _, ok := claudeMetricsFromText("x.jsonl", text, "/tmp/claude-project", "wrong"); ok {
		t.Fatal("wrong exact ID matched")
	}
}

func TestClaudeFallbackKeysAndSaturation(t *testing.T) {
	text := strings.Join([]string{
		`{"type":"assistant","cwd":"p","uuid":"same","message":{"usage":{"input_tokens":99}}}`,
		`{"type":"assistant","cwd":"p","uuid":"same","message":{"usage":{"input_tokens":2}}}`,
		`{"type":"assistant","cwd":"p","message":{"usage":{"input_tokens":3}}}`,
		`{"type":"assistant","cwd":"p","message":{"usage":{"input_tokens":4}}}`,
		`{"type":"user","cwd":"p","message":{"usage":{"input_tokens":999}}}`,
		`not json`,
	}, "\n")
	m, ok := claudeMetricsFromText("fallback.jsonl", text, "p", "")
	if !ok || value(m.NativeSessionID) != "fallback" {
		t.Fatalf("fallback: %#v", m)
	}
	assertTokens(t, m, 9, 0, nil, 0, 0, 9)
	m, ok = claudeMetricsFromText("fallback.jsonl", `{"type":"user","cwd":"p"}`, "p", "")
	if !ok || m.InputTokens != nil || m.TotalTokens != nil {
		t.Fatalf("correlated no-usage session: %#v", m)
	}
	text = `{"type":"assistant","cwd":"p","message":{"usage":{"input_tokens":18446744073709551615,"output_tokens":1}}}` + "\n" + `{"type":"assistant","cwd":"p","message":{"usage":{"input_tokens":1}}}`
	m, _ = claudeMetricsFromText("x.jsonl", text, "p", "")
	assertTokens(t, m, math.MaxUint64, 1, nil, 0, 0, math.MaxUint64)
}

func TestClaudeDiscoveryAndRecovery(t *testing.T) {
	home := isolatedHome(t)
	fakeTool(t, home, "claude", "printf 'fake-claude\\n'")
	started := time.Now()
	root := filepath.Join(os.Getenv("CLAUDE_CONFIG_DIR"), "projects", "encoded-project")
	for i, session := range []string{"old", "new"} {
		path := filepath.Join(root, session+".jsonl")
		writeFixture(t, path, fmt.Sprintf(`{"type":"assistant","cwd":"/project","sessionId":%q,"message":{"usage":{"input_tokens":%d}}}`, session, i+1))
		setModified(t, path, started.Add(time.Duration(i-2)*time.Hour))
	}
	model := config.Model{Tool: config.Claude}
	m, err := CollectMetrics(context.Background(), model, "/project", "ignored-title", started)
	if err != nil || m.NativeSessionID != nil {
		t.Fatal("old Claude session leaked into collection")
	}
	m, err = RecoverMetrics(context.Background(), model, "/project", "ignored-title", started, "old")
	if err != nil || value(m.NativeSessionID) != "old" || value(m.InputTokens) != 1 || value(m.ToolVersion) != "fake-claude" {
		t.Fatalf("exact recovery: %#v, %v", m, err)
	}
	m, _ = RecoverMetrics(context.Background(), model, "/project", "different-title", started, "")
	if value(m.NativeSessionID) != "new" {
		t.Fatal("Claude title must not affect correlation")
	}
	m, _ = RecoverMetrics(context.Background(), model, "/other-project", "", started, "old")
	if m.NativeSessionID != nil {
		t.Fatal("Claude exact ID bypassed directory match")
	}
}

func TestExactRecoveryRejectsPartialTextMatches(t *testing.T) {
	for _, tc := range []struct {
		text         string
		exact, loose bool
	}{
		{"title=run:model directory=/tmp/other", false, true},
		{"title=other directory=/tmp/exact-project", false, true},
		{"title=run:model directory=/tmp/exact-project", true, true},
		{"nothing matching", false, false},
	} {
		if correlatedText(tc.text, "/tmp/exact-project", "run:model", true) != tc.exact || correlatedText(tc.text, "/tmp/exact-project", "run:model", false) != tc.loose {
			t.Fatal(tc.text)
		}
	}
	if value(findSessionIDInText(`first ses_a-b; second ses_next`)) != "ses_a-b" {
		t.Fatal("did not preserve first ASCII ID")
	}
	if findSessionIDInText(`no IDs here`) != nil {
		t.Fatal("invented session ID")
	}
}

func TestOpencodeJSONFallbackRules(t *testing.T) {
	home := isolatedHome(t)
	fakeTool(t, home, "opencode", "printf 'fake-opencode\\n'")
	root := filepath.Join(home, ".opencode")
	started := time.Now()
	model := config.Model{Tool: config.Opencode}
	path := filepath.Join(root, "export.jsonl")
	writeFixture(t, path, `{"role":"assistant","sessionID":"ses_export","directory":"/project","title":"title","tokens":{"input":10}}`)
	setModified(t, path, started.Add(-time.Hour))
	m, err := RecoverMetrics(context.Background(), model, "/project", "title", started, "")
	if err != nil || value(m.NativeSessionID) != "ses_export" || value(m.InputTokens) != 10 {
		t.Fatalf("exact JSON recovery: %#v, %v", m, err)
	}
	m, _ = RecoverMetrics(context.Background(), model, "/project", "wrong", started, "")
	if m.NativeSessionID != nil {
		t.Fatal("partial JSON recovery match accepted")
	}
	m, _ = RecoverMetrics(context.Background(), model, "/project", "title", started, "ses_export")
	if m.NativeSessionID != nil {
		t.Fatal("known OpenCode ID must not fall back to exports")
	}
	m, _ = CollectMetrics(context.Background(), model, "/project", "title", started)
	if m.NativeSessionID != nil {
		t.Fatal("old JSONL should not be a newest-JSON fallback")
	}
	jsonPath := filepath.Join(root, "unrelated.json")
	writeFixture(t, jsonPath, `{"type":"step-finish","sessionID":"ses_fallback","tokens":{"output":3},"cost":0.5}`)
	setModified(t, jsonPath, started.Add(-time.Hour))
	m, _ = CollectMetrics(context.Background(), model, "/project", "title", started)
	if value(m.NativeSessionID) != "ses_fallback" || value(m.OutputTokens) != 3 {
		t.Fatal("uncorrelated fallback must ignore age")
	}
	writeFixture(t, filepath.Join(root, "invalid-newest.json"), `invalid json`)
	m, _ = CollectMetrics(context.Background(), model, "/project", "title", started)
	if m.NativeSessionID != nil {
		t.Fatal("last resort must inspect only newest JSON")
	}
	setModified(t, path, started)
	m, _ = CollectMetrics(context.Background(), model, "/project", "wrong", started)
	if value(m.NativeSessionID) != "ses_export" {
		t.Fatal("live collection must allow directory-only export match")
	}
}

func TestOpencodeMessageUsageTakesPrecedenceOverParts(t *testing.T) {
	text := `{"role":"assistant","sessionID":"ses_test","tokens":{"input":1}}` + "\n" + `{"type":"step-finish","tokens":{"input":100}}`
	m, ok := metricsFromText(text)
	if !ok || value(m.InputTokens) != 1 {
		t.Fatal("double counted message and part usage")
	}
	m, ok = metricsFromText(`{"type":"step-finish","tokens":{"input":100}}`)
	if !ok || value(m.InputTokens) != 100 {
		t.Fatal("part fallback failed")
	}
	m, ok = metricsFromText(`{"id":"ses_empty"}`)
	if !ok || m.InputTokens != nil || value(m.NativeSessionID) != "ses_empty" {
		t.Fatal("ID-only text must be a valid match")
	}
	// Pretty-printed exports were never recursively parsed by Rust.
	m, ok = metricsFromText("{\n  \"sessionID\": \"ses_pretty\",\n  \"role\": \"assistant\",\n  \"tokens\": {\"input\": 100}\n}")
	if !ok || m.InputTokens != nil {
		t.Fatal("changed line-oriented export semantics")
	}
}

func TestMetricsCancellationAndUnsupportedTool(t *testing.T) {
	isolatedHome(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tool := range []config.Tool{config.Pi, config.Opencode, config.Claude} {
		model := config.Model{Tool: tool}
		if _, err := CollectMetrics(ctx, model, "p", "t", time.Now()); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation = %v", err)
		}
		if _, err := RecoverMetrics(ctx, model, "p", "t", time.Now(), "s"); !errors.Is(err, context.Canceled) {
			t.Fatalf("recovery cancellation = %v", err)
		}
	}
	if _, err := CollectMetrics(context.Background(), config.Model{Tool: "unknown"}, "", "", time.Time{}); err == nil {
		t.Fatal("unknown metrics tool accepted")
	}
}

func TestCollectFilesFollowsSymlinksWithoutCycles(t *testing.T) {
	root := t.TempDir()
	actual := t.TempDir()
	writeFixture(t, filepath.Join(actual, "nested", "session.jsonl"), "{}")
	if err := os.Symlink(actual, filepath.Join(root, "sessions")); err != nil {
		t.Skip(err)
	}
	if err := os.Symlink(actual, filepath.Join(actual, "nested", "cycle")); err != nil {
		t.Fatal(err)
	}
	var files []sessionFile
	collectFiles(context.Background(), root, "jsonl", &files)
	if len(files) != 1 || filepath.Base(files[0].path) != "session.jsonl" {
		t.Fatalf("symlink traversal = %#v", files)
	}
}

func TestDefaultSessionRootsAndInvalidUTF8(t *testing.T) {
	home := isolatedHome(t)
	// HOME remains isolated when exercising the default root paths.
	if err := os.Unsetenv("PI_CODING_AGENT_SESSION_DIR"); err != nil {
		t.Fatal(err)
	}
	if err := os.Unsetenv("CLAUDE_CONFIG_DIR"); err != nil {
		t.Fatal(err)
	}
	writeFixture(t, filepath.Join(home, ".pi", "agent", "sessions", "date_pi.jsonl"), `{"cwd":"/project","usage":{"input":1}}`)
	claudeRoot := filepath.Join(home, ".claude", "projects", "encoded-project")
	writeFixture(t, filepath.Join(claudeRoot, "claude.jsonl"), `{"cwd":"/project","type":"assistant","message":{"usage":{"input_tokens":2}}}`)
	writeFixture(t, filepath.Join(claudeRoot, "invalid.jsonl"), "\xff")
	for _, tc := range []struct {
		tool  config.Tool
		sid   string
		input uint64
	}{{config.Pi, "pi", 1}, {config.Claude, "claude", 2}} {
		m, err := CollectMetrics(context.Background(), config.Model{Tool: tc.tool}, "/project", "title", time.Now())
		if err != nil || value(m.NativeSessionID) != tc.sid || value(m.InputTokens) != tc.input {
			t.Fatalf("default root %s: %#v, %v", tc.tool, m, err)
		}
	}
}
