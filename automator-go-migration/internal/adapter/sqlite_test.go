package adapter

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"automator/internal/config"
)

func fixtureDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	uri := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, query := range []string{
		`create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, version text)`,
		`create table message (id text primary key, session_id text, time_created integer, data text)`,
		`create table part (id text primary key, session_id text, message_id text, time_created integer, data text)`,
	} {
		execSQL(t, db, query)
	}
	return db
}

func execSQL(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func insertSession(t *testing.T, db *sql.DB, id string, parent any, directory, title string, created, updated time.Time, version any) {
	t.Helper()
	execSQL(t, db, `insert into session values (?,?,?,?,?,?,?)`, id, parent, directory, title, created.UnixMilli(), updated.UnixMilli(), version)
}

func insertMessage(t *testing.T, db *sql.DB, id, session, data string) {
	t.Helper()
	execSQL(t, db, `insert into message values (?,?,?,?)`, id, session, 1, data)
}

func TestSQLiteSessionCorrelationOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.db")
	db := fixtureDB(t, path)
	now := time.Now()
	old := now.Add(-time.Hour)
	insertSession(t, db, "ses_title", nil, "/other", "title", now, now.Add(3*time.Minute), "1")
	insertSession(t, db, "ses_directory", nil, "/project", "other", now, now.Add(2*time.Minute), "1")
	insertSession(t, db, "ses_exact_older", nil, "/project", "title", now, now, "1")
	insertSession(t, db, "ses_exact", nil, "/project", "title", old, now.Add(time.Minute), "1")
	insertSession(t, db, "ses_stale", nil, "/project", "title", old, old, "1")
	for _, tc := range []struct {
		project, title, preferred, want string
		exact                           bool
	}{
		{"/project", "title", "", "ses_exact", false},
		{"/project", "title", "", "ses_exact", true},
		{"/project", "unmatched", "", "ses_directory", false},
		{"/missing", "title", "", "ses_title", false},
		{"/project", "unmatched", "", "", true},
		{"/missing", "title", "", "", true},
		{"/project", "title", "ses_exact_older", "ses_exact_older", true},
		{"/project", "title", "ses_stale", "ses_stale", true},
		{"/project", "title", "ses_title", "", true},
		{"/project", "title", "ses_directory", "", true},
		{"/project", "title", "ses_missing", "", true},
	} {
		m, err := opencodeMetricsFromDB(context.Background(), path, tc.project, tc.title, now, tc.exact, tc.preferred)
		if tc.want == "" {
			if !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("%+v: error %v", tc, err)
			}
		} else if err != nil || value(m.NativeSessionID) != tc.want {
			t.Fatalf("%+v: got %s, error %v", tc, value(m.NativeSessionID), err)
		}
	}
}

func TestSQLiteAggregatesTreeAndPricesOnlySelectedModel(t *testing.T) {
	home := isolatedHome(t)
	path := filepath.Join(home, ".local", "share", "opencode", "sessions '?#.sqlite3")
	db := fixtureDB(t, path)
	now := time.Now()
	project, title, sid := "/project/it's", "title'; drop table session;--", "ses_'quoted"
	insertSession(t, db, sid, nil, project, title, now, now, " db-1.2 ")
	insertSession(t, db, "ses_child", sid, "/child", "different", now, now, "2")
	insertSession(t, db, "ses_grandchild", "ses_child", "/child", "different", now, now, "2")
	insertSession(t, db, "ses_unrelated", nil, "/elsewhere", "different", now, now, "2")
	insertMessage(t, db, "msg_root", sid, `{"role":"assistant","providerID":"kimi-for-coding","modelID":"k3","cost":0.2,"tokens":{"input":10,"output":20,"reasoning":3,"cache":{"read":100,"write":7},"total":140}}`)
	insertMessage(t, db, "msg_child", "ses_child", `{"role":"assistant","providerID":"other","modelID":"model","cost":0.8,"tokens":{"input":50,"output":5}}`)
	insertMessage(t, db, "msg_grandchild", "ses_grandchild", `{"role":"assistant","providerID":"kimi-for-coding","modelID":"k3","cost":0.1,"tokens":{"input":1,"output":2}}`)
	insertMessage(t, db, "msg_unrelated", "ses_unrelated", `{"role":"assistant","cost":99,"tokens":{"input":9999}}`)
	insertMessage(t, db, "msg_user", sid, `{"role":"user","tokens":{"input":999}}`)
	insertMessage(t, db, "msg_invalid", sid, `not json`)
	execSQL(t, db, `insert into part values ('part_duplicate',?,?,1,?)`, sid, "msg_root", `{"type":"step-finish","tokens":{"input":1000},"cost":999}`)
	// A stored session version means even the fake version command must not run.
	versionLog := filepath.Join(home, "version-called")
	t.Setenv("ADAPTER_VERSION_LOG", versionLog)
	fakeTool(t, home, "opencode", `printf 'called' > "$ADAPTER_VERSION_LOG"
printf 'binary-version\n'`)
	model := config.Model{Tool: config.Opencode, Provider: "kimi-for-coding", Model: "k3", Pricing: testPricing()}
	m, err := CollectMetrics(context.Background(), model, project, title, now)
	if err != nil {
		t.Fatal(err)
	}
	assertTokens(t, m, 61, 27, ptr(uint64(3)), 100, 7, 198)
	assertCost(t, m, 1.1)
	if value(m.NativeSessionID) != sid || value(m.ToolVersion) != "db-1.2" {
		t.Fatalf("identity: %#v", m)
	}
	if _, err := os.Stat(versionLog); !os.IsNotExist(err) {
		t.Fatal("version command ran despite stored version")
	}
	ApplyPricing(&m, model.Pricing)
	assertCost(t, m, 0.800459)
	// Fresh exact recovery, including persisted IDs and old history, supports reprice.
	execSQL(t, db, `update session set time_created=1, time_updated=1`)
	setModified(t, path, now.Add(-24*time.Hour))
	m, err = RecoverMetrics(context.Background(), model, project, title, now, sid)
	if err != nil {
		t.Fatal(err)
	}
	ApplyPricing(&m, model.Pricing)
	assertCost(t, m, 0.800459)
	var count int
	if err := db.QueryRow(`select count(*) from session`).Scan(&count); err != nil || count != 4 {
		t.Fatal("read-only query modified sessions")
	}
}

func TestSQLitePartFallbackJoinsModelIdentity(t *testing.T) {
	home := isolatedHome(t)
	path := filepath.Join(home, ".opencode", "sessions.sqlite")
	db := fixtureDB(t, path)
	now := time.Now()
	insertSession(t, db, "ses_root", nil, "/project", "title", now, now, nil)
	insertSession(t, db, "ses_child", "ses_root", "/child", "child", now, now, "2")
	insertMessage(t, db, "msg_root", "ses_root", `{"role":"assistant","providerID":"provider","modelID":"model"}`)
	insertMessage(t, db, "msg_child", "ses_child", `{"role":"assistant","providerID":"other","modelID":"model"}`)
	execSQL(t, db, `insert into part values ('p1','ses_root','msg_root',1,?)`, `{"type":"step-finish","tokens":{"input":10,"output":20},"cost":0.2}`)
	execSQL(t, db, `insert into part values ('p2','ses_child','msg_child',2,?)`, `{"type":"step-finish","tokens":{"input":2,"output":3},"cost":0.8}`)
	execSQL(t, db, `insert into part values ('p3','ses_root','msg_root',3,?)`, `{"type":"text","tokens":{"input":9999},"cost":999}`)
	execSQL(t, db, `insert into part values ('p4','ses_root','missing_message',4,?)`, `{"type":"step-finish","tokens":{"input":9999},"cost":999}`)
	fakeTool(t, home, "opencode", "printf 'binary-version\\n'")
	model := config.Model{Tool: config.Opencode, Provider: "provider", Model: "model"}
	m, err := CollectMetrics(context.Background(), model, "/project", "title", now)
	if err != nil {
		t.Fatal(err)
	}
	assertTokens(t, m, 12, 23, ptr(uint64(0)), 0, 0, 35)
	assertCost(t, m, 1)
	if value(m.ToolVersion) != "binary-version" {
		t.Fatal("missing DB version did not use installed version")
	}
	ApplyPricing(&m, testPricing())
	assertCost(t, m, 0.80033)
	// One message with zero usage suppresses every part, matching Rust's presence test.
	execSQL(t, db, `update message set data=? where id='msg_root'`, `{"role":"assistant","tokens":null}`)
	m, err = CollectMetrics(context.Background(), model, "/project", "title", now)
	if err != nil {
		t.Fatal(err)
	}
	assertTokens(t, m, 0, 0, ptr(uint64(0)), 0, 0, 0)
}

func TestSQLiteNewestDatabaseAndFallbacks(t *testing.T) {
	home := isolatedHome(t)
	root := filepath.Join(home, ".opencode")
	now := time.Now()
	olderPath, newerPath := filepath.Join(root, "older.db"), filepath.Join(root, "newer.db")
	older, newer := fixtureDB(t, olderPath), fixtureDB(t, newerPath)
	insertSession(t, older, "ses_older_exact", nil, "/project", "title", now, now, "1")
	insertSession(t, newer, "ses_newer_partial", nil, "/project", "other", now, now, "2")
	setModified(t, olderPath, now.Add(-time.Minute))
	setModified(t, newerPath, now)
	model := config.Model{Tool: config.Opencode}
	m, err := CollectMetrics(context.Background(), model, "/project", "title", now)
	if err != nil || value(m.NativeSessionID) != "ses_newer_partial" {
		t.Fatal("database order takes priority over cross-database correlation strength")
	}
	m, err = RecoverMetrics(context.Background(), model, "/project", "title", now, "")
	if err != nil || value(m.NativeSessionID) != "ses_older_exact" {
		t.Fatal("exact recovery failed to scan older DB")
	}
	writeFixture(t, filepath.Join(root, "corrupt.db"), "not sqlite")
	m, err = RecoverMetrics(context.Background(), model, "/project", "title", now, "ses_older_exact")
	if err != nil || value(m.NativeSessionID) != "ses_older_exact" {
		t.Fatal("corrupt DB prevented valid DB recovery")
	}
	// Missing version is a schema failure, not a partially accepted SQLite result.
	execSQL(t, older, `alter table session drop column version`)
	writeFixture(t, filepath.Join(root, "export.jsonl"), `{"sessionID":"ses_export","directory":"/project","title":"title","role":"assistant","tokens":{"input":7}}`)
	m, err = RecoverMetrics(context.Background(), model, "/project", "title", now, "")
	if err != nil || value(m.NativeSessionID) != "ses_export" {
		t.Fatal("failed SQLite query did not fall back to correlated export")
	}
	m, err = RecoverMetrics(context.Background(), model, "/project", "title", now, "ses_older_exact")
	if err != nil || m.NativeSessionID != nil {
		t.Fatal("exact ID recovery leaked into export fallback")
	}
}

func TestSQLiteReadOnlyAndCancellation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	if _, err := opencodeMetricsFromDB(context.Background(), path, "p", "t", time.Unix(0, 0), true, ""); err == nil {
		t.Fatal("missing DB unexpectedly queried")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("read-only lookup created database")
	}
	db := fixtureDB(t, path)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := sqliteRows(ctx, db, `select 1`); !errors.Is(err, context.Canceled) {
		t.Fatalf("SQL cancellation: %v", err)
	}
	rows, err := sqliteRows(context.Background(), db, `select ' a ' union all select null union all select char(10) || ' b ' || char(10)`)
	if err != nil || len(rows) != 2 || rows[0] != "a" || rows[1] != "b" {
		t.Fatalf("sqlite CLI line compatibility: %q, %v", rows, err)
	}
}

func TestSQLiteReadsActiveWAL(t *testing.T) {
	home := isolatedHome(t)
	path := filepath.Join(home, ".local", "share", "opencode", "active.db")
	db := fixtureDB(t, path)
	db.SetMaxOpenConns(1)
	execSQL(t, db, `pragma journal_mode=WAL`)
	execSQL(t, db, `pragma wal_autocheckpoint=0`)
	now := time.Now()
	insertSession(t, db, "ses_active", nil, "/project", "title", now, now, "wal-version")
	insertMessage(t, db, "msg", "ses_active", `{"role":"assistant","tokens":{"input":42}}`)
	if _, err := os.Stat(path + "-wal"); err != nil {
		t.Fatal(err)
	}
	m, err := CollectMetrics(context.Background(), config.Model{Tool: config.Opencode}, "/project", "title", now)
	if err != nil || value(m.NativeSessionID) != "ses_active" || value(m.InputTokens) != 42 {
		t.Fatalf("read-only WAL collection: %#v, %v", m, err)
	}
}
