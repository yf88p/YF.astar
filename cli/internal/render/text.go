package render

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Strip terminal controls and directional formatting even for unvalidated tasks.
// Joiners remain for ordinary scripts and emoji; they cannot issue terminal commands.
func sanitize(text string, multiline bool) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	var out strings.Builder
	for _, r := range text {
		switch {
		case r == '\n' || r == '\r':
			if multiline {
				out.WriteByte('\n')
			} else {
				out.WriteByte(' ')
			}
		case r == '\t':
			if multiline {
				out.WriteString("    ")
			} else {
				out.WriteByte(' ')
			}
		case unicode.IsControl(r), unicode.Is(unicode.Cf, r) && r != '\u200c' && r != '\u200d':
			// No ESC, C1 sequences, backspaces, bidi overrides, or invisible separators.
		case unicode.IsSpace(r):
			out.WriteByte(' ')
		default:
			out.WriteRune(r)
		}
	}
	return out.String()
}

type cell struct {
	start, end, width int
}

// This is a small terminal-width approximation, not a Unicode grapheme engine.
// Ambiguous characters occupy one cell; CJK and common emoji occupy two. Marks,
// emoji modifiers, flag pairs and ZWJ sequences stay attached when wrapping.
func cells(text string) []cell {
	var result []cell
	joinNext, emojiBase, regional := false, false, 0
	for i, r := range text {
		mark := unicode.Is(unicode.M, r) || r == '\u200c' || r == '\u200d' || r >= 0x1f3fb && r <= 0x1f3ff
		flag := r >= 0x1f1e6 && r <= 0x1f1ff
		emoji := r >= 0x1f000 && r <= 0x1faff || r >= 0x2300 && r <= 0x27bf
		width := 1
		if mark {
			width = 0
		} else if wide(r) {
			width = 2
		}
		end := i + utf8.RuneLen(r)
		if len(result) > 0 && (mark || joinNext && emoji || flag && regional%2 == 1) {
			last := &result[len(result)-1]
			last.end = end
			last.width = max(last.width, width)
			if r == '\ufe0f' || r == '\u20e3' {
				last.width = 2
			}
		} else {
			result = append(result, cell{i, end, width})
		}
		if !mark {
			joinNext = false
			emojiBase = emoji
		}
		if r == '\u200d' {
			joinNext = emojiBase
		}
		if flag {
			regional++
		} else if !mark {
			regional = 0
		}
	}
	return result
}

func wide(r rune) bool {
	return r >= 0x1100 && (r <= 0x115f || r == 0x2329 || r == 0x232a ||
		r >= 0x231a && r <= 0x231b || r >= 0x23e9 && r <= 0x23ec || r == 0x23f0 || r == 0x23f3 ||
		r >= 0x25fd && r <= 0x25fe || r >= 0x2614 && r <= 0x2615 || r >= 0x2648 && r <= 0x2653 ||
		r == 0x267f || r == 0x2693 || r == 0x26a1 || r >= 0x26aa && r <= 0x26ab ||
		r >= 0x26bd && r <= 0x26be || r >= 0x26c4 && r <= 0x26c5 || r == 0x26ce || r == 0x26d4 ||
		r == 0x26ea || r >= 0x26f2 && r <= 0x26f3 || r == 0x26f5 || r == 0x26fa || r == 0x26fd ||
		r == 0x2705 || r >= 0x270a && r <= 0x270b || r == 0x2728 || r == 0x274c || r == 0x274e ||
		r >= 0x2753 && r <= 0x2755 || r == 0x2757 || r >= 0x2795 && r <= 0x2797 ||
		r == 0x27b0 || r == 0x27bf || r >= 0x2b1b && r <= 0x2b1c || r == 0x2b50 || r == 0x2b55 ||
		r >= 0x2e80 && r <= 0xa4cf && r != 0x303f ||
		r >= 0xac00 && r <= 0xd7a3 || r >= 0xf900 && r <= 0xfaff ||
		r >= 0xfe10 && r <= 0xfe19 || r >= 0xfe30 && r <= 0xfe6f ||
		r >= 0xff01 && r <= 0xff60 || r >= 0xffe0 && r <= 0xffe6 ||
		r == 0x1f004 || r == 0x1f0cf || r == 0x1f18e || r >= 0x1f191 && r <= 0x1f19a ||
		r >= 0x1f1e6 && r <= 0x1f202 || r >= 0x1f210 && r <= 0x1f23b ||
		r >= 0x1f240 && r <= 0x1f248 || r >= 0x1f250 && r <= 0x1f251 ||
		r >= 0x1f300 && r <= 0x1faff ||
		r >= 0x20000 && r <= 0x3fffd)
}

func displayWidth(text string) int {
	width := 0
	for _, cell := range cells(text) {
		width += cell.width
	}
	return width
}

func pad(text string, width int) string {
	return text + strings.Repeat(" ", max(0, width-displayWidth(text)))
}

func wrap(text string, width int) []string {
	width = max(2, width)
	var lines []string
	for _, paragraph := range strings.Split(text, "\n") {
		remaining := cells(paragraph)
		if len(remaining) == 0 {
			lines = append(lines, "")
		}
		for len(remaining) > 0 {
			fit, used, space := 0, 0, -1
			nonspace := false
			for fit < len(remaining) && used+remaining[fit].width <= width {
				c := remaining[fit]
				if paragraph[c.start:c.end] == " " {
					if nonspace {
						space = fit
					}
				} else {
					nonspace = true
				}
				used += c.width
				fit++
			}
			cut, next := fit, fit
			if fit < len(remaining) {
				// A space just beyond the edge is a natural break too.
				if paragraph[remaining[fit].start:remaining[fit].end] == " " {
					next++
				} else if space >= 0 {
					cut, next = space, space+1
				}
				for next < len(remaining) && paragraph[remaining[next].start:remaining[next].end] == " " {
					next++
				}
			}
			lines = append(lines, paragraph[remaining[0].start:remaining[cut-1].end])
			remaining = remaining[next:]
		}
	}
	return lines
}
