package adapter

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func parseClaudeMetrics(ctx context.Context, project string, since time.Time, sessionID string) Metrics {
	root, set := os.LookupEnv("CLAUDE_CONFIG_DIR")
	if !set {
		home, err := os.UserHomeDir()
		if err != nil {
			return Metrics{}
		}
		root = filepath.Join(home, ".claude")
	}
	var files []sessionFile
	collectFiles(ctx, filepath.Join(root, "projects"), "jsonl", &files)
	sortFiles(files)
	for i := len(files) - 1; i >= 0; i-- {
		if ctx.Err() != nil {
			break
		}
		file := files[i]
		if file.modified.Before(since) {
			continue
		}
		text, ok := readText(file.path)
		if !ok {
			continue
		}
		if metrics, ok := claudeMetricsFromText(file.path, text, project, sessionID); ok {
			return metrics
		}
	}
	return Metrics{}
}

func claudeMetricsFromText(path, text, project, expectedSessionID string) (Metrics, bool) {
	correlated := false
	var sessionID *string
	usageByMessage := make(map[string]usageBreakdown)
	for index, line := range strings.Split(text, "\n") {
		event := jsonObject(line)
		eventID, hasID := event["sessionId"].(string)
		if expectedSessionID != "" && (!hasID || eventID != expectedSessionID) {
			continue
		}
		cwd, hasCwd := event["cwd"].(string)
		sidechain, _ := event["isSidechain"].(bool)
		if !hasCwd || cwd != project || sidechain {
			continue
		}
		correlated = true
		if hasID {
			sessionID = ptr(eventID)
		}
		if event["type"] != "assistant" {
			continue
		}
		message := object(event["message"])
		u, ok := message["usage"]
		if !ok {
			continue
		}
		usage := object(u)
		key, ok := message["id"].(string)
		if !ok {
			key, ok = event["uuid"].(string)
			if !ok {
				key = strconv.Itoa(index)
			}
		}
		// A later streaming update replaces, rather than adds to, the same message.
		usageByMessage[key] = usageBreakdown{
			input: jsonUint(usage["input_tokens"]), output: jsonUint(usage["output_tokens"]),
			cacheRead: jsonUint(usage["cache_read_input_tokens"]), cacheWrite: jsonUint(usage["cache_creation_input_tokens"]),
		}
	}
	if !correlated {
		return Metrics{}, false
	}
	if sessionID == nil {
		sessionID = ptr(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	}
	m := Metrics{NativeSessionID: sessionID}
	if len(usageByMessage) != 0 {
		var usage usageBreakdown
		for _, u := range usageByMessage {
			usage.input = saturatingAdd(usage.input, u.input)
			usage.output = saturatingAdd(usage.output, u.output)
			usage.cacheRead = saturatingAdd(usage.cacheRead, u.cacheRead)
			usage.cacheWrite = saturatingAdd(usage.cacheWrite, u.cacheWrite)
		}
		m.InputTokens = ptr(usage.input)
		m.OutputTokens = ptr(usage.output)
		m.CacheReadTokens = ptr(usage.cacheRead)
		m.CacheWriteTokens = ptr(usage.cacheWrite)
		m.TotalTokens = ptr(saturatingAdd(saturatingAdd(saturatingAdd(usage.input, usage.output), usage.cacheRead), usage.cacheWrite))
	}
	return m, true
}

func saturatingAdd(a, b uint64) uint64 {
	if math.MaxUint64-a < b {
		return math.MaxUint64
	}
	return a + b
}
