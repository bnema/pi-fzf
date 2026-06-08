# pi-fzf

Search previous Pi sessions from the shell or from Pi with `/fzf`.

## What it does

- Indexes Pi session JSONL files into searchable snippets.
- Uses `rg` for fast candidate filtering.
- Uses `fzf` in the shell and Pi's selector inside Pi.
- Provides `pi-fzf` CLI commands plus the `/fzf` slash command.

## Install

Install the Pi extension:

```bash
pi install git:github.com/bnema/pi-fzf
```

Install the shell command from a checkout:

```bash
git clone https://github.com/bnema/pi-fzf.git
cd pi-fzf
make install
```

## Requirements

- Node.js 20+
- `rg`
- `fzf` for shell selection

## CLI usage

```bash
pi-fzf [query]
pi-fzf search [query]
pi-fzf index [--rebuild]
pi-fzf clean
pi-fzf stats
pi-fzf doctor
pi-fzf candidates --query <query>
pi-fzf preview --key <source:sequence:chunk>
```

Examples:

```bash
pi-fzf "thing I remember"
pi-fzf search "repo bug" --limit 50
pi-fzf search "oauth" --role assistant --project api
pi-fzf search "panic" --since 2026-01-01 --before 2026-02-01
pi-fzf search "exact phrase" --fixed --no-fzf --print-session-path
pi-fzf search "foo|bar" --regex --or --json --no-fzf
pi-fzf index --rebuild
```

Search options:

- `--role <user|assistant|compaction|branch_summary|session>` filters by record role.
- `--project <name>` filters named sessions/projects by substring.
- `--cwd <path>` filters by exact working directory.
- `--since <timestamp>` and `--before <timestamp>` filter by timestamp string.
- `--named-only` only returns sessions with a session name.
- `--fixed` uses fixed-string matching; `--regex` treats the query as a regular expression; default search uses smart-case token matching.
- `--or` matches any query token instead of requiring all tokens.

Output options:

- Default CLI search opens `fzf`.
- `PI_FZF_ENTER=exec` launches the selected Pi session directly on Enter.
- `PI_FZF_ENTER=path`, `id`, or `json` changes Enter output.
- `--json`, `--no-fzf`, and `--print-session-path` are useful for scripts.

## Pi slash command

```text
/fzf thing I remember
```

Selected results are inserted back into the current Pi session as context. If interactive selection is not available, the command returns a compact list of matches.

## Cache and privacy

The cache stores searchable snippets from local Pi session files. Searches refresh the cache before querying.

Paths:

- `PI_FZF_SESSION_ROOT=/path/to/sessions` overrides the Pi session root.
- `PI_FZF_CACHE_DIR=/path/to/cache` overrides the cache root.

Use `pi-fzf clean` to remove stale entries and `pi-fzf doctor` to inspect setup issues.

## Develop

```bash
make install
npm run typecheck
npm test
pi -e .
```
