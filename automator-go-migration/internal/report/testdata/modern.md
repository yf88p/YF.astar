# Benchmark | raw

| Model | Provider | Tool | Status | Duration | Input (cache miss) | Cache hit | Cache write | Output | Reasoning | Total Tokens | Cost | Project | Session |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Alpha | open|router | opencode | Done | 2m 5s | 123 | 0 | 7 | 5 | 2 | 999 | $1.2346 | ./Alpha | ses'one |
| zulu | anthropic | claude | Queued |  |  |  |  |  |  |  |  | <outside> |  |

## Reopen

- herdr: `herdr session attach 'team'\''s run; $(ignored)'`
- Alpha tool session: `cd 'a path' && opencode --session 'ses'\''one'`
- Alpha herdr: `herdr custom 'saved command'`
- zulu tool session: `claude --resume '<session-id>'`
