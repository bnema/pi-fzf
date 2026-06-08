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

## Use

```text
/fzf thing I remember
```

```bash
pi-fzf "thing I remember"
pi-fzf index --rebuild
pi-fzf doctor
```

## Develop

```bash
make install
npm run typecheck
npm test
pi -e .
```
