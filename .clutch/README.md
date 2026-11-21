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

`hand_test: yes` or `hand_test: no` is the one optional key. It says whether the
owner tests the work by hand after it deploys. A PR that adds a screen must state it.

`goal:` is optional too. It names a user goal from project intent. A PR that adds
a feature must state it, after kickoff.

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

## Tickets

`clutch tickets` keeps tickets in a store that every worktree of a project shares. It is separate from the issue files. `clutch issues` and `.clutch/issues` do not change, and no command copies one into the other.

The store is one SQLite file at `<git-common-dir>/clutch/tickets.sqlite`. Git does not track it, so a ticket shows in each worktree at once, with no commit. Each project has its own file. No server runs. The CLI opens the file for each command, and it is the only reader and writer. Agents use the commands, never the file.

A ticket has an id such as `CL-1000`. The prefix is `tickets.prefix` in `clutch.yaml`, and numbers start at 1000. A ticket with no route is in the inbox. The ticket holds the owner's words in `description`, and no command changes them. `edit` sets the requirements (`now`, `expected`, `location`, `acceptance`, `major`), the kind, the dependencies and the plan body.

A ticket has one phase row for each phase on its route: `triage`, `planning`, `design`, `build`, `review` and `deploy`, in that order. Each row has a status: `not_ready`, `ready`, `in_progress`, `blocked`, `in_review` or `done`.

- A new ticket has one `triage` row. It is `ready`, or `not_ready` when the ticket is held. `release` makes it `ready`.
- `route` adds `triage` at the start when the list leaves it out. A route with no `planning` needs `now`, `expected`, `location`, one acceptance check and `major: no`. Otherwise `route` exits 1 and names each missing part.
- `done` makes the next phase `ready`. A phase that goes back to `ready` sets each later phase to `not_ready`.
- `claim` sets `in_progress` and the claim in one transaction. Only a `ready` phase can be claimed, so a second claim exits 1.

Each record that a command changes gets one event in the same transaction, in the shape of a Linear webhook: `deliveryId`, `createdAt`, `actor`, `type` (`Ticket` or `Phase`), `action` (`create` or `update`), `data` (the record after the change) and `updatedFrom` (the old value of each changed field). The record that the command names comes first. Then each phase row that changed with it gets its own event, such as the next phase that becomes `ready` after `done`. A new phase row gets a `create` event. A record that does not change gets no event. The actor is `--as`, or the user of the machine.

Every command prints JSON with `schemaVersion: 1`. An error prints `status: error` and a `message`, and exits 1.

- `clutch tickets add <title> --description <text> [--kind bug|feature|chore] [--hold]`
- `clutch tickets list [--inbox] [--phase <phase>] [--status <status>]`, `show <id>`, `ready`
- `clutch tickets edit <id> [--now] [--expected] [--location] [--acceptance]... [--major yes|no] [--kind] [--depends <id,...>] [--body-file <path>]`
- `clutch tickets route <id> --phases <phase,...> --reason <text>`
- `clutch tickets hold <id>`, `release <id>`
- `clutch tickets claim <id> <phase> --as <name> [--thread <thread>]`
- `clutch tickets phase <id> <phase> <status> [--reason <text>] [--approved-by owner --quote <text>]`
- `clutch tickets link <id> --kind prototype|pull_request|branch|worktree|evidence <value>`
- `clutch tickets events [--ticket <id>] [--since <event number>]`
- `clutch tickets dispatch`, `phases [--check]`

`ready` lists each `ready` phase of a ticket that is not held and whose dependencies are done. A ticket is done when each of its phases is `done`.

### Phases

`.clutch/phases.yaml` tells the driver how to start each phase. Clutch ships a default, and the project owns its copy after the first sync. The file has `limits`, `work_thread` and one entry for each phase in `phases`. `tickets phases --check` exits 1 on an unknown key, an unknown phase, or a skill with no `SKILL.md` in `.agents/skills/`, `~/.claude/skills/` or `~/.agents/skills/`.

- `thread: own` starts a new thread with the `provider` and `model` of the entry.
- `thread: work` uses the one work thread of the ticket. The first work phase starts it in a new worktree from `origin/main`, on the branch `clutch/<id>-<title>`, with the model of `work_thread`. Each later work phase sends its prompt to that thread.
- `prompt` and `skills` make the prompt. The prompt also tells the agent to read the ticket and to end with `clutch tickets phase <id> <phase> done`.
- `statuses` holds a prompt for a status. When `tickets phase` sets that status, the driver sends the prompt to the thread of the phase.
- `check` is a command. `done` runs it in the worktree of the ticket, and exits 1 with no change when it fails.
- `advance: owner` means that `done` needs `--approved-by owner --quote <the owner's words>`. The quote goes in the reason of the phase, so it is in the event.
- `needs: [device]` counts the phase against `limits.device`. A running work phase counts against `limits.threads`.

`tickets dispatch` runs after each command that writes, and by hand. It finds each `ready` phase that `tickets ready` lists, and claims it, then starts its thread with `t3` and saves the thread id on the phase. The claim stops a second start, so several dispatches can run at once. A phase that would pass a limit stays `ready`. A phase with no entry in the phase file stays `ready`. When `t3` fails, the phase goes back to `ready` with the error as its reason, and the next dispatch tries again. A checkout with no phase file starts nothing.

Each start, skip and failure writes one JSON line to `~/.local/state/clutch/<project>/dispatch.jsonl`, or under `$XDG_STATE_HOME` when it is set.
