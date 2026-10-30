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

## The release workflow

[`release.yml`](../../../.github/workflows/release.yml) runs on each push to
`main`, one run at a time. It checks out the latest `main`, so it sees each
earlier release commit. When changesets are pending, it does these steps:

1. It writes the version and `CHANGELOG.md` with
   [`tools/release/release.ts`](../../../tools/release/release.ts).
2. It commits them as `chore(release): vX.Y.Z` with the GitHub Actions bot.
3. It tags `vX.Y.Z` and pushes the commit and the tag to `main`.
4. It publishes a GitHub release with the changelog section as its notes and
   the `clutch` binaries.

With no pending changesets, the workflow ends without a release. A protected
`main` needs a bypass for the release bot.

## The clutch binary

[`tools/release/binaries.ts`](../../../tools/release/binaries.ts) compiles
`apps/cli` with `bun build --compile` for Linux and macOS, on x64 and arm64.
Each release carries one `clutch-<os>-<arch>.tar.gz` per platform, with one
`clutch` file inside. mise's `github:eggdev/clutch` backend picks the archive
for the machine. Only Clutch has `apps/cli`, so a project's release has no
binaries.

## A project's changelog

`CHANGELOG.md` holds the releases of its own repository. Install and sync never
copy the changelog or the pending changesets of Clutch. Install and
`clutch init` give a new project a `CHANGELOG.md` with a title and no entries,
and `.changeset/README.md`. The project's first release writes its first entry.

[`tools/release/changeset.ts`](../../../tools/release/changeset.ts) holds the
format, the bump rules and the changelog section.
