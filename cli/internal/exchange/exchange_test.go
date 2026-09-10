package exchange

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"time"

	"kanban/internal/model"
)

func testTask(id, title string) model.Task {
	now := time.Date(2026, time.September, 7, 12, 30, 0, 123456789, time.UTC)
	return model.Task{
		ID: id, Title: title, Description: "First line\n\tSecond line", Status: "todo",
		Priority: "medium", Tags: []string{"work", "caf\u00e9"}, Due: "2028-02-29",
		CreatedAt: now, UpdatedAt: now.Add(time.Hour),
	}
}

func assertBoardsEqual(t *testing.T, want, got model.Board) {
	t.Helper()
	if want.Version != got.Version || len(want.Tasks) != len(got.Tasks) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
	for i, expected := range want.Tasks {
		actual := got.Tasks[i]
		if !expected.CreatedAt.Equal(actual.CreatedAt) || !expected.UpdatedAt.Equal(actual.UpdatedAt) {
			t.Fatalf("task %d timestamps changed: got %#v, want %#v", i, actual, expected)
		}
		expected.CreatedAt, actual.CreatedAt = time.Time{}, time.Time{}
		expected.UpdatedAt, actual.UpdatedAt = time.Time{}, time.Time{}
		if !reflect.DeepEqual(expected, actual) {
			t.Fatalf("task %d: got %#v, want %#v", i, actual, expected)
		}
	}
}

func TestJSONRoundTrip(t *testing.T) {
	board := model.NewBoard()
	for i, status := range []string{"todo", "doing", "done", "todo"} {
		task := testTask([]string{"0123abcd", "1234abcd", "2345abcd", "3456abcd"}[i], "Ship \u4e16\u754c <&> \"quoted\"")
		task.Status = status
		task.Priority = []string{"low", "medium", "high", "urgent"}[i]
		if i == 1 {
			task.Due = ""
			task.Tags = []string{}
			task.Description = ""
			task.CreatedAt = task.CreatedAt.In(time.FixedZone("local", -7*60*60))
		}
		if i == 2 {
			task.CreatedAt = task.CreatedAt.In(time.FixedZone("sub-minute offset", 61))
			task.UpdatedAt = task.UpdatedAt.In(time.FixedZone("sub-minute offset", 61))
		}
		board.Tasks = append(board.Tasks, task)
	}
	var out bytes.Buffer
	if err := JSON(&out, board); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.String(), "{\n  \"version\": 1,\n  \"tasks\": [\n") || !strings.HasSuffix(out.String(), "\n") {
		t.Fatalf("not pretty versioned JSON with final newline: %s", out.String())
	}
	if strings.Count(out.String(), `"due"`) != 3 {
		t.Fatalf("optional empty due was not omitted: %s", out.String())
	}
	decoded, err := Decode(&out)
	if err != nil {
		t.Fatal(err)
	}
	assertBoardsEqual(t, board, decoded)
}

func TestJSONEmptyCollections(t *testing.T) {
	for _, board := range []model.Board{
		model.NewBoard(), {Version: 1},
		{Version: 1, Tasks: []model.Task{func() model.Task {
			task := testTask("0123abcd", "No tags")
			task.Tags = nil
			return task
		}()}},
	} {
		var out bytes.Buffer
		if err := JSON(&out, board); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(out.String(), "null") {
			t.Fatalf("export contains null collection: %s", out.String())
		}
		got, err := Decode(&out)
		if err != nil || got.Tasks == nil {
			t.Fatalf("Decode() = %#v, %v", got, err)
		}
		if len(board.Tasks) > 0 && (board.Tasks[0].Tags != nil || got.Tasks[0].Tags == nil) {
			t.Fatal("JSON must normalize nil tags without changing input")
		}
	}
}

func TestDecodeRejectsBadJSON(t *testing.T) {
	task, err := json.Marshal(testTask("0123abcd", "Title"))
	if err != nil {
		t.Fatal(err)
	}
	wrap := func(task string) string { return `{"version":1,"tasks":[` + task + `]}` }
	valid := wrap(string(task))
	for _, test := range []struct{ name, input string }{
		{"empty", ""},
		{"whitespace", " \n\t"},
		{"null", "null"},
		{"array", "[]"},
		{"scalar", "1"},
		{"missing fields", "{}"},
		{"missing version", `{"tasks":[]}`},
		{"missing tasks", `{"version":1}`},
		{"null version", `{"version":null,"tasks":[]}`},
		{"null tasks", `{"version":1,"tasks":null}`},
		{"tasks object", `{"version":1,"tasks":{}}`},
		{"string version", `{"version":"1","tasks":[]}`},
		{"fractional version", `{"version":1.5,"tasks":[]}`},
		{"future version", `{"version":2,"tasks":[]}`},
		{"zero version", `{"version":0,"tasks":[]}`},
		{"unknown board field", `{"version":1,"tasks":[],"extra":false}`},
		{"case folded board field", `{"Version":1,"tasks":[]}`},
		{"duplicate board field", `{"version":1,"version":1,"tasks":[]}`},
		{"escaped duplicate board field", `{"version":1,"\u0076ersion":1,"tasks":[]}`},
		{"trailing object", valid + `{}`},
		{"trailing null", valid + ` null`},
		{"trailing garbage", valid + `x`},
		{"truncated", valid[:len(valid)-1]},
		{"null task", wrap("null")},
		{"scalar task", wrap(`"task"`)},
		{"empty task", wrap(`{}`)},
		{"duplicate ID", wrap(string(task) + "," + string(task))},
		{"unknown task field", wrap(strings.Replace(string(task), `"title":`, `"extra":0,"title":`, 1))},
		{"case folded task field", wrap(strings.Replace(string(task), `"title":`, `"Title":`, 1))},
		{"duplicate task field", wrap(strings.Replace(string(task), `"title":`, `"title":"earlier","title":`, 1))},
		{"blank title", strings.Replace(valid, `"Title"`, `" "`, 1)},
		{"control title", strings.Replace(valid, `"Title"`, `"hello\u001b[31m"`, 1)},
		{"tab title", strings.Replace(valid, `"Title"`, `"hello\tworld"`, 1)},
		{"invalid status", strings.Replace(valid, `"todo"`, `"blocked"`, 1)},
		{"invalid priority", strings.Replace(valid, `"medium"`, `"critical"`, 1)},
		{"bad date", strings.Replace(valid, `"2028-02-29"`, `"2026-02-29"`, 1)},
		{"bad ID", strings.Replace(valid, `"0123abcd"`, `"0123ABCd"`, 1)},
		{"null tag element", strings.Replace(valid, `"work"`, `null`, 1)},
		{"empty tag", strings.Replace(valid, `"work"`, `""`, 1)},
		{"blank tag", strings.Replace(valid, `"work"`, `"  "`, 1)},
		{"Unicode blank tag", strings.Replace(valid, `"work"`, `"\u2003"`, 1)},
		{"control tag", strings.Replace(valid, `"work"`, `"a\nb"`, 1)},
		{"invalid UTF8", strings.Replace(valid, "Title", string([]byte{0xff}), 1)},
		{"unpaired high surrogate", strings.Replace(valid, "Title", `\ud800`, 1)},
		{"unpaired low surrogate", strings.Replace(valid, "Title", `\udc00`, 1)},
		{"bad surrogate pair", strings.Replace(valid, "Title", `\ud800\u0061`, 1)},
		{"zero created", strings.Replace(valid, `2026-09-07T12:30:00.123456789Z`, `0001-01-01T00:00:00Z`, 1)},
		{"updated before created", strings.Replace(valid, `2026-09-07T13:30:00.123456789Z`, `2026-09-07T12:30:00.123456788Z`, 1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := Decode(strings.NewReader(test.input))
			if err == nil || !reflect.DeepEqual(got, model.Board{}) {
				t.Fatalf("Decode() = %#v, %v; want zero board and error", got, err)
			}
		})
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(task, &fields); err != nil {
		t.Fatal(err)
	}
	for name, value := range fields {
		t.Run("null field "+name, func(t *testing.T) {
			fields[name] = json.RawMessage("null")
			raw, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Decode(strings.NewReader(wrap(string(raw)))); err == nil {
				t.Fatalf("accepted null %s", name)
			}
			fields[name] = value
		})
		if name != "due" {
			t.Run("missing field "+name, func(t *testing.T) {
				delete(fields, name)
				raw, err := json.Marshal(fields)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := Decode(strings.NewReader(wrap(string(raw)))); err == nil {
					t.Fatalf("accepted missing %s", name)
				}
				fields[name] = value
			})
		}
	}
}

func TestDecodeUnicodeEscapes(t *testing.T) {
	for _, title := range []string{`\ud83d\ude80`, `literal \\ud800`, `replacement \ufffd`, `escaped quote \" and slash \\`} {
		task, err := json.Marshal(testTask("0123abcd", "Title"))
		if err != nil {
			t.Fatal(err)
		}
		input := `{"version":1,"tasks":[` + strings.Replace(string(task), "Title", title, 1) + `]}`
		if _, err := Decode(strings.NewReader(" \n" + input + "\t\n")); err != nil {
			t.Errorf("rejected valid escaped text %q: %v", title, err)
		}
	}
}

type spacesReader struct{}

func (spacesReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = ' '
	}
	return len(p), nil
}

func TestDecodeSizeLimit(t *testing.T) {
	const valid = `{"version":1,"tasks":[]}`
	for _, extra := range []int64{0, 1} {
		input := io.MultiReader(strings.NewReader(valid), io.LimitReader(spacesReader{}, maxInputSize-int64(len(valid))+extra))
		_, err := Decode(input)
		if (err == nil) != (extra == 0) {
			t.Fatalf("input size %d: %v", maxInputSize+extra, err)
		}
	}
	if _, err := Decode(spacesReader{}); err == nil || !strings.Contains(err.Error(), "32 MiB") {
		t.Fatalf("unbounded reader did not stop at size limit: %v", err)
	}
}

type failingIO struct{ err error }

func (f failingIO) Read([]byte) (int, error)  { return 0, f.err }
func (f failingIO) Write([]byte) (int, error) { return 0, f.err }

func TestIOErrorsAndValidationBeforeWrite(t *testing.T) {
	sentinel := errors.New("I/O failed")
	if _, err := Decode(io.MultiReader(strings.NewReader(`{"version":1,"tasks":[]}`), failingIO{sentinel})); !errors.Is(err, sentinel) {
		t.Fatalf("reader error lost: %v", err)
	}
	for _, export := range []struct {
		name string
		fn   func(io.Writer, model.Board) error
	}{{"JSON", JSON}, {"Markdown", Markdown}} {
		t.Run(export.name, func(t *testing.T) {
			if err := export.fn(failingIO{sentinel}, model.NewBoard()); !errors.Is(err, sentinel) {
				t.Fatalf("writer error lost: %v", err)
			}
			for _, board := range []model.Board{{}, {Version: 1, Tasks: []model.Task{{}}}} {
				var out bytes.Buffer
				if err := export.fn(&out, board); err == nil || out.Len() != 0 {
					t.Fatalf("invalid board must fail without output: %q, %v", out.String(), err)
				}
			}
		})
	}
}

func TestMergeAppendSkipAndIdempotence(t *testing.T) {
	first := testTask("0123abcd", "Existing")
	second := testTask("1234abcd", "New")
	second.Priority = "urgent"
	third := testTask("2345abcd", "Another")
	dst := model.Board{Version: 1, Tasks: []model.Task{first}}
	src := model.Board{Version: 1, Tasks: []model.Task{second, first, third}}
	src.Tasks[1].CreatedAt = first.CreatedAt.In(time.FixedZone("other", 5*60*60))
	src.Tasks[1].UpdatedAt = first.UpdatedAt.In(time.FixedZone("other", 5*60*60))
	added, skipped, err := Merge(&dst, src)
	if err != nil || added != 2 || skipped != 1 {
		t.Fatalf("Merge() = %d, %d, %v", added, skipped, err)
	}
	assertBoardsEqual(t, model.Board{Version: 1, Tasks: []model.Task{first, second, third}}, dst)
	added, skipped, err = Merge(&dst, src)
	if err != nil || added != 0 || skipped != 3 || len(dst.Tasks) != 3 {
		t.Fatalf("second Merge() = %d, %d, %v; tasks=%d", added, skipped, err, len(dst.Tasks))
	}
	added, skipped, err = Merge(&dst, dst)
	if err != nil || added != 0 || skipped != 3 {
		t.Fatalf("self merge = %d, %d, %v", added, skipped, err)
	}
	src.Tasks[0].Tags[0] = "source change"
	if dst.Tasks[1].Tags[0] != "work" {
		t.Fatal("added task tags alias the source")
	}
	src.Tasks[0].Title = "source title change"
	if dst.Tasks[1].Title != "New" {
		t.Fatal("destination task array aliases the source")
	}
}

func TestMergeCollisionIsTransactional(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*model.Task)
	}{
		{"title", func(v *model.Task) { v.Title += " changed" }},
		{"description", func(v *model.Task) { v.Description += " changed" }},
		{"status", func(v *model.Task) { v.Status = "doing" }},
		{"priority", func(v *model.Task) { v.Priority = "high" }},
		{"urgent priority", func(v *model.Task) { v.Priority = "urgent" }},
		{"tags", func(v *model.Task) { v.Tags = []string{"different"} }},
		{"tag order", func(v *model.Task) { v.Tags = []string{"caf\u00e9", "work"} }},
		{"due", func(v *model.Task) { v.Due = "2028-03-01" }},
		{"created", func(v *model.Task) { v.CreatedAt = v.CreatedAt.Add(-time.Nanosecond) }},
		{"updated", func(v *model.Task) { v.UpdatedAt = v.UpdatedAt.Add(time.Nanosecond) }},
	} {
		t.Run(test.name, func(t *testing.T) {
			existing := testTask("0123abcd", "Existing")
			skippedTask := testTask("2345abcd", "Skipped")
			backing := []model.Task{existing, skippedTask, testTask("ffffffff", "Sentinel")}
			dst := model.Board{Version: 1, Tasks: backing[:2]}
			collision := testTask("0123abcd", "Existing")
			test.change(&collision)
			src := model.Board{Version: 1, Tasks: []model.Task{testTask("1234abcd", "New"), skippedTask, collision}}
			beforeBacking, _ := json.Marshal(backing)
			beforeSource, _ := json.Marshal(src)
			added, skipped, err := Merge(&dst, src)
			if err == nil || added != 0 || skipped != 0 {
				t.Fatalf("Merge() = %d, %d, %v; want 0, 0, error", added, skipped, err)
			}
			afterBacking, _ := json.Marshal(backing)
			afterSource, _ := json.Marshal(src)
			if len(dst.Tasks) != 2 || !bytes.Equal(beforeBacking, afterBacking) || !bytes.Equal(beforeSource, afterSource) {
				t.Fatal("failed merge changed destination, its spare capacity, or source")
			}
		})
	}
}

func TestMergeValidatesBothBoards(t *testing.T) {
	task := testTask("0123abcd", "Title")
	invalid := []model.Board{
		{Version: 2},
		{Version: 1, Tasks: []model.Task{{}}},
		{Version: 1, Tasks: []model.Task{task, task}},
	}
	for _, board := range invalid {
		for _, badSource := range []bool{false, true} {
			dst, src := model.NewBoard(), board
			if !badSource {
				dst, src = board, model.NewBoard()
			}
			beforeDst, _ := json.Marshal(dst)
			beforeSrc, _ := json.Marshal(src)
			added, skipped, err := Merge(&dst, src)
			if err == nil || added != 0 || skipped != 0 {
				t.Fatalf("invalid input accepted: %d, %d, %v", added, skipped, err)
			}
			afterDst, _ := json.Marshal(dst)
			afterSrc, _ := json.Marshal(src)
			if !bytes.Equal(beforeDst, afterDst) || !bytes.Equal(beforeSrc, afterSrc) {
				t.Fatal("invalid merge changed an input")
			}
		}
	}
	if added, skipped, err := Merge(nil, model.NewBoard()); err == nil || added != 0 || skipped != 0 {
		t.Fatalf("nil destination: %d, %d, %v", added, skipped, err)
	}
}

func TestMergeSharedStorageAndEmptyTags(t *testing.T) {
	first := testTask("0123abcd", "First")
	first.Tags = nil
	second := testTask("1234abcd", "Second")
	shared := []model.Task{first, second}
	dst := model.Board{Version: 1, Tasks: shared[:1]}
	src := model.Board{Version: 1, Tasks: shared}
	added, skipped, err := Merge(&dst, src)
	if err != nil || added != 1 || skipped != 1 {
		t.Fatalf("shared storage merge: %d, %d, %v", added, skipped, err)
	}
	dst.Tasks[1].Title = "Destination change"
	if src.Tasks[1].Title != "Second" {
		t.Fatal("merge reused shared task backing array")
	}
	first.Tags = []string{}
	if added, skipped, err := Merge(&dst, model.Board{Version: 1, Tasks: []model.Task{first}}); err != nil || added != 0 || skipped != 1 {
		t.Fatalf("nil and empty tags should compare equally: %d, %d, %v", added, skipped, err)
	}
}

func TestMarkdownGroupingAndEscaping(t *testing.T) {
	todo := testTask("0123abcd", "[x] *bold* `tick` & <img src=x onerror=alert(1)>")
	todo.Tags = []string{"<tag>", "x|y", "[link](https://example.com)"}
	todo.Description = "first line\n\n# heading\n- [x] forged\n    <script>alert('x')</script>\n\tTabbed\n[link](javascript:alert(1))"
	doing := testTask("1234abcd", "In progress")
	doing.Status, doing.Priority, doing.Due = "doing", "urgent", ""
	done := testTask("2345abcd", "Finished")
	done.Status, done.Priority = "done", "low"
	board := model.Board{Version: 1, Tasks: []model.Task{done, todo, doing}}
	var out bytes.Buffer
	if err := Markdown(&out, board); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	for _, fragment := range []string{
		"# Kanban Board\n", "## Todo\n", "## Doing\n", "## Done\n",
		"- [ ] In progress\n", "- [x] Finished\n",
		"ID: `0123abcd`", "Priority: medium", "Priority: urgent", "Priority: low",
		"Tags: &lt;tag&gt;, x\\|y", "Due: 2028-02-29",
		"Created: 2026-09-07T12:30:00.123456789Z", "Updated: 2026-09-07T13:30:00.123456789Z",
		"- [ ] \\[x\\] \\*bold\\* \\`tick\\` &amp; &lt;img",
		"  > first line  \n  >   \n  > \\# heading  \n  > \\- \\[x\\] forged",
		"  > &#32;&#32;&#32;&#32;&lt;script&gt;", "  > &#9;Tabbed",
		`\[link\]\(javascript\:alert\(1\)\)`,
	} {
		if !strings.Contains(text, fragment) {
			t.Errorf("missing Markdown fragment %q in:\n%s", fragment, text)
		}
	}
	for _, unsafe := range []string{"<img", "<script", "</script>", "\n# heading", "\n- [x] forged", "[link](javascript:", "[link](https:", "x|y"} {
		if strings.Contains(text, unsafe) {
			t.Errorf("unsafe unescaped fragment %q in:\n%s", unsafe, text)
		}
	}
	if strings.Index(text, "## Todo") > strings.Index(text, "## Doing") ||
		strings.Index(text, "## Doing") > strings.Index(text, "## Done") ||
		strings.Index(text, "0123abcd") > strings.Index(text, "1234abcd") ||
		strings.Index(text, "1234abcd") > strings.Index(text, "2345abcd") {
		t.Fatalf("tasks not grouped in status order:\n%s", text)
	}
	if board.Tasks[0].Status != "done" || board.Tasks[1].Title != todo.Title || board.Tasks[1].Tags[0] != "<tag>" {
		t.Fatal("Markdown changed input")
	}
}

func TestMarkdownEmptyBoard(t *testing.T) {
	var out bytes.Buffer
	if err := Markdown(&out, model.NewBoard()); err != nil {
		t.Fatal(err)
	}
	want := "# Kanban Board\n\n## Todo\n\nNo tasks.\n\n## Doing\n\nNo tasks.\n\n## Done\n\nNo tasks.\n"
	if out.String() != want {
		t.Fatalf("got %q, want %q", out.String(), want)
	}
}

func FuzzDecode(f *testing.F) {
	valid, err := json.Marshal(model.Board{Version: 1, Tasks: []model.Task{testTask("0123abcd", "Title")}})
	if err != nil {
		f.Fatal(err)
	}
	f.Add(string(valid))
	for _, seed := range []string{"", "null", `{"version":1,"tasks":[]}`, `{"version":1,"tasks":[null]}`, `{"\ud800":1}`, `{"version":1,"tasks":[],"version":2}`} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		board, err := Decode(strings.NewReader(input))
		if err != nil {
			return
		}
		if err := model.ValidateBoard(board); err != nil {
			t.Fatalf("Decode returned invalid board: %v", err)
		}
		var out bytes.Buffer
		if err := JSON(&out, board); err != nil {
			t.Fatal(err)
		}
		roundTrip, err := Decode(&out)
		if err != nil {
			t.Fatal(err)
		}
		assertBoardsEqual(t, board, roundTrip)
	})
}
