package adapter

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func parsePiMetrics(ctx context.Context, project, title string, since time.Time) Metrics {
	root, set := os.LookupEnv("PI_CODING_AGENT_SESSION_DIR")
	if !set {
		home, err := os.UserHomeDir()
		if err != nil {
			return Metrics{}
		}
		root = filepath.Join(home, ".pi", "agent", "sessions")
	}
	var all []sessionFile
	collectFiles(ctx, root, "jsonl", &all)
	files := all[:0]
	for _, file := range all {
		if !file.modified.Before(since) {
			files = append(files, file)
		}
	}
	sortFiles(files)
	bestScore := 0
	var bestPath, bestText string
	for _, file := range files {
		if ctx.Err() != nil {
			return Metrics{}
		}
		text, ok := readText(file.path)
		if !ok {
			continue
		}
		score := piCorrelationScore(text, project, title)
		if score > 0 && score >= bestScore {
			bestScore, bestPath, bestText = score, file.path, text
		}
	}
	if bestScore == 0 {
		if len(files) != 1 {
			fmt.Fprintf(os.Stderr, "warning: no uniquely correlated Pi session found for %s (%s)\n", project, title)
			return Metrics{}
		}
		var ok bool
		bestPath = files[0].path
		bestText, ok = readText(bestPath)
		if !ok {
			return Metrics{}
		}
	}
	return piMetricsFromText(bestPath, bestText)
}

func piCorrelationScore(text, project, title string) int {
	score := 0
	for i, line := range strings.Split(text, "\n") {
		if i == 20 {
			break
		}
		v := jsonObject(line)
		if cwd, ok := v["cwd"].(string); ok && cwd == project {
			score = max(score, 3)
		}
		if name, ok := v["name"].(string); ok && name == title {
			score = max(score, 2)
		}
	}
	if strings.Contains(text, project) {
		score = max(score, 2)
	}
	if strings.Contains(text, title) {
		score = max(score, 1)
	}
	return score
}

func piMetricsFromText(path, text string) Metrics {
	sid := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	if _, suffix, ok := strings.Cut(sid, "_"); ok {
		sid = suffix
	}
	m := Metrics{NativeSessionID: ptr(sid)}
	var input, output, cacheRead, cacheWrite, total uint64
	var cost float64
	sawUsage := false
	for _, line := range strings.Split(text, "\n") {
		v := jsonObject(line)
		usage, ok := object(v["message"])["usage"]
		if !ok {
			usage, ok = v["usage"]
		}
		if !ok {
			continue
		}
		sawUsage = true
		u := object(usage)
		in := jsonUint(u["input"])
		out := jsonUint(u["output"])
		read := jsonUint(firstField(u, "cacheRead", "cache_read"))
		write := jsonUint(firstField(u, "cacheWrite", "cache_write"))
		input += in
		output += out
		cacheRead += read
		cacheWrite += write
		tokens, ok := optionalUint(firstField(u, "totalTokens", "total_tokens"))
		if !ok {
			tokens = in + out + read + write
		}
		total += tokens
		cost += jsonFloat(object(u["cost"])["total"])
	}
	if sawUsage {
		m.InputTokens = ptr(input)
		m.OutputTokens = ptr(output)
		m.ReasoningTokens = ptr(uint64(0))
		m.CacheReadTokens = ptr(cacheRead)
		m.CacheWriteTokens = ptr(cacheWrite)
		m.TotalTokens = ptr(total)
		m.CostUSD = ptr(cost)
	}
	return m
}
