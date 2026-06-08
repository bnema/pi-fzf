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
pi-fzf index --rebuild
```

## Pi slash command

```text
/fzf thing I remember
```

Selected results are inserted back into the current Pi session as context. If interactive selection is not available, the command returns a compact list of matches.

## Cache and privacy

The cache stores searchable snippets from local Pi session files. Use `pi-fzf clean` to remove stale entries and `pi-fzf doctor` to inspect setup issues.

## Develop

```bash
make install
npm run typecheck
npm test
pi -e .
```
