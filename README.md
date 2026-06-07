# pi-fzf

`pi-fzf` searches previous Pi session JSONL files from either the shell or a Pi `/fzf` slash command. It keeps a local cache of searchable session snippets, uses `rg` as a broad prefilter for dynamic candidate generation, and uses `fzf` or Pi's native selector for picking results.

## Requirements

- Node.js >= 20.
- [`ripgrep`](https://github.com/BurntSushi/ripgrep) (`rg`) for CLI candidate prefiltering.
- [`fzf`](https://github.com/junegunn/fzf) for interactive shell selection. `fzf` >= 0.71 is recommended for stable `--accept-nth`, `--id-nth`, and result tracking behavior.

## Quick start

There are two separate ways to use `pi-fzf`:

1. **Shell search** with `pi-fzf`/`pi-fzf-search`. This does not require loading the Pi plugin.
2. **Pi slash command** with `/fzf`. This requires installing or loading the Pi plugin.

### 1. Build the local checkout

```sh
cd /path/to/pi-fzf
npm install
npm run build
```

### 2. Try shell search

From the checkout:

```sh
node bin/pi-fzf.js "thing I remember"
```

Or install the included wrapper somewhere on your `PATH`:

```sh
mkdir -p ~/.local/bin
cp examples/pi-fzf-search ~/.local/bin/pi-fzf-search
chmod +x ~/.local/bin/pi-fzf-search
pi-fzf-search "thing I remember"
```

The wrapper expects the checkout at `$HOME/dev/projects/pi-fzf`. If yours is elsewhere, set:

```sh
PI_FZF_HOME=/path/to/pi-fzf pi-fzf-search "thing I remember"
```

### 3. Enable `/fzf` inside Pi

Only needed for the Pi slash command:

```sh
pi install /path/to/pi-fzf
```

Then restart Pi and use:

```text
/fzf thing I remember
```

For extension development, load the checkout without installing:

```sh
pi -e /path/to/pi-fzf
```

## CLI usage

```sh
pi-fzf [query]
pi-fzf search [query] [options]
pi-fzf index [--rebuild]
pi-fzf clean
pi-fzf stats
pi-fzf doctor
pi-fzf candidates --query <query>
pi-fzf preview --key <source:sequence:chunk>
```

Common search examples:

```sh
pi-fzf "database migration"
pi-fzf search "oauth" --role assistant --project api
pi-fzf search "panic" --since 2026-01-01 --before 2026-02-01
pi-fzf search "exact phrase" --fixed --no-fzf --print-session-path
pi-fzf search "foo|bar" --regex --or --json --no-fzf
```

Search options:

- `--role <user|assistant|system|tool>` filters by message role.
- `--project <name>` filters named sessions/projects by substring.
- `--cwd <path>` filters by exact working directory.
- `--since <timestamp>` and `--before <timestamp>` filter by timestamp string.
- `--named-only` only returns sessions with a session name.
- `--limit <n>` caps returned candidates.
- `--or` matches any query token instead of all tokens.
- `--fixed` forces fixed-string matching; `--regex` treats the query as a regular expression; the default uses smart-case token matching.

Output/action options:

- Default interactive CLI search opens `fzf` and prints the selected snippet.
- `--no-fzf` prints candidates directly and is useful in scripts or CI.
- `--print-session-path`, `--print-session-id`, `--print-snippet`, and `--json` change non-interactive output and selected-result actions.
- `candidates --query <query>` prints candidate lines for `fzf` reload hooks.
- `preview --key <key>` prints metadata, the selected snippet, and nearby context for an indexed record.

## Pi slash command

After installing or loading the extension, use `/fzf` inside Pi:

- `/fzf` opens Pi's native selector with recent cached session snippets.
- `/fzf <query>` opens the native selector prefiltered by query.
- `/fzf index` synchronizes the cache.
- `/fzf stats` shows cache counts and byte size.
- `/fzf doctor` reports cache consistency issues.
- `/fzf --external <query>` tries terminal `fzf` only when Pi is in a TTY-safe print mode. In the normal Pi UI, external `fzf` cannot safely take over the terminal, so pi-fzf warns and falls back to the native selector.

The native selector is the default Pi experience. It shows up to 150 results and asks you to refine the query when the result set is truncated.

## Result actions and fallbacks

Pi result actions are intentionally safe:

- **Insert session reference** writes a compact session reference into the current editor.
- **Send snippet to current session** sends the selected snippet as a user message with its session reference.
- **Switch/resume session** asks Pi to switch to the source session path. If switching is unavailable in the current UI context, use the copied/shown path or id as the manual fallback.
- **Copy/show path/id** copies the session reference with the best available clipboard tool, or prints/shows it when no clipboard command is available.

The CLI action layer can also build safe resume/fork commands (`pi --resume <session-id>` and `pi --fork <session-id>`) instead of executing them. This keeps scripted usage inspectable; execute those commands manually when you want to resume or fork a result session.

## Cache behavior, privacy, and maintenance

Path resolution:

- Session root defaults to `~/.pi/agent/sessions`.
- Override the session root with `PI_FZF_SESSION_ROOT=/path/to/sessions`.
- Cache root defaults to `$XDG_CACHE_HOME/pi-fzf` or `~/.cache/pi-fzf`.
- Override the cache root with `PI_FZF_CACHE_DIR=/path/to/cache`.

Synchronization:

- `pi-fzf index` and `/fzf index` scan the session root for `*.jsonl` files and update changed or new sources.
- Searches call `syncCache()` before querying so the cache is refreshed before results are shown.
- `pi-fzf index --rebuild` deletes and recreates the cache.
- `pi-fzf clean` removes stale record/session shards not referenced by the manifest.
- `pi-fzf doctor` reports missing sources, missing shards, and manifest/config mismatches.

Privacy and permissions:

- The cache contains excerpts and metadata derived from your Pi session files. Treat it as sensitive.
- Cache directories are created with owner-only permissions (`0700`) and cache files with owner-only read/write permissions (`0600`) where the platform honors POSIX modes.
- Do not publish cache contents, benchmark query output, or session paths unless you have reviewed them for sensitive data.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The `pi-fzf` bin points at the built CLI in `dist/`, so run `npm run build` before invoking it directly.
