# Clutch tracker

This folder is the task tracker for Clutch work. [`PLAN.md`](./PLAN.md) says what each phase means and why the issues sit where they do. It holds one Markdown file per issue in `issues/CL-NNN.md`. `TRACKER.md` is generated from those files on `main`, by the release workflow. A pull request commits only its own `issues/CL-NNN.md` changes, never `TRACKER.md`, so open PRs never conflict on it.

## One issue per PR

Each issue gets one branch (`clutch/cl-NNN-<slug>`) and one PR, opened ready for review, not as a draft. Commits and PR titles are Conventional Commits, such as `feat(cli): add clutch init (CL-015)`. Do not mix issues. When you find unrelated work, file it with `clutch issues new`, which gives it the next free id and `status: todo`, and keep going.

## Pull requests and stacks

Follow `.agents/skills/deliver/references/pull-requests.md`. Open, follow, stack and merge each PR with `mise exec -- bun run pr`. `bun run pr open` commits the issue as `done` before it pushes, because a merge can come as soon as the checks pass. The merge makes that true, so `main` never lags behind GitHub. `bun run pr ready <id> <number>` is optional: it adds the PR link. When a PR closes without a merge, set its issue back to `todo` in the next branch.

## Ready for the factory

C-Suite's factory picks up work that is ready. `factory.intake` in `clutch.yaml` names it, and this list names the same values. `clutch factory --check` fails when the two disagree.

- GitHub: an issue with the label `factory`.
- Linear: no label. Clutch takes no Linear work.
- Tracker: an issue file with `status: todo` and `owner: agent`, outside the `later` phase, whose dependencies are `done`. `clutch issues next` prints the first one.

C-Suite's `github-intake` automation watches the `factory` label. It adds `factory:running` while a lane works on the issue. Make the `factory` label in GitHub before you use it.

## Frontmatter

Every issue file starts with YAML frontmatter. All keys are required.

```yaml
---
id: CL-003 # CL- plus 3 digits; letter suffix allowed for splits (CL-003a)
title: 'Add a subcommand router and the clutch issues command'
phase: P0 # P0 P1 P2 P3 P4 P5 RN RB later
status: todo # todo | in_progress | blocked | review | done
depends_on: [CL-002] # ids that must be done (or review when stacking)
pr: '' # PR URL when in review or done
owner: agent # agent | brendan | <agent name>
---
```

The body follows the frontmatter: `# CL-NNN: <title>`, then Goal, Context, Steps, Files, Acceptance criteria, Verify, and Gate for gate issues. Add `## Notes` and `## Blocked` sections at the end as needed.

## Status values

| Status        | Meaning                                                                                                 | Set when                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `todo`        | Not started.                                                                                            | Created.                                                               |
| `in_progress` | An agent owns it now. One per agent.                                                                    | Work starts. Commit this change with the first commit on the branch.   |
| `blocked`     | Waiting on a person or another issue. The reason goes in a `## Blocked` section at the end of the file. | A stop condition hits.                                                 |
| `review`      | A PR exists, validate is green locally and in CI, and `pr:` holds the URL.                              | After the green push.                                                  |
| `done`        | The PR is merged into `main`.                                                                           | The PR's `open` push, before the checks pass. The merge makes it true. |

## Id ranges

- P0: `CL-001` to `CL-099`. P1 to P5: `CL-1xx` to `CL-5xx`.
- Neighborhood: `CL-6xx`. Bar Savvy: `CL-7xx`.
- Migrated `.delivery` records: `CL-8xx`.
- Deferred backlog: `CL-9xx`, phase `later`. `clutch issues next` never picks it. Brendan moves an issue out of `later` when it is time.

New issues take the next free id in their range. Make them with `clutch issues new`, never by hand. Parallel branches cannot see each other's files, so two lanes that pick an id by hand can pick the same one. A coordinator reserves a block for each lane, such as `CL-118..CL-120`, and the lane passes it as `--range`. An issue that moves to another phase keeps its id, so links and waivers stay valid.

## Commands

- `clutch issues`: print the table.
- `clutch issues --write`: regenerate `TRACKER.md`. The release workflow runs it on `main`. Run it locally to read the table, but do not commit the result.
- `clutch issues --check`: exit 1 when an issue file is bad. With `--fresh`, also exit 2 when `TRACKER.md` is stale.
- `clutch issues next [--stack]`: print the first ready issue (see [Ready for the factory](#ready-for-the-factory)) with `owner: agent`, outside `later`, whose dependencies are `done` (or in `review`, up to 3 deep, with `--stack`).
- `clutch issues set CL-NNN <status> [--pr <url>] [--owner <name>]`.
- `clutch issues new --phase <P> --title <title> [--depends CL-NNN,...] [--owner <name>] [--range CL-NNN..CL-NNN]`: fetch origin, then write `issues/CL-NNN.md` with `status: todo` and the next free id. The id is one above the highest id in the phase's range, or in `--range`. It counts each issue file in the working tree, in each local branch and in each `origin/*` branch. A renumbered id never comes back. It fails when the range is full. Fill in the body sections, then commit and push the file soon, so other lanes see the id.

Mirroring issues to GitHub Issues needs Brendan's approval first.
