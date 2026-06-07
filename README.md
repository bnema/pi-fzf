# pi-fzf

`pi-fzf` is a Pi package for searching previous Pi sessions from the shell and from Pi slash commands.

## Pi extension

Install/load the package as a Pi extension, then use `/fzf` in Pi:

- `/fzf` or `/fzf <query>` opens Pi's native selector for cached session snippets.
- `/fzf index`, `/fzf stats`, and `/fzf doctor` manage and inspect the cache.
- `/fzf --external <query>` attempts terminal `fzf` only when TTY-safe; otherwise it falls back to the native selector.

The native selector caps results and asks you to refine the query when matches are truncated. Actions include inserting an exact session reference, sending the snippet to the current session, switching to the source session, or copying/showing the session path and id.

## Development

```sh
npm install
npm run typecheck
npm run build
npm test
```

The `pi-fzf` bin points at the built CLI in `dist/`, so run `npm run build` before invoking it directly.
