# Releases

Each merge to `main` is a release with a semver version. A changeset in each
pull request says how large the change is. The release turns the changesets
into one version and one section of `CHANGELOG.md`.

## Changesets

A changeset is one Markdown file in `.changeset/`. Its frontmatter names the
bump, and its body is a one-line summary for the changelog:

```md
---
'clutch': minor
---

feat(cli): add clutch init
```

- `patch` is a fix or maintenance, `minor` is a feature, and `major` is a
  breaking change.
- `mise exec -- bun run pr open` writes the changeset from the conventional PR
  title when the branch has none. `fix` gives `patch`, `feat` gives `minor`,
  and `!` gives `major`.
- `check-changeset` fails a change outside `.clutch/` that has no changeset.

## Versions and the changelog

A release reads every pending changeset. The largest bump decides the next
version in the root `package.json`. The release adds one section to
`CHANGELOG.md`, with the summaries grouped by bump, and deletes the changesets.
A stack that merges at once is one release, with one line for each pull
request.

[`tools/release/changeset.ts`](../../../tools/release/changeset.ts) holds the
format, the bump rules and the changelog section.
