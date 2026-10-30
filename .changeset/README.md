# Changesets

Each pull request adds one file here with its bump and a one-line summary.
`mise exec -- bun run pr open` writes it from the conventional PR title. Each
merge to `main` turns the pending changesets into one release and one
`CHANGELOG.md` section. See `docs/contributing/setup/releases.md`.
