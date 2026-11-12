# Pull requests and stacks

Every pull request in a project follows these rules. The commands below do the
GitHub steps. Use these commands. Do not hand-write `gh` calls or polling
loops, so each session and each project does the same thing. The
[command index](./commands.md) lists every command.

## Set up once per machine

```sh
mise install
mise exec -- bun run pr doctor --fix
```

`mise.toml` pins the GitHub CLI version. `doctor` checks that version, the
sign-in and the pinned `github/gh-stack` extension. `--fix` installs the
extension at the pinned version. Run each command below through `mise exec`,
so the pinned `gh` runs.

## Open a pull request

```sh
mise exec -- bun run pr open --title "<sentence>" --body-file <file>
```

- Open each PR ready for review. Never open a draft.
- Write each commit and the PR title as a Conventional Commit:
  `type(scope)!: subject`, such as `fix(cli): keep the project value`. The
  `commit-msg` hook checks each commit, and `open` checks the title. `fix` is a
  patch release, `feat` is a minor one, and `!` marks a breaking change.
- Each PR carries a changeset in `.changeset/`. `open` writes one from the
  title when the branch has none. See
  [releases](../../../../docs/contributing/setup/releases.md).
- Fill every section of `.github/pull_request_template.md` in the body file.
- `open` pushes the branch first, so the pre-push checks run.
- When the branch already has an open PR, `open` replaces its body.
- After you rebase your own branch, run `open` again with `--force`. It pushes
  with `--force-with-lease`, which refuses when someone else pushed to the branch.
- To change only the body, run `bun run pr body <number> <file>`.
- `open` asks the release bot to open a new PR. See
  [who opens the pull request](#who-opens-the-pull-request).
- `open` marks the branch's issue `done` in the PR head, before it pushes. A
  merge can come as soon as the checks pass, so the merged default branch must
  already say `done`. A branch with no issue id is left alone. The first open
  has no PR number yet, so it sets `done` without the PR link. The next `open`
  adds the link.
- `bun run pr ready <id> <number>` is optional. It adds the PR link to the
  issue, once the PR exists. It makes no commit when the issue already says
  `done` with that link.

### Who opens the pull request

GitHub never lets a PR's author approve it. So that the owner can approve an
agent's PR, the release bot opens it, and the owner stays the author of each
commit:

1. The agent commits as the owner, with the owner's git identity and a
   `Co-Authored-By` trailer that names the agent. The contribution graph
   credits the owner.
2. `open` pushes the branch, then runs
   `gh workflow run open-pr.yml --ref <default branch>` with the head, the base
   and the title. That workflow mints the bot token in the `release`
   environment, so the key stays limited to the default branch. It never checks
   out or runs code from the branch. It only calls the pull request API.
3. `open` waits up to 3 minutes for the PR, then sets the body as the owner.

When the repository has no `CLUTCH_APP_ID` variable, or the default branch has
no `open-pr.yml`, or the bot opens no PR in time, `open` opens the PR as the
user. See [the release bot](../../../../docs/contributing/setup/releases.md#the-release-bot).

### Approval

`.github/CODEOWNERS` lists the path rules of the `one-way-door` tier of
`.clutch/risk.yaml`, and the main ruleset requires a code owner's approval. So
GitHub requires the owner's approval on a PR that changes one of those paths.
No repository role can bypass the ruleset, the owner's admin role included, so
a one-way-door PR merges only with that approval. The release bot opens each
agent PR, so the owner approves it on GitHub like any other PR from another author.
`tools/codeowners.ts` generates the file, and `check-agent-hooks` fails when it
drifts. After a change to the one-way-door tier, run
`mise exec -- bun tools/codeowners.ts --write`.

Four kinds of PR wait for the owner without a GitHub approval rule:

- A rule with `lines`, such as a workflow's `permissions:`. CODEOWNERS cannot express it, so auto-merge holds
  the PR by its `one-way-door` tier.
- A PR with an `owner` finding from agent review. Auto-merge holds it, except
  a pure Clutch sync whose findings are approved upstream (see
  [Auto-merge](#auto-merge)).
- A PR that makes a contract break. Its diff changes `contract.json`, and the
  snapshot names the break. Auto-merge holds it, whatever its tier.
- A major change. Its title has `!` before the colon, or a changeset in its
  diff names a major bump. Auto-merge holds it, whatever its tier.

Do not merge any of these kinds with `pr merge` until the owner says so. `pr status` counts the `owner` findings, the contract breaks and a major change, and reports such a PR as not ready. `pr merge` refuses it until the owner approves it.

The owner's approval is the last step. When `automerge.owner` in `clutch.yaml`
approves the head commit, an `on` run of Auto-merge passes an agent PR at any
tier, and drops agent review's `owner` findings. The bot rule still holds a bot
PR, and a PR that a person opened is still refused. The required checks, a
draft, the base branch and a red `main` still hold any PR. The session that
watches the PR sees the approval and runs `bun run pr merge` again. A later
push needs a new approval, and a later "Request changes" from the owner
cancels it.

## Follow a pull request to green

Between open and merge, the session that opened the PR stays with it and runs
the [babysit-pr](../../babysit-pr/SKILL.md) skill. Each round syncs the PR with
its base by merge, answers every review thread and comment, fixes what needs a
fix, resolves each answered thread and keeps a `## Babysit log` comment. The
main ruleset requires each review thread to be resolved before a merge. No
workflow or schedule does this for the session. In T3, the session watches the
PR, and each change to its checks or reviews starts the next round. Elsewhere,
`pr wait` blocks until the checks finish.

| Command                                 | When to use it                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `bun run pr status <number> [--json]`   | Before each decision. It shows the required checks, the agent review's blocking count, the dry-run verdict, the review decision and the mergeable state at the head commit. A PR that a rule still blocks, such as one waiting on a code-owner review, is not ready. |
| `bun run pr wait <number> [--timeout 30m]` | After a push. It waits until no check is pending and GitHub shows the commit that the checkout has, then prints the status. It exits 0 when the PR is ready, 1 when it is not, and 2 at the timeout. |
| `bun run pr failures <number>`          | When a check failed. It prints the failed step of each job, and the output of each failed Nx task, without ANSI codes. A job with no log, such as one that never started, gets its check run's annotations instead. |
| `bun run pr findings <number> [--check]` | After the checks finish, and after each new review. It lists every agent review finding from every head, and which ones the `## Review disposition` comment answers. See [answer each finding](#answer-each-finding). |
| `bun run pr babysit <number>`           | At the start of each babysit round. It prints the round's plan: each open thread, each unanswered comment, each failed check, and the sync that the branch needs. It keeps the plan in the git directory. |
| `bun run pr babysit <number> --answers <file> [--pushed <sha>] [--sync merge]` | After you decide, fix, validate and push. It replies in each thread, resolves the answered ones, reruns each flaky check once, writes the disposition and the `## Babysit log`, and says when to ask the owner in the session's thread. `--stuck "<why>"` logs a round that a cap or a conflict stopped. |
| `bun run pr sync <number, branch or id>` | When GitHub reports the PR as conflicting. It rebases on the PR's base, takes the base's copy of `.clutch/TRACKER.md` if an older branch still committed it, runs `validate` and pushes with a lease. It stops on any other conflict. For a stacked PR whose base was rewritten or merged, it replays only the PR's own commits, even when another clone rewrote the base. On a PR in the middle of a stack, it keeps the PRs above it linked. After a rebase that you finished by hand, it rebases as usual. |
| `bun run pr ready <id> <number>`        | Optional, once the PR exists. It adds the PR link to the issue's `done` record, commits only the issue file as `chore(tracker): mark <id> done`, and pushes. It makes no commit when the issue already says `done` with that link. The release regenerates `.clutch/TRACKER.md` on `main`. |

Each command reads the repository from the `origin` remote. `sync` takes an
issue id, such as `CL-117`, and finds the branch with the prefix that
`pr.branchPrefix` in `clutch.yaml` names. The default is `clutch/cl-`. `sync`
and `ready` change the tracker through `tools/clutch.ts`, so they run the
release binary in a project.

### Answer each finding

When the checks finish, the PR is not done until each agent review finding
has an answer. Agent review posts one inline comment for each finding, and it
reviews each new head again. A later review can leave out an older finding
that no fix resolved, so read every head, not only the last one:

```sh
mise exec -- bun run pr findings <number>
```

It lists each finding by level and file, with its comment ids and the heads
that raised it. It marks each one that the latest `## Review disposition`
comment answers. Post or edit that one comment, with one line for each finding:

```markdown
## Review disposition

- blocking `docs/a.md` (4458028676): fixed in 443119f
- owner `tools/x.ts` (4458080057, 4458124128): waits for the owner: approve the hatch
- note `ci.yml` (4458028977): not fixed: it says the check got stronger
```

A line answers a finding when it names one of its comment ids, or its path and
its level. A `blocking` finding must not merge until it is fixed, so only
`fixed in <sha>` answers it. `pr findings <number> --check` exits 1 while a finding has no line,
and `pr merge` refuses the PR until it passes. A new push can bring new
findings, so run it again after each review. Auto-merge does not read the
disposition yet. CL-416 adds that.

After the owner approves a PR, do not push a fix for a new `owner` or `note`
finding. The push dismisses the approval, as
[one approval round per batch](#one-approval-round-per-batch) says. Answer the
finding as `not fixed: after the owner's approval`, and file the fix as an
issue. Only a `blocking` finding or a `DIRTY` merge state justifies a push and
a new approval.

## Stack a pull request on another one

When the work builds on a branch whose PR is still open, the PRs form a stack.
GitHub stacks are linear. Each branch sits on the branch below it, and each PR
uses that branch as its base.

1. Find the top branch of the open stack.
2. Make the new branch from that top branch, even when the new work does not
   depend on every PR below it.
3. Run `open` with `--base <top branch>`. It adds the new PR to the top of the
   stack.

`open` links the whole stack each time: the PRs below, the PR itself and the
PRs above it. So `open --force` or `sync` on a PR in the middle of a stack
keeps the PRs above it in the stack. `gh stack link` refuses a list that
leaves one out.

Never give two open PRs the same base branch, except the default branch. Two PRs
on one base cannot form a linear stack, and they can conflict in generated
files. To join such PRs, rebase the second branch onto the first one. Then run
`open` for it again with the new base.

### One approval round per batch

A push to an approved PR drops the approval, because the ruleset dismisses
stale reviews. So the owner approves a batch once:

1. Before you ask the owner for approval, put your finished PRs in one stack
   with `open --base`, so `gh stack` links them bottom to top. Each PR is green,
   with 0 blocking findings and its head already marks the issue `done`.
2. Ask the owner in this session's thread to approve every PR in the stack in
   one sitting, with each approve link.
3. Run `bun run pr merge <top> --owner`. It merges the whole stack, bottom
   up, in one step.
4. After the approval, push only a sync with the base or a blocking fix.
   GitHub dismisses the approval only when a push changes the PR's diff. A
   sync that merges or rebases a moved base, with no conflict, keeps it, as
   [Clutch's CL-419](https://github.com/eggdev/clutch/blob/main/.clutch/issues/CL-419.md) measured. A conflict that the
   sync resolves, or a fix, changes the diff and needs a new approval. A
   `CLEAN` PR merges as it is, since the ruleset does not require an
   up-to-date branch.

## Merge

The session that built the PR merges it, as soon as it is ready:

```sh
mise exec -- bun run pr merge <number>
```

`merge` waits for the checks, then dispatches the
[Auto-merge workflow](#auto-merge) from the default branch. The workflow judges
the PR with the default branch's rules, under `automerge.mode` and
`automerge.step` in `clutch.yaml`, and merges it with the release bot's token.
The bot's merge starts the release and CI on `main`, and the session's own
token would start neither. When the judge holds the PR, `merge` prints the
verdict and exits 3. The PR then waits for the owner: finish the work that does not
depend on the answer, then ask in this session's thread, in the
[fixed form](../SKILL.md#ask-the-owner), with the approve link that `merge`
prints. The approval starts the judge again, so the PR merges even when the
session has ended. A session that still runs sees the merge, and goes on to
watch `main`.

Add `--owner` only when the owner told this session to merge this PR. `merge`
then merges with the session's own token, and skips the judge. A PR in a stack
needs `--owner`, since the judge takes only a PR whose base is the default
branch.

`merge` refuses while GitHub reports that the PR needs a review
(`REVIEW_REQUIRED`) or has changes requested, and it names the reviewer. A
ruleset's code owner review leaves that decision empty, so `merge` also
refuses a PR that GitHub reports as blocked while a review is still requested.
The ruleset itself refuses such a merge too, since no repository role bypasses
it. The check gives the message that names the reviewer.

`merge` also refuses a PR while an agent review finding, from any head, has no
line in its `## Review disposition` comment. See
[answer each finding](#answer-each-finding).

`merge` accepts the owner's approval of the current head as the answer to the
owner findings. The owner is `automerge.owner` in `clutch.yaml`, else the
default owner in `.github/CODEOWNERS`. A dismissed approval, or one on an older
commit, does not count, and neither does another login's approval.

With `--owner`, for a PR in a stack, `merge` merges every PR from the bottom up
to that one, with merge commits. When one merge fails, none of them merge. For
a PR that is not in a stack, it merges that PR with a merge commit. GitHub can
still count a PR as stacked after the PRs below it merged. When GitHub refuses
the plain merge for that reason, `merge` merges through the stack.

Each merge to the default branch is a release. `merge` then waits for the run of
`release.yml` on the merge commit, and prints the released version or the
failed run. Then it waits for CI's push run on the merge commit, under the
[auto-revert](../../../../docs/contributing/operations/rollback.md#auto-revert)
rules: a red run reruns its failed jobs once, and a second red run starts the
revert of an auto-merged PR. Each wait lasts up to `--timeout`, 30 minutes by
default. `merge` exits 0 only when `main` is green at the merge. When it exits
1 after a revert started, drive the revert PR to the merge before you report
the task.

The exit code of `merge` says what comes next:

| Exit | Meaning                                 | Next                                                                            |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 0    | Merged, released, and `main` is green.  | Report the task done.                                                           |
| 1    | `merge` refused before it merged, the release failed, or `main` went red. | Read the output. When a revert started, babysit the revert PR and merge it.     |
| 3    | The judge holds the PR for the owner.   | Finish the work that does not depend on the answer. Ask in this session's thread, in the fixed form, with the approve link. The approval merges the PR. |

The default branch takes no direct pushes, so a task cannot become `done`
after its merge. The PR head makes it so: `open` commits the task as `done`
before it pushes, and the merge makes that true. When a PR closes without a
merge, set its task back to `todo` in the next branch.

## Auto-merge

The Auto-merge workflow (`.github/workflows/auto-merge.yml`) judges one pull
request of this repository, never a fork's. No schedule starts it. It runs
when `pr merge` dispatches it, when the owner approves a head, and when CI or
agent review completes on a PR that no session owns: a `revert/` PR or a bot's
`renovate/`, `gardening/` or `clutch-sync/` PR. An agent's `clutch/` PR merges
only when its session runs `pr merge`, or after the owner approves it. Its CI
event judges it only once the owner approved it. When CI turns green on the
default branch, each approved agent PR is judged again, since a red `main` may
have held it. An agent PR is one that the release
bot opens, so its author is a bot. The workflow also judges a PR on a
`clutch/cl-NNN-<slug>` branch, which an agent makes, as a fallback for a project
whose release bot is not set up. A bot PR's branch starts with `renovate/`,
`gardening/`, `clutch-sync/` or `revert/`, and its author is a bot. Any other
PR is a person's. The workflow logs that it is not judged, and it posts no
comment on it.

`automerge.step` in `clutch.yaml` sets how far auto-merge reaches. Each step
takes the PRs of the steps before it:

| Step     | Takes                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| `bots`   | Bot PRs that pass the bot rule, and the revert PRs below.                                     |
| `low`    | Also agent PRs that `clutch risk` gives `low`.                                                |
| `medium` | Also agent PRs that it gives `medium`. Agent review passed, so they have 0 blocking findings. |

The revert rule: a `revert/<number>` PR, which the Revert workflow opens, merges
at every step. It merges when auto-merge merged PR `<number>` and the revert's
own `clutch risk` tier is `low` or `medium`. It may merge while `main` is red,
because it is the fix. A revert of a PR that a person merged waits for a person.
See [auto-revert](../../../../docs/contributing/operations/rollback.md#auto-revert).

The revert brake: the step steps down by itself. Each run counts the PRs that
merged in the last 30 days, and how many of them have a head branch that starts
with `revert/` and no `drill` label. A drill is a rehearsal, so it counts in the
merges but not in the reverts. When there are at least 20 merges and reverts
pass 2% of them, the run judges at the step below the configured one: `medium`
acts as `low`,
and `low` acts as `bots`. The verdict names the rate and the step. The brake
lifts by itself when the rate falls back to 2% or less. The limits are `brake`
in `tools/github/auto-merge-rules.ts`, and they come from
[decision 0002](https://github.com/eggdev/clutch/blob/main/docs/contributing/decisions/0002-merge-most-prs-with-no-human.md).
Revert PRs merge at every step, so the brake does not hold them. When the count
fails, the run uses the configured step and logs a warning. A person still
tightens a path from its `risk-tighten` issue.

The bot rule:

- A Renovate PR may change only versions: `package.json` dependency versions,
  pinned action SHAs in workflows, tool versions in `mise.toml`, the lockfile
  and its own changeset. Each package the lockfile adds must come from the npm
  registry, or from a workspace folder of this repository. Renovate already
  waits out the 3-day release age.
- A gardening PR's `clutch risk` tier must be `low` or `medium`.
- A Clutch sync PR, which `clutch-sync.yml` opens, may change only what
  `clutch sync` writes: the managed files that its `.clutch/lineage.json`
  lists, the lineage, its changeset, `clutch.yaml`, the merged files such as
  `package.json`, the TypeScript configs and the lockfile. The lockfile rule is
  the same as Renovate's. Sync also adds a new seed file under an
  `add_on_sync` entry, such as the factory tree. The bot rule does not accept
  that file yet (CL-518), so a person merges that PR. The `clutch / doctor` check, which the project's CI
  runs and no ruleset requires, proves that the managed files match the release.
  When it succeeds on the head, its `owner` findings are approved upstream and
  hold nothing, as [decision 0003](https://github.com/eggdev/clutch/blob/main/docs/contributing/decisions/0003-a-pure-clutch-sync-takes-owner-findings-as-approved-upstream.md)
  records. The verdict still lists them.

At each step, the PR also needs all of these:

- It is open, not a draft, and its base is the default branch. A stacked PR
  waits.
- The latest run of each required check of the default branch, and of
  `agent-review`, succeeded on its head commit. Only runs that the GitHub
  Actions app reported count, as in the main ruleset. A run with the same name
  from another app or token counts for nothing.
- No required check is red on the default branch's latest commit. A red
  `main` stops every auto-merge until it is green again, except a revert PR.
- Agent review left no `owner` finding on its head, unless the PR is a pure
  Clutch sync, as above. A change to the hard core gets one, and so does a
  change that weakens a check that gates the merge, whatever its path. See
  [owner findings](../../../../docs/contributing/review.md#owner-findings). The
  owner merges such a PR.
- Its diff makes no contract break. A PR whose diff changes `contract.json`, and
  whose snapshot names a break, waits for the owner.
- It is not a major change. A PR with `!` in its title, or with a changeset
  that names a major bump, waits for the owner's sign-off.

The workflow runs only from the default branch, with the default branch's
rules, so a PR cannot change the rules that judge it. It refuses a fork's PR,
because the run gets this repository's token. `automerge.mode` decides what it
does:

- `off` prints the verdict in the job summary.
- `dry-run` comments its verdict at the step, once for each head commit of an
  open, ready agent PR: "would auto-merge", or "would not auto-merge" with the
  reasons. It waits until every required check has finished. The comment asks
  the owner to react 👍 when they agree and 👎 when they do not. `clutch
  metrics` counts those reactions as `dryRunAgreement`.
- `on` runs `gh pr merge --auto --merge` with the release bot token, for a
  PR that may merge at the step, and comments that the merge is queued. A
  separate `merge` job does that in the `release` environment, which holds the
  bot's key and admits only the default branch. The merge is pinned to the
  judged head commit. GitHub merges it with a merge commit once the required
  checks pass, and `pr merge` waits for that. A merge made with
  the default token starts no workflow, so the bot's token keeps the release
  and CI running on `main`. Each agent PR also gets the dry-run verdict for the
  next step, so the owner can grade it before that step turns on. At the last
  step, `medium`, there is no next step, so `on` posts no verdict.

The `gh` reads of these scripts are retried on a transient GitHub error (a 5xx,
a timeout or a reset connection), up to 3 tries. A write is never retried,
because a 5xx on a write may have taken effect.

To stop one queued merge, run `gh pr merge --disable-auto <number>`. To stop
every merge that the judge would make, set `automerge.mode` to `dry-run`.

### Grade the verdicts

The owner grades each dry-run verdict on its PR: 👍 when they agree and 👎 when
they do not. `clutch metrics --verdicts` lists each verdict that the owner has
not graded yet, with its reasons and a link. `clutch metrics` counts the owner's
reactions as `dryRunAgreement`, and ignores anyone else's.
