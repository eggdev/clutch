# Clutch CLI

Installs this template into an existing project. The CLI checks the project,
switches its checkout to a new branch `template/install` from the default
branch, copies the files that [`clutch.files.yaml`](../../clutch.files.yaml)
names, and writes `.template-install/manifest.json`. The kickoff skill then works
through the manifest with the owner in their chosen agent interface. The
installer does not launch an agent by default.

The CLI copies from the last commit of this clone. Commit template changes
before you install them.

Agents find every repeatable command, `clutch` and `bun run pr`, by stage in
the [command index](../../.agents/skills/deliver/references/commands.md).

## Run it

From the root of the project that gets the template, run the CLI from your
clone of the template:

```sh
bun <template clone>/apps/cli/src/main.ts
```

The CLI refuses a folder that is not a git repository, a repository with
uncommitted changes, and a repository with no `package.json`.

After installation, open the project in any agent. Run `$kickoff` or
`/kickoff`, or ask the agent to follow `.agents/skills/kickoff/SKILL.md`. The
skill reads the manifest and runs the survey, the interview and the migration
in that session. To resume, open the project again. When the checkout is on
another branch, the CLI and the skill switch back to `template/install`. The
default branch does not change until you merge the install branch.

Use `--yes` to accept installation without a terminal confirmation, including
when an agent runs the installer. It does not approve product decisions.
To opt into the CLI-driven stages instead, pass `--agent claude` or
`--agent codex`. This requires that CLI on PATH and launches its terminal
interview. A saved provider preference never enables this mode implicitly.

## Files the project already has

Install reads `clutch.files.yaml`. A file that the project already has with
other content needs a decision before install changes anything:

- A `managed` file: keep the project copy, or take the Clutch copy.
- A `seed` file: keep, take, or merge. Merge writes both copies with conflict
  markers, and the manifest lists the file under `markers`.

In a terminal, install asks. Otherwise it lists the files and stops. Run it
again with `--keep <file>`, `--take <file>` or `--merge <file>` for each one.
Install also writes `.clutch/lineage.json`, so `clutch sync` can continue.

## Review tooling only

For an existing project, run from its Git root:

```sh
bun <clutch clone>/apps/cli/src/main.ts sync --only review --check --json
bun <clutch clone>/apps/cli/src/main.ts sync --only review
```

This syncs the entries that `clutch.files.yaml` tags `group: review`: the shared
delivery, audit, recap and verification-authoring skills, their Claude links and
the Python helpers. It does not install dependencies, and it never copies this
template's own verify. Use setup-verification afterward to author or maintain the
project's own verify. A scoped sync keeps the lineage of the other files, and it
leaves `clutch.yaml` alone.

## Issues

`clutch issues` reads the tracker in `.clutch/issues/`. Each issue is one
Markdown file with a frontmatter block. See `.clutch/README.md` for the fields.

The `clutch` script runs [`tools/clutch.ts`](../../tools/clutch.ts). In Clutch,
that runs this source. A project has no `apps/cli/`, so it runs the `clutch`
binary from the latest
[GitHub release](../../docs/contributing/setup/releases.md#the-clutch-binary),
which mise installs. `clutch --version` prints its release.

- `doctor` in the binary uses the capability registry built into it, the one
  of its release.
- `sync` and `init` in the binary read Clutch from a bare clone of the
  `template.repo` in `clutch.yaml`, kept in `$XDG_CACHE_HOME/clutch` or
  `~/.cache/clutch`. Each run fetches its tags first, so the latest release is
  the newest one on GitHub.
- `install` still runs from a Clutch clone, as [Run it](#run-it) shows. The
  binary says so.

```sh
mise exec -- bun run clutch issues
mise exec -- bun run clutch issues next --stack
mise exec -- bun run clutch issues set CL-003 review --pr <url>
mise exec -- bun run clutch issues new --phase P1 --title 'Add x' --range CL-118..CL-120
mise exec -- bun run clutch issues --write
mise exec -- bun run clutch issues --check
```

- `next` prints the first `todo` issue for an agent whose dependencies are
  done. With `--stack`, a dependency in review also counts, up to 3 stacked
  PRs. A `later` issue never comes next.
- `set` changes the frontmatter of one issue. It leaves `.clutch/TRACKER.md`
  alone: the release workflow regenerates it on the default branch, so a pull
  request never commits it.
- `new` fetches origin and writes a `todo` issue with the next free id. That
  id is one above the highest id in the phase's range, or in `--range`, across
  the working tree, each local branch and each `origin/*` branch. See
  `.clutch/README.md#commands`.
- `--write` renders `.clutch/TRACKER.md` in the format that `format-check`
  expects. The release workflow runs it on the default branch. Never edit that
  file by hand, and never commit it in a pull request.
- `--check` exits 1 when an issue file has a bad value. The message names the
  file and the field. `--check --fresh` also exits 2 when
  `.clutch/TRACKER.md` does not match the issue files.
- `--json` prints the issues and the errors as JSON.

## Checks

`clutch checks --changed [--base <ref>]` runs the project's
`tools/validate.ts --changed`: the validate targets of the affected Nx
projects, and the root checks. See
[only what changed](../../docs/contributing/setup/checks.md#only-what-changed).
It exits with the check's own code.

## Factory

`clutch factory --check [--root DIR] [--json]` checks the project's factory
tree: its agents, automations, runners, scorers and models. Each problem names
the file, the key and the reason, and the command exits 1. A project with no
tree at the default `factory/` passes with a notice. A root that `--root` or
`factory.root` names must be a folder, or the check fails. `validate` runs it
as `check-factory`.

```sh
mise exec -- bun run clutch factory --check
mise exec -- bun run clutch factory --check --root ../c-suite --json
mise exec -- bun run clutch factory --write-schemas apps/cli/schemas/factory
```

- The tree root is `factory.root` in `clutch.yaml`, or `factory/` without it.
  `--root DIR` checks the tree at `DIR`, from the current folder.
- `--json` prints the root, the count of each kind and the problems.
- `--write-schemas DIR` writes a JSON Schema file for each kind into `DIR`.
- The [factory tree](../../docs/contributing/architecture/factory-tree.md)
  page names each path and each key.

## Bench

`clutch bench <name>` runs the suite in `benchmarks/<name>/benchmark.md` of
the factory tree. It runs each task with each config, one pair at a time, and
prints pass or fail, time, changed lines and turns for each pair. Then it
prints the passes, time and lines of each config.

```sh
mise exec -- bun run clutch bench implement-models
mise exec -- bun run clutch bench implement-models --task cl-116-release-changeset --config sonnet
mise exec -- bun run clutch bench implement-models --json
```

For each pair, the command does these steps:

1. It clones the task's `commit` alone into a new folder in the temp folder.
   The clone has no remote and no later history, so the agent cannot push or
   read the answer.
2. It runs the `setup` commands of the agent's runner in the clone.
3. It runs the agent's model with the agent's prompt, the rules of a
   benchmark run and the text of the task's `issue`. The run stops after 20
   minutes or 80 turns.
4. It counts the lines that differ from `commit`, then runs the task's
   `check` in the clone. Exit 0 passes. `$CLUTCH_BENCH_REPO` holds the path of
   the repository, so a check can fetch test files that the agent never saw.
5. It removes the clone, also after a failure, a timeout or Ctrl-C.

- A run of the whole suite writes
  `benchmarks/<name>/results/<date>-<short sha>.json`, from the commit that
  ran it. Commit that file. `--task NAME` and `--config NAME` pick some pairs,
  and such a run writes no file. Each flag can repeat.
- `--json` prints the result as JSON, and the progress goes to stderr.
- The exit of each pair is `done`, `turns` (the turn limit), `timeout`,
  `error` (the agent failed) or `setup` (the clone or the setup failed). The
  check alone decides pass or fail.
- The log of each pair stays in a `clutch-bench-<name>-logs-*` folder in the
  temp folder. The command prints its path.
- Only `claude` models run today. A run uses `claude --print` on the plan that
  the CLI is signed in to. The command removes `ANTHROPIC_API_KEY` from the
  agent's environment, so a run never bills per token. The agent may edit
  files, run `bun` and `mise exec -- bun`, read files with `git`, and run
  `git add` and `git commit`. It may not run `gh`, `git push` or
  `bun run pr`, and the clone has no remote to push to.
- The [factory tree](../../docs/contributing/architecture/factory-tree.md#benchmarkmd)
  page names the keys of `benchmark.md`.

## Score

`clutch score <scorer> --pr <number>` judges one pull request with a scorer
of the factory tree. The scorer's `judge` is a model in `models.yaml`. The
command sends the judge prompt, the labels and the pull request to the model's
`base_url`, an OpenAI-compatible server. The model returns 1 label and 1
reason. The score is the label's score. The pull request passes when its score
is the `passingScore` or more.

```sh
mise exec -- bun run clutch score acceptance-criteria --pr 203
mise exec -- bun run clutch score acceptance-criteria --pr 203 --json --post
mise exec -- bun run clutch score task-compliance --pr 203 --root ../c-suite
```

- The prompt holds the title, the description, the list of changed files and
  the diff. It also holds the `.clutch/issues` file at the head commit, when
  the title or the branch names an issue id, such as `CL-426`. A part that is
  too long is cut, and the prompt says so. The budget fits a model with a
  32,768-token context.
- The command reads the pull request with `gh api` GET requests. `--repo
  OWNER/NAME` reads another repository. The default is the `origin` remote.
- The tree root is `factory.root` in `clutch.yaml`, or `factory/`. `--root DIR`
  reads the tree at `DIR`, so a project can run a scorer of another tree. The
  whole tree must pass `clutch factory --check`.
- A person's judge, or a model without `base_url`, cannot score. The command
  sends no API key, so it calls only a server that needs no key.
- When a reply has no valid label, the command asks the model 1 more time.
- `--post` adds the score as a PR comment, which starts with the marker
  `<!-- clutch-score:<scorer>:<label>:<score>:<head sha> -->`. A second run on
  the same head edits that comment.
- `--sample` scores the pull request only when it falls in the scorer's
  `samplingRate`. A hash of the scorer, the repository and the number makes
  the choice, so each sweep picks the same pull requests.
- `--json` prints the score, the reason, the seconds of the call and each cut.
- The command exits 0 with a score, also with a score that fails, and 0 when
  `--sample` skips the pull request. It exits 1 when it cannot score.

## Worktree

`clutch worktree` makes a separate checkout for one task, so several agents or
people work in one repository at once. It uses plain git worktrees. Each
checkout has its own `node_modules`, its own `.data` folder with its own
PGlite database, and its own dev server names.

```sh
mise exec -- bun run clutch worktree new cart-total --issue CL-201
mise exec -- bun run clutch worktree new smoke --runner spark --check --json
mise exec -- bun run clutch worktree list
mise exec -- bun run clutch worktree rm cart-total
mise exec -- bun run clutch worktree prune --dry-run
```

- `new <slug>` fetches the base, then makes the branch and its checkout in
  `<root>/<slug>`. The branch is `clutch/cl-NNN-<slug>` with `--issue`, or
  `clutch/<slug>` without it. `--base` defaults to the remote default branch,
  such as `origin/main`. A failed fetch only warns, so the command works
  offline.
- It copies each `worktree.copy` file that exists, such as `.env.local`, from
  the main checkout. Then it runs each `worktree.setup` command in the new
  checkout. With `--issue`, it sets the issue to `in_progress` there.
- The setup and the check come from the `clutch.yaml` of the new checkout, so
  they match its code. The root and the copied files come from the main
  checkout, because the command needs them before it makes the new checkout.
- `--runner <name>` reads `runners/<name>.yaml` in the new checkout's factory
  tree. It runs the runner's `setup` before `worktree.setup`. A runner that is
  missing, breaks its schema, or has `workspace: main_checkout` stops the
  command, and the new checkout is removed, because nothing ran in it.
- `--check` runs `worktree.check` after the setup, and exits with its exit
  code. A failed check keeps the checkout, so a person can look.
- It prints the path, the branch, and the dev server names from
  `bun run dev --check` when the project has a `dev` script.
- `--json` prints one line on stdout:
  `{"path":…,"branch":…,"runner":…,"check":{"command":…,"exitCode":…,"passed":…}}`.
  `runner` and `check` are null without their flags. The log and the output of
  each command go to stderr. When the setup fails, the command exits 1 and
  prints no JSON line.
- `list [--json]` shows each checkout with its branch, its dirty state, the
  issue in its branch name, and its PR when `gh` is signed in.
- The `worktree` block of `clutch.yaml` sets `root`, `copy`, `setup` and
  `check`. Without it, the checkouts go in `../<repo>.worktrees`, nothing is
  copied, and the setup is `mise trust --quiet` then
  `mise exec -- bun install`. mise refuses a config file in a new folder until
  it is trusted, and the install also installs the git hooks. The check is
  `mise exec -- bun run validate` when `check` is not set.
- `rm <slug> [--force] [--base REF]` refuses a checkout with uncommitted
  changes, or with commits that neither the base nor a remote branch holds.
  `--force` removes it anyway. It first stops that checkout's dev servers with
  `bun run dev --stop`, and only when a dev run there left
  `.data/dev-run.json`. Then it removes the checkout. It deletes the branch
  only when the branch is merged into the base.
- `prune [--dry-run] [--base REF]` removes each checkout whose PR is merged
  or closed, wherever the checkout lives, so the checkouts that other tools
  make go too. It asks `gh` for the PR, so a squash merge counts. It keeps the
  main checkout, the one it runs in, a detached one, one whose branch has no
  PR or an open PR, and one with uncommitted changes. It also keeps one whose
  HEAD is not the PR's head and not merged into the base, since those commits
  came after the PR. Like `rm`, it stops the dev servers first. It deletes the
  branch of a merged PR and keeps the branch of a closed one. It prints a line
  for each checkout and exits 1 when a removal fails. Run it on a schedule to
  clear finished checkouts without anyone asking.
- Run it from the main checkout or from a task checkout. Both use the main
  checkout's settings.
- The commands call a backend interface (`worktree/backend.ts`). Git is the
  only backend. Sprig is a possible later one (`.clutch/issues/CL-901.md`).

## Friction

`clutch friction` records what slowed a task down, so the weekly gardening pass
can turn repeated friction into a doc, a check or a tool fix. `AGENTS.md` asks
for an entry for any friction that cost more than 5 minutes.

```sh
mise exec -- bun run clutch friction add "pr open hid the hook output" --issue CL-306 --kind tooling
mise exec -- bun run clutch friction list --since 7d
```

- `add "<text>"` appends one JSON line to `.clutch/friction.jsonl` in the
  current checkout: `{at, issue, kind, text, branch}`. `at` is the time, and it
  names the entry, so gardening removes a handled entry by its `at`. `--kind` is
  `tooling` (the default), `docs`, `check` or `flake`.
- `list [--since 7d] [--json]` prints the entries, oldest first. `--since` takes
  days or hours, such as `7d` or `12h`. A line that is not a valid entry fails
  with its line number.
- `--file <path>` reads or writes another file, for tests.

## Labels

`clutch labels` prints the labels of a change. `kind/<type>` comes from the
conventional type of `--title`. `area/<part>` comes from each changed file:
a file in a workspace package from the root `package.json` gets the package
folder's name, such as `area/cli` for `apps/cli/`. Any other file gets its
top folder without a leading dot, such as `area/docs` or `area/github`, and a
file at the root gets `area/root`.

```sh
mise exec -- bun run clutch labels --title "fix(cli): keep the value"
mise exec -- bun run clutch labels --base origin/main --head HEAD --title "docs: x" --json
```

It also gives `size/S` (up to 100 changed lines), `size/M` (300), `size/L`
(800) or `size/XL`. Lockfiles, snapshots, `.clutch/` and the globs in
`pr_size.exclude` do not count. Above `pr_size.warn` (300 by default) it
prints a warning. It never fails.

`--json` adds the color and description of each label, the label prefixes
that the command owns, and the person labels `one-way-door`, `revert` and
`drill`, which the Labels workflow creates so a person can add them. See
[labels](../../docs/contributing/agent-review.md#labels).

## Ratchets

A ratchet counts the old violations of one rule for each file. The counts may
only go down. See decision 0001 (CL-301).

```sh
mise exec -- bun run clutch ratchet add no-double-cast --pattern '\bas (unknown as|any\b)' --files '{apps,packages,features,tools}/**/*.{ts,tsx,mts}'
mise exec -- bun run clutch ratchet check
mise exec -- bun run clutch ratchet update
```

- `add` writes the ratchet to `.clutch/ratchets.json` with today's counts.
  `--command` instead of `--pattern` reads `path:count` lines.
- `check` exits 1 when a count goes up, against the baseline or against the
  merge base for a file that the change touches. It exits 2 when a count went
  down and the baseline did not. The merge base is `--base`, then
  `CHECK_BASE`, then the remote default branch.
- `update` lowers the baseline to today's counts, and refuses a raise.

## Risk

`clutch risk` gives a change a risk tier from the paths it touches: `low`,
`medium`, `high` or `one-way-door`. The rules live in `.clutch/risk.yaml`, a
guardrail file.

```sh
mise exec -- bun run clutch risk
mise exec -- bun run clutch risk --base origin/main --head HEAD --json
```

- The change is every file that differs between the merge base of `--base`
  and `--head`. `--base` defaults to the remote default branch and `--head`
  to `HEAD`. A rename counts both paths.
- Each file gets the highest tier of the rules whose `paths` globs match it.
  A file that matches a rule's `except` glob does not match that rule. A file
  that no rule matches gets the `unmatched` tier. The change gets the highest
  tier of its files, and a change with no files is `low`.
- A rule with `guardrails: tools/guardrail-files.json` adds every pattern in
  that list to its paths, so the two cannot drift.
- A rule with `lines` matches a file only when one of its added or removed
  lines matches one of those regular expressions. `tools/codeowners.ts` leaves
  such a rule out of CODEOWNERS, which cannot express it.
- The rules and the CLI come from the working tree. The
  [Labels workflow](../../.github/workflows/labels.yml) checks out the base
  branch first, so a pull request cannot lower its own tier. It labels the
  pull request `risk/<tier>` and removes any other `risk/` label.
- `--json` prints the tier and each file with its tier and the pattern that
  set it. Text output prints the tier and the files at that tier.

Clutch's own rules follow
[decision record 0002](../../docs/contributing/decisions/0002-merge-most-prs-with-no-human.md):
80% of PRs merge with no human, and a rule tightens only on evidence.
`one-way-door` holds only the hard core:

- The merge gate: `.github/rulesets`, CODEOWNERS, `.clutch/risk.yaml`, the
  guardrail list, the auto-merge script and workflow, agent review and
  `review.md`, and the code that computes a tier.
- Credentials: secret scanning and the MCP configs. A workflow change to
  `permissions:`, an environment, a secret, an app token's permissions or a
  privileged trigger. The `automerge` and `agentReview` sections of
  `clutch.yaml`.
- Auth (`packages/access`, `packages/identity` and any `auth` folder) and
  migrations.
- A billing rule and an infra, deploy and secrets rule, both empty until a
  project names its paths.
- Decision records, `docs/principles`, project intent and `.clutch/PLAN.md`.

Docs, tests, changesets and tracker files are `low`. Every other path is
`medium`: product code, skills, check scripts, lint config and workflows.
Agent review gives a change that weakens a check an `owner` finding, so
auto-merge leaves it for the owner.

## clutch.yaml

Each repository that uses Clutch has a `clutch.yaml` at its root. It names the
Clutch repository and records the state of each capability. A repository without
the file has not adopted Clutch. A project never pins a Clutch commit: it
follows the latest Clutch release.

```yaml
schemaVersion: 1
project: shop # a short name for reports
template:
  repo: eggdev/clutch # the template repository
  mode: sync # sync: clutch sync manages the files. doctor: checks only.
capabilities: # keys are capability ids from the registry
  root_agents_md: adopted # the short form
  codeql_sast:
    status: waived # adopted, waived or n/a
    reason: Lands in CL-102. # required for waived and n/a
    issue: CL-102 # optional: the waiver ends when this issue is done
    until: 2027-01-31 # optional: after this date, the waiver fails the check
worktree: # optional
  root: ../shop.worktrees
  copy: [.env.local]
  setup: ['mise exec -- bun install']
automerge: # optional
  mode: dry-run # off (the default), dry-run or on
  step: low # bots (the default), low or medium: how far auto-merge reaches
  owner: eggdev # optional: the login whose reactions grade the dry-run verdicts
autoRevert: # optional
  watch: [production] # checks or jobs that also count as required for auto-revert only
pr: # optional
  branchPrefix: clutch/cl- # the default: how bun run pr finds an agent's branch
sast: auto # optional: auto (the default), codeql or semgrep
pr_size: # optional
  warn: 300 # the default: clutch labels warns above it, and never fails
  exclude: [] # globs whose lines do not count, such as generated code
agentReview: # optional
  missingCredential: notice # notice (the default) or fail
factory: # optional
  root: factory # the default: the folder of the factory tree. . is the project root
journeys: # optional
  webApp: apps/app # the app that web journeys drive. Without it, the one app under apps/ with a web entry
fleet: # optional: the repositories the weekly digest reads
  - repo: eggdev/neighborhood # owner/name
    ref: main # the branch to read
```

`automerge.mode` tells the Auto-merge workflow what to do, and `automerge.step`
how far it reaches: bot PRs, then low-risk agent PRs, then medium-risk ones. See
[auto-merge](../../.agents/skills/deliver/references/pull-requests.md#auto-merge).

`autoRevert.watch` lists checks or job names that count as required for the
Auto-revert workflow only. A project with a live deploy lists its deploy job, so
a failed health check still reverts the PR that broke it. The default is an
empty list. Auto-merge and the red-main metric judge main by the required checks
alone. See [rollback](../../docs/contributing/operations/rollback.md#auto-revert).

`agentReview.missingCredential` tells `agent-review.yml` what to do without an
Anthropic credential: pass with a notice, or fail. Set `fail` once
`agent-review` is a required check. See [agent review](../../docs/contributing/agent-review.md).

`journeys.webApp` names the app that `bun run journey` drives in a browser. Set
it when a repository has more than one app with a web entry, which is an Nx
`dev` target that is not tagged `platform:server` or `platform:native`. Without
it, the runner uses the one such app, and fails when there are several. See
[journeys](../../docs/contributing/setup/verification.md#journeys).

`fleet` lists the repositories that `.github/workflows/weekly-digest.yml`
reads each Monday, as the release bot. See
[weekly digest](../../docs/contributing/capabilities/factory-observability.md#weekly-digest).

`sast` picks the static analysis engine that `.github/workflows/sast.yml` runs.
`auto` runs CodeQL where code scanning takes results and Semgrep elsewhere.
`codeql` fails the check where code scanning takes no results. `semgrep` runs
Semgrep even on a public repository. See
[CodeQL / SAST](../../docs/contributing/capabilities/codeql-sast.md).

The loader rejects unknown keys. Each error names its YAML path, such as
`template.mode` or `capabilities.codeql_sast.reason`. An older `clutch.yaml`
has `template.commit`. The loader accepts it and reads nothing from it, and
the next sync removes it. Its `automerge` and
`agentReview` sections are in the one-way-door tier. For the rest of the
file, agent review gives a change that weakens it an `owner` finding, and auto-merge leaves that PR for the owner.

## Init

`clutch init` adopts Clutch in a repository that does not have it yet. It
writes `clutch.yaml`, the tracker in `.clutch/` and the doctor baseline. It
never commits.

```sh
mise exec -- bun run clutch init --root ../shop --yes
mise exec -- bun run clutch init --root ../shop --adopt --yes
mise exec -- bun run clutch init --root ../bar-savvy-web --mode doctor --yes
```

- Each capability that the repository has is adopted. Each core gap gets the
  waiver "Decide during adoption." Replace each one with a reason and an issue.
- `--adopt` is for a repository that already holds Clutch files. A managed file
  that matches an earlier Clutch version goes in `.clutch/lineage.json`, so
  sync may update it. An edited file stays a keep-or-take decision.
- `--mode doctor` is for a repository that Clutch checks but never syncs. It
  writes no lineage.
- `--adopt` compares the files with the latest Clutch release, the newest
  `vX.Y.Z` tag in the clone.
- In `sync` mode, init also writes the seeds that the managed tooling reads:
  `.clutch/risk.yaml` for the Labels workflow and `clutch risk`, and
  `.changeset/README.md`. Install writes every seed, and sync adds only a new
  `add_on_sync` seed, so init fills the gap. It keeps a copy that the project already has.
- Init refuses a repository that already has `clutch.yaml`.

### Start a new project from Clutch

Run these steps in order, from the project's root:

1. Install the formatter: `bun add --dev oxfmt`. Init and sync format the
   files they write, and they fail without it.
2. Run `clutch init --yes`, then commit. Sync refuses uncommitted changes.
3. Run `clutch sync`. It copies the managed files and merges `package.json`,
   which gains the `pr`, `clutch` and `validate` scripts.
4. Run `bun install`, then commit.

`tools/release/fresh-project.test.ts` runs these steps with the release binary.

## Sync

`clutch sync` moves a project to the latest Clutch release. `clutch.files.yaml` in Clutch
names the files and gives each one a rule. The longest matching path decides.

| Rule      | What sync does                                                       |
| --------- | -------------------------------------------------------------------- |
| `managed` | Replaces the file. A file that the project edited needs a decision.  |
| `merge`   | Merges the project's copy with Clutch's copy.                        |
| `seed`    | Nothing. Install writes it once, and the project owns it after that. |

`add_on_sync: true` on a `seed` entry makes sync add each file under it that
the project does not have, once. The project owns the file after that.
`seeded` in `.clutch/lineage.json` lists each such file that install or sync
wrote or found, so sync does not add a file again that the project deleted.
The factory tree at `factory/` uses it. Put `add_on_sync` only on a new entry.
On an older entry, sync adds back each file that a project deleted before.

```sh
mise exec -- bun run clutch sync --root ../shop --check
mise exec -- bun run clutch sync --root ../shop
mise exec -- bun run clutch sync --root ../shop --to v0.2.0
```

- Each merge to Clutch's `main` is a release with a `vX.Y.Z` tag. Without
  `--to`, sync uses the newest tag. The release binary fetches the tags on each
  run. A clone uses its own tags, so run `git pull --tags` in it first. Sync
  prints the release it used.
- `--to <tag or commit>` syncs to one revision once, such as an unreleased
  commit for a test.
- `.clutch/lineage.json` records the release of the last sync in `release`.
- `.clutch/lineage.json` records the hash of each managed file at the last
  sync. A project with only the older `.review/tooling.json` starts from it, and
  sync removes that file once the lineage holds its record.
- `known` in `clutch.files.yaml` holds the hashes of older Clutch copies. A
  project file that matches one is unchanged, so sync may replace it.
- `--check` changes nothing. It exits 0 when the project is up to date, 2 when a
  sync would change files or a file needs a decision, and 1 on an error.
- A project that is only behind a newer release gets a grace window, as
  Renovate gives a dependency update. That covers a keep-or-take decision that
  the new release brings, too. `--check` prints a warning and exits 0
  while both releases share a major version, and the oldest release that the
  project lacks is no more than `template.grace_days` days old (14 by default).
  After that, or across a major version, it exits 2. Drift from the release
  that the project already has exits 2 at once.
- A sync never commits. Commit the result on a branch, and open a PR.
- A sync lists the seed pages whose Clutch copy changed since the release in `.clutch/lineage.json`, each with a compare link, so the owner can port what applies. The list is in the text output, in `--json` as `seedChanges`, and in the sync PR body. It never fails a sync or edits a seed page.
- A managed file that the project edited needs a decision, and nothing changes
  until each one has an answer. In a terminal, sync asks: keep the project
  copy, take the Clutch copy, or show the difference first.
- Without a terminal, or with `--json`, sync lists those files and exits 2. An
  agent asks the owner, then runs sync again with `--keep <file>` or
  `--take <file>` for each one. An agent never decides for the owner.
- In a merge file, each value that the project and Clutch set differently is a
  decision too, named by file and key path, such as
  `package.json#scripts.validate`. Keep holds the project value, and take lets
  Clutch's value win. Install still lets Clutch's value win on a new project.
- A kept file stays quiet until Clutch changes it again. `.clutch/lineage.json`
  records the Clutch copy that the project declined.
- `mise.toml` carries the clutch CLI pin. Sync moves only that tool line's
  version, to the release it syncs to. The rest of the file follows the managed
  rules, so a release that moves only the pin asks nothing.
- `docs/contributing/architecture/primitives.yaml` is a merge file. Each folder
  that sync ships joins the primitive with the same id, so a shipped package has
  its claim in each project.
- A managed file links only to paths that a project gets: a managed or merge
  path, or a seed that install writes. A capability page is linked by its GitHub
  URL, and `check-managed-links` fails a managed link that a project would not
  resolve. The check runs in Clutch only, because `clutch.files.yaml` is Clutch's
  own file and sync does not deliver it. A project's run prints one notice line
  and exits 0, and the check runs in Clutch before each release.

### Sync pull requests

`.github/workflows/clutch-sync.yml` takes a release for the project when a
person starts it: Actions, Clutch sync, Run workflow. It has no schedule, so a
project catches up when it needs to. It compares the release in
`.clutch/lineage.json` with the newest Clutch release. When the project is
behind, it runs `clutch sync --to <release>`, refreshes `bun.lock` and the
TypeScript references, and pushes the result to `clutch-sync/latest` as the
release bot. One PR stays open, and each run moves it to the newest release.
`gh workflow run clutch-sync.yml` starts a run from a terminal.

- While the project is behind, the `clutch / doctor` check warns. It fails
  after `template.grace_days`, as [sync](#sync) says. No ruleset requires it,
  so it reminds and never blocks a merge.

- Auto-merge takes the PR at the step `bots`, when it passes the sync bot rule
  and its checks. See
  [auto-merge](../../.agents/skills/deliver/references/pull-requests.md#auto-merge).
- A sync that needs a keep-or-take decision opens no PR. The run names the
  files. Run `clutch sync` locally, and decide each one.
- The workflow needs the release bot, with Contents, Pull requests and
  Workflows, each read and write. Without it, the run ends with a notice.

## Use Clutch in another repository

A repository with `clutch.yaml` can run the Clutch checks in its own CI with
one job. The workflow checks out the latest release of the Clutch repository
that `clutch.yaml` names, runs `clutch doctor --check`, and runs
`clutch sync --check` against that release in `sync` mode. A project that is
behind the latest release gets a warning within the grace window, and fails
after it. See [Sync](#sync):

```yaml
jobs:
  clutch:
    uses: eggdev/clutch/.github/workflows/clutch-doctor.yml@<sha> # main
```

Pin a commit SHA from `main`. `check-workflows` rejects a branch or tag ref.
`gh api repos/eggdev/clutch/commits/main --jq .sha` prints the newest one. The
workflow still checks against the latest Clutch release, so an older pin only
holds the workflow steps back.

Pass `with: { root: <folder> }` when `clutch.yaml` is not at the repository
root.

## Doctor

`clutch doctor` shows each capability that a repository has, next to what its
`clutch.yaml` declares. It reads the registry of the Clutch checkout that runs
it. `--json` names the release of the project's last sync in
`templateRelease`.

```sh
mise exec -- bun run clutch doctor
mise exec -- bun run clutch doctor --root ../shop --json
mise exec -- bun run clutch doctor --phase P1
```

- Each line shows the detected state, the declared state and the evidence or
  the waiver reason. A summary line follows.
- A capability is present when every detect rule passes, and partial when
  some pass and one fails. It is unknown when the rules that did not pass are
  all unknown, such as remote rules without `--remote`.
- A repository without `clutch.yaml` reports each capability as undeclared.
- After the summary, a line names the SAST engine that `sast` in
  `clutch.yaml` runs, such as `SAST: auto -> codeql (public repository)`.
  Without `--remote`, doctor cannot tell CodeQL from Semgrep for `auto` and
  `codeql`, and prints `?`.
- With `--remote`, the last lines compare each file in `.github/rulesets/`
  with GitHub, as `clutch ruleset` does.
- `--category` and `--phase` narrow the report.
- `--remote` reads GitHub settings for the `remote:` rules: branch rules and
  protection, secret scanning, push protection, the merge queue, auto-merge,
  CodeQL default setup, Actions secret names and recent review bot comments.
  It sends only `gh api` GET requests, for the origin repository or
  `--repo OWNER/NAME`. A setting that the token cannot read is
  unknown, and an unknown result never fails `--check`.
- It exits 0 after a report, and 1 when the registry or `clutch.yaml` is bad.

`clutch doctor --check` is the gate. It fails, and exits 1, in these cases:

- An adopted capability is not present.
- A core capability is not present, and `clutch.yaml` has no waiver or `n/a`
  for it. An extra capability only gets a warning.
- A waiver passed its `until` date, or its `issue` is done in `.clutch/issues/`.
- A capability dropped below `.clutch/doctor-baseline.json`.
- With `--remote`, `sast` is `codeql` on a private repository without GitHub
  Code Security, so `sast.yml` fails.
- With `--remote`, a ruleset on GitHub differs from its file in
  `.github/rulesets/`, or does not exist. See [Ruleset](#ruleset).

A remote rule that is unknown never fails the gate. When a capability's files
pass and only its remote rules are left, it is unknown without `--remote`, so
config alone never reads as present. When a capability rose
above the baseline, the gate exits 2. Then run
`mise exec -- bun run clutch doctor --write-baseline` to raise the baseline.
The baseline only moves up. A lower value needs `--allow-downgrade` and the
owner's review, because the baseline is a guardrail file.

## Ruleset

`clutch ruleset` compares each file in `.github/rulesets/` with the ruleset of
the same name on GitHub, for the origin repository or `--repo OWNER/NAME`.
`--apply` creates a ruleset that GitHub does not have, or updates the one with
the same name with PUT, then compares again. Run it after each change to a
ruleset file.

```sh
mise exec -- bun run clutch ruleset
mise exec -- bun run clutch ruleset --apply
```

- Only the keys that the file names count, because GitHub adds defaults. A
  list, such as the required checks, must hold the same items in any order.
- A bypass actor whose `actor_id` is `vars.NAME` gets the value of the
  repository variable `NAME`. The release bot uses `vars.CLUTCH_APP_ID`, so one
  file fits each project. When the variable is not set, the actor is left out
  with a note.
- It exits 0 when every ruleset matches, 2 when one differs or is missing, and
  1 when `gh` fails. Applying needs a token with admin rights on the repository.

## Metrics

`clutch metrics` reports how pull requests flow through a repository over a
window. It prints the factory numbers first: autonomy, cycle time and reverts,
with Warp's definitions. Then it prints merges per day, the share merged with no human action, the hours from
open to merge, main-red minutes, reverts, the agent share from
`Co-authored-by` trailers and agent branches, PR size, the merges with no
human action by auto-merge step, CI run times, the issues done and the
owner's agreement with the auto-merge dry run. It sends only
`gh api` GET requests, for the origin repository or `--repo OWNER/NAME`, so it
works from a clone and from the release binary in any project.

```sh
mise exec -- bun run clutch metrics
mise exec -- bun run clutch metrics --since 30d --json
mise exec -- bun run clutch metrics --verdicts
```

- `--since` takes a number of days, such as `14d`, the default.
- `--json` puts the factory numbers in the top-level `factory` object, with
  a count of PRs for each and one row for each PR. `factory.definitions` names
  the version of the rules, so a reader such as C-Suite can pin what each
  number means. `clutch metrics --repo eggdev/neighborhood --json | jq .factory`
  reads them for one project.
- A revert PR labelled `drill` is a rehearsal. It is counted as a drill, not a
  revert, in the reverts and the revert rate. `--json` has `reverts.drills`.
- `--json` prints the report for a digest. A section that GitHub does not
  answer is null, and `unavailable` names the reason.
- The issues done come from `.clutch/issues` in the checkout, so `--repo` for
  another repository reports them as unavailable. The same goes for
  `pr.branchPrefix` and `pr_size.exclude`: another repository gets the
  defaults.
- `--verdicts` lists the auto-merge dry-run verdicts that the owner has not
  graded, with the reasons, the link and the agreement streak. `--owner LOGIN`
  names the owner; it defaults to `automerge.owner` in `clutch.yaml`, then the
  CODEOWNERS default. See
  [grade the verdicts](../../.agents/skills/deliver/references/pull-requests.md#grade-the-verdicts).
- It exits 0 after a report, and 1 when `gh` fails for the merged pull requests.

See [factory telemetry](../../docs/contributing/capabilities/factory-observability.md)
for what each number counts.

## Capability registry

`docs/contributing/capabilities/registry.yaml` lists each capability that a
repository can adopt, and the rules that detect it. `clutch doctor` reads it.

Each rule checks the files that git tracks. An untracked file never counts.
`factory: check` is the one exception: it runs the check on the working tree.

| Rule                                  | Passes when                                                               |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `file: <glob>`                        | A tracked file matches. `min` raises the count. `exclude` skips globs.    |
| `grep: { files, pattern }`            | A matching tracked file contains the regex.                               |
| `script: <name>`                      | The root `package.json` has the script.                                   |
| `target: <name>`                      | A `package.json` or `project.json` defines the Nx target.                 |
| `workflow: { on, uses, run, pinned }` | One workflow file matches every given field.                              |
| `yaml: { file, path }`                | The dotted path holds a value in the YAML or JSON file that is not empty. |
| `remote: <probe>`                     | The GitHub setting holds. It is unknown without `--remote`.               |
| `factory: agents`                     | Git tracks an `agents/*/agent.md` in the [factory tree](#factory) root.   |
| `factory: check`                      | The factory tree has an agent and passes `clutch factory --check`.        |
| `any` and `all`                       | They combine rules. An unknown rule inside `any` is skipped.              |

A capability is present when every `detect` rule passes. It is partial when
some pass and one fails, or when only `partial_if` rules pass. It is missing
when none pass. It is unknown when the rules that did not pass are all
unknown, such as remote rules without `--remote`. The registry is a guardrail
file: agent review gives a change that weakens it an `owner` finding, and auto-merge leaves that PR for the owner.

## Test it

```sh
mise exec -- bun nx run-many -t test typecheck lint -p @repo/cli
```
