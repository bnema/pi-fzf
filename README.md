# pi-fzf

`pi-fzf` is a Pi package for searching previous Pi sessions from the shell and from Pi slash commands. The package is currently scaffolded; indexing and search commands land in later phases.

## Development

```sh
npm install
npm run typecheck
npm run build
npm test
```

The `pi-fzf` bin points at the built CLI in `dist/`, so run `npm run build` before invoking it directly.
