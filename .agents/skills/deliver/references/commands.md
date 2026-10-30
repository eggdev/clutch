# Commands

Each step of delivery has one repeatable command. Use it instead of a raw `gh`
or `git` sequence, so every session does the same thing. Run each one through
`mise exec --`, so the pinned tools run. `--help` on any `clutch` command prints
its options, and so does `bun run pr --help`.

## Start work

| Command                                                                           | Use it when                                         | It replaces                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `bun run clutch issues next [--stack]`                                            | You need the next unblocked issue.                  | Reading `TRACKER.md` by eye.                    |
| `bun run clutch issues new --phase <P> --title <title> [--range CL-NNN..CL-NNN]` | You file a new issue, or a lane has a reserved range. | Picking the next id by hand.                    |
| `bun run clutch issues set <id> <status> [--pr <url>]`                            | An issue starts, waits or goes to review.           | Editing frontmatter and the tracker by hand.    |
| `bun run clutch issues --write`                                                   | `TRACKER.md` conflicts after a rebase.              | Resolving tracker conflicts line by line.       |

## Check

| Command                                  | Use it when                                    | It replaces                                  |
| ---------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `bun run validate`                       | Before each push and before you say "done".    | Running checks one by one.                   |
| `bun run clutch doctor [--remote]`       | You want each capability's state, or GitHub's. | Reading workflows and settings by hand.      |
| `bun run clutch doctor --check`          | You changed `clutch.yaml` or a capability.     | Guessing whether a waiver still holds.       |
| `bun run clutch risk [--base <ref>]`     | You want a change's risk tier before a PR.     | Judging the tier from the file list.         |
| `bun run clutch labels [--title <title>]` | You want a change's kind and area labels before a PR. | Choosing `kind/` and `area/` labels by hand. |

`validate` prints the output of each failed task inline, so read it there.

## The pull request loop

See [pull requests](./pull-requests.md) for the rules behind each one. The
[babysit-pr](../../babysit-pr/SKILL.md) skill strings them into rounds that
take a PR to green.

| Command                                                  | Use it when                                          | It replaces                                     |
| -------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `bun run pr doctor [--fix]`                              | Once on each machine.                                | Installing `gh` and its extensions by hand.     |
| `bun run pr open --title <title> --body-file <file>`     | You open a PR, or push to one. Add `--force` after a rebase. | `git push` and `gh pr create`.                  |
| `bun run pr body <number> <file>`                        | Only the PR description changes.                     | `gh pr edit --body-file`.                       |
| `bun run pr status <number>`                             | Before each decision about the PR.                   | `gh pr checks` and reading review comments.     |
| `bun run pr wait <number>`                               | After a push, to wait for the checks.                | A `gh pr checks --watch` or `sleep` loop.       |
| `bun run pr failures <number>`                           | A check failed.                                      | Digging in `gh run view --log`.                 |
| `bun run pr sync <number>`                               | The base moved, or the tracker conflicts.            | A manual rebase, tracker fix, validate and push. |
| `bun run pr ready <id> <number>`                         | The PR is green and ready to merge.                  | `clutch issues set ... done`, commit and push.  |
| `bun run pr merge <number>`                              | The merge rules hold.                                | `gh pr merge` and `gh stack merge`.             |

## Measure

| Command                                       | Use it when                                         | It replaces                          |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| `bun run clutch metrics [--since 30d] [--json]` | You want flow numbers or the dry-run agreement streak. | Counting PRs and reactions by hand. |

## Release

Each merge to the default branch is a release. `pr open` writes the
changeset from the PR title, and the release workflow does the rest. See
[releases](../../../../docs/contributing/setup/releases.md).

| Command                                | Use it when                                  | It replaces                          |
| -------------------------------------- | -------------------------------------------- | ------------------------------------ |
| `bun run clutch sync --check`          | You want to know if a project is behind.     | Comparing files with the template.   |
| `bun run clutch sync`                  | You move a project to the latest release.    | Copying template files by hand.      |
| The `revert` label on a merged PR      | A merged PR must come out.                   | A hand-made `git revert` and PR.     |

## Do not hand-roll

- A loop of `gh pr checks` or `sleep`. Use `pr wait`.
- Digging in `gh run view --log`. Use `pr failures`.
- `gh pr merge` or `gh stack merge`. Use `pr merge`, which handles stacks.
- Fixing `TRACKER.md` conflicts by hand. Use `pr sync`, or `clutch issues --write`.
- Guessing the next issue id. Use `clutch issues new`.

The agent shell hook prints a hint when a session runs one of these `gh`
commands. It never blocks the command.
