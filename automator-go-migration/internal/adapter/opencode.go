package adapter

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

func parseOpencodeMetrics(ctx context.Context, project, title string, since time.Time, allowFallback bool, sessionID string) Metrics {
	home, err := os.UserHomeDir()
	if err != nil {
		return Metrics{}
	}
	roots := []string{
		filepath.Join(home, ".local", "share", "opencode"),
		filepath.Join(home, ".local", "share", "opencode", "storage"),
		filepath.Join(home, ".opencode"),
	}
	if m, ok := parseOpencodeSQLite(ctx, roots, project, title, since, !allowFallback, sessionID); ok {
		return m
	}
	if ctx.Err() != nil {
		return Metrics{}
	}
	if sessionID != "" {
		fmt.Fprintln(os.Stderr, "warning: exact OpenCode session ID was not found in SQLite; refusing an uncorrelated metrics fallback")
		return Metrics{}
	}
	fmt.Fprintln(os.Stderr, "warning: opencode SQLite session correlation unavailable; falling back to JSON/export scan")
	if m, ok := parseOpencodeJSONExports(ctx, roots, project, title, since, !allowFallback); ok {
		return m
	}
	if !allowFallback || ctx.Err() != nil {
		return Metrics{}
	}
	fmt.Fprintf(os.Stderr, "warning: no correlated opencode metrics found for title '%s'; using newest JSON fallback if present\n", title)
	var files []sessionFile
	for _, root := range roots {
		collectFiles(ctx, root, "json", &files)
	}
	sortFiles(files)
	// This last resort intentionally ignores age and inspects only the newest JSON.
	if len(files) != 0 {
		if text, ok := readText(files[len(files)-1].path); ok {
			m, _ := metricsFromText(text)
			return m
		}
	}
	return Metrics{}
}

func parseOpencodeSQLite(ctx context.Context, roots []string, project, title string, since time.Time, requireExact bool, preferredSessionID string) (Metrics, bool) {
	var dbs []sessionFile
	for _, root := range roots {
		for _, ext := range []string{"db", "sqlite", "sqlite3"} {
			collectFiles(ctx, root, ext, &dbs)
		}
	}
	sortFiles(dbs)
	for i := len(dbs) - 1; i >= 0; i-- {
		if ctx.Err() != nil {
			break
		}
		file := dbs[i]
		if file.modified.Before(since) {
			continue
		}
		m, err := opencodeMetricsFromDB(ctx, file.path, project, title, since, requireExact, preferredSessionID)
		if err == nil {
			return m, true
		}
		if err != sql.ErrNoRows && ctx.Err() == nil {
			fmt.Fprintf(os.Stderr, "warning: failed to query opencode SQLite DB %s\n", file.path)
		}
	}
	return Metrics{}, false
}

func opencodeMetricsFromDB(ctx context.Context, path, project, title string, since time.Time, requireExact bool, preferredSessionID string) (Metrics, error) {
	path, err := nonCredentialPath(path)
	if err != nil {
		return Metrics{}, err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return Metrics{}, err
	}
	uri := url.URL{Scheme: "file", Path: filepath.ToSlash(abs), RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return Metrics{}, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var sessionID string
	if preferredSessionID != "" {
		err = db.QueryRowContext(ctx, "select id from session where id=? and directory=? and title=? limit 1", preferredSessionID, project, title).Scan(&sessionID)
	} else {
		correlation := "directory=? or title=?"
		if requireExact {
			correlation = "directory=? and title=?"
		}
		err = db.QueryRowContext(ctx,
			"select id from session where ("+correlation+") and (time_created >= ? or time_updated >= ?) order by case when directory=? and title=? then 0 when directory=? then 1 else 2 end, time_updated desc limit 1",
			project, title, since.UnixMilli(), since.UnixMilli(), project, title, project).Scan(&sessionID)
	}
	if err != nil {
		return Metrics{}, err
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return Metrics{}, sql.ErrNoRows
	}
	const tree = "with recursive session_tree(id) as (select ? union all select session.id from session join session_tree on session.parent_id=session_tree.id) "
	rows, err := sqliteRows(ctx, db, tree+"select data from message where session_id in (select id from session_tree) order by time_created", sessionID)
	if err != nil {
		return Metrics{}, err
	}
	m := metricsFromOpencodeRows(sessionID, rows, false)
	if m.InputTokens == nil && m.OutputTokens == nil {
		rows, err = sqliteRows(ctx, db, tree+"select json_set(part.data, '$.providerID', json_extract(message.data, '$.providerID'), '$.modelID', json_extract(message.data, '$.modelID')) from part join message on message.id=part.message_id where part.session_id in (select id from session_tree) order by part.time_created", sessionID)
		if err != nil {
			return Metrics{}, err
		}
		m = metricsFromOpencodeRows(sessionID, rows, true)
	}
	versions, err := sqliteRows(ctx, db, "select version from session where id=? limit 1", sessionID)
	if err != nil {
		return Metrics{}, err
	}
	if len(versions) != 0 {
		m.ToolVersion = ptr(versions[0])
	}
	return m, nil
}

// Keep sqlite3 CLI's trimmed, nonempty line semantics even for SQL NULL and
// multiline data. All SQL parameters remain bound, never shell- or SQL-expanded.
func sqliteRows(ctx context.Context, db *sql.DB, query string, args ...any) ([]string, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var text sql.NullString
		if err := rows.Scan(&text); err != nil {
			return nil, err
		}
		for _, line := range strings.Split(text.String, "\n") {
			if line = strings.TrimSpace(line); line != "" {
				result = append(result, line)
			}
		}
	}
	return result, rows.Err()
}

func parseOpencodeJSONExports(ctx context.Context, roots []string, project, title string, since time.Time, requireExact bool) (Metrics, bool) {
	var files []sessionFile
	for _, root := range roots {
		collectFiles(ctx, root, "json", &files)
		collectFiles(ctx, root, "jsonl", &files)
	}
	sortFiles(files)
	for i := len(files) - 1; i >= 0; i-- {
		if ctx.Err() != nil {
			break
		}
		file := files[i]
		if file.modified.Before(since) {
			continue
		}
		if text, ok := readText(file.path); ok && correlatedText(text, project, title, requireExact) {
			if m, ok := metricsFromText(text); ok {
				return m, true
			}
		}
	}
	return Metrics{}, false
}

func correlatedText(text, project, title string, requireExact bool) bool {
	hasTitle := strings.Contains(text, title)
	hasDirectory := strings.Contains(text, project)
	if requireExact {
		return hasTitle && hasDirectory
	}
	return hasTitle || hasDirectory
}

func metricsFromText(text string) (Metrics, bool) {
	rows := strings.Split(text, "\n")
	sid := findSessionIDInText(text)
	m := metricsFromOpencodeRows(value(sid), rows, false)
	if m.InputTokens == nil && m.OutputTokens == nil {
		m = metricsFromOpencodeRows(value(sid), rows, true)
	}
	if m.NativeSessionID == nil {
		m.NativeSessionID = sid
	}
	return m, m.NativeSessionID != nil || m.TotalTokens != nil || m.CostUSD != nil
}

func metricsFromOpencodeRows(sessionID string, rows []string, parts bool) Metrics {
	var m Metrics
	if sessionID != "" {
		m.NativeSessionID = ptr(sessionID)
	}
	for _, row := range rows {
		v := jsonObject(row)
		if (!parts && v["role"] == "assistant") || (parts && v["type"] == "step-finish") {
			addOpencodeUsage(&m, v)
		}
	}
	return m
}

func addOpencodeUsage(m *Metrics, v map[string]any) {
	t, ok := v["tokens"]
	if !ok {
		return
	}
	tokens := object(t)
	input := jsonUint(tokens["input"])
	output := jsonUint(tokens["output"])
	reasoning := jsonUint(tokens["reasoning"])
	cache := object(tokens["cache"])
	read, write := jsonUint(cache["read"]), jsonUint(cache["write"])
	total, ok := optionalUint(tokens["total"])
	if !ok {
		total = input + output + reasoning + read + write
	}
	m.InputTokens = ptr(value(m.InputTokens) + input)
	m.OutputTokens = ptr(value(m.OutputTokens) + output)
	m.ReasoningTokens = ptr(value(m.ReasoningTokens) + reasoning)
	m.CacheReadTokens = ptr(value(m.CacheReadTokens) + read)
	m.CacheWriteTokens = ptr(value(m.CacheWriteTokens) + write)
	m.TotalTokens = ptr(value(m.TotalTokens) + total)
	nativeCost := jsonFloat(v["cost"])
	if _, ok := v["cost"]; ok {
		m.CostUSD = ptr(value(m.CostUSD) + nativeCost)
	}
	provider, hasProvider := v["providerID"].(string)
	model, hasModel := v["modelID"].(string)
	if hasProvider && hasModel {
		if m.usageByModel == nil {
			m.usageByModel = make(map[string]usageBreakdown)
		}
		key := usageKey(provider, model)
		u := m.usageByModel[key]
		u.input += input
		u.output += output
		u.reasoning += reasoning
		u.cacheRead += read
		u.cacheWrite += write
		u.nativeCost += nativeCost
		m.usageByModel[key] = u
	}
}

func findSessionIDInText(text string) *string {
	for _, part := range strings.FieldsFunc(text, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-')
	}) {
		if strings.HasPrefix(part, "ses_") {
			return ptr(part)
		}
	}
	return nil
}
