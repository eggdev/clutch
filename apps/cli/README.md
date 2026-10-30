# Clutch CLI

Installs this template into an existing project. The CLI checks the project,
switches its checkout to a new branch `template/install` from the default
branch, copies the files that [`clutch.files.yaml`](../../clutch.files.yaml)
names, and writes `.template-install/manifest.json`. The kickoff skill then works
through the manifest with the owner in their chosen agent interface. The
installer does not launch an agent by default.

The CLI copies from the last commit of this clone. Commit template changes
before you install them.

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
leaves the `clutch.yaml` pin alone.

## Issues

`clutch issues` reads the tracker in `.clutch/issues/`. Each issue is one
Markdown file with a frontmatter block. See `.clutch/README.md` for the fields.

```sh
mise exec -- bun run clutch issues
mise exec -- bun run clutch issues next --stack
mise exec -- bun run clutch issues set CL-003 review --pr <url>
mise exec -- bun run clutch issues --write
mise exec -- bun run clutch issues --check
```

- `next` prints the first `todo` issue for an agent whose dependencies are
  done. With `--stack`, a dependency in review also counts, up to 3 stacked
  PRs. A `later` issue never comes next.
- `set` changes the frontmatter of one issue, then rewrites
  `.clutch/TRACKER.md`.
- `--write` renders `.clutch/TRACKER.md` in the format that `format-check`
  expects. Never edit that file by hand.
- `--check` exits 2 when `.clutch/TRACKER.md` is stale, and 1 when an issue
  file has a bad value. The message names the file and the field.
- `--json` prints the issues and the errors as JSON.

## clutch.yaml

Each repository that uses Clutch has a `clutch.yaml` at its root. It pins the
template commit and records the state of each capability. A repository without
the file has not adopted Clutch.

```yaml
schemaVersion: 1
project: shop # a short name for reports
template:
  repo: eggdev/clutch # the template repository
  commit: <40-character SHA> # the template commit that the project matches
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
```

The loader rejects unknown keys. Each error names its YAML path, such as
`template.commit` or `capabilities.codeql_sast.reason`. `clutch.yaml` is a
guardrail file, so a person reviews each change to it.

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
- Init refuses a repository that already has `clutch.yaml`.

## Sync

`clutch sync` moves a project to a Clutch commit. `clutch.files.yaml` in Clutch
names the files and gives each one a rule. The longest matching path decides.

| Rule      | What sync does                                                       |
| --------- | -------------------------------------------------------------------- |
| `managed` | Replaces the file. A file that the project edited needs a decision.  |
| `merge`   | Merges the project's copy with Clutch's copy.                        |
| `seed`    | Nothing. Install writes it once, and the project owns it after that. |

```sh
mise exec -- bun run clutch sync --root ../shop --check
mise exec -- bun run clutch sync --root ../shop --latest
```

- Without `--to` or `--latest`, sync uses the commit that the project's
  `clutch.yaml` pins. A sync then sets that pin to the new commit.
- `.clutch/lineage.json` records the hash of each managed file at the last
  sync. A project with only the older `.review/tooling.json` starts from it, and
  sync removes that file once the lineage holds its record.
- `known` in `clutch.files.yaml` holds the hashes of older Clutch copies. A
  project file that matches one is unchanged, so sync may replace it.
- `--check` changes nothing. It exits 0 when the project is up to date, 2 when a
  sync would change files or a file needs a decision, and 1 on an error.
- A sync never commits. Commit the result on a branch, and open a PR.
- A managed file that the project edited needs a decision, and nothing changes
  until each one has an answer. In a terminal, sync asks: keep the project
  copy, take the Clutch copy, or show the difference first.
- Without a terminal, or with `--json`, sync lists those files and exits 2. An
  agent asks the owner, then runs sync again with `--keep <file>` or
  `--take <file>` for each one. An agent never decides for the owner.
- A kept file stays quiet until Clutch changes it again. `.clutch/lineage.json`
  records the Clutch copy that the project declined.

## Use Clutch in another repository

A repository with `clutch.yaml` can run the Clutch checks in its own CI with
one job. The workflow checks out the Clutch commit that `clutch.yaml` pins,
runs `clutch doctor --check`, and runs `clutch sync --check` in `sync` mode:

```yaml
jobs:
  clutch:
    uses: eggdev/project-template/.github/workflows/clutch-doctor.yml@<commit>
```

Pin `<commit>` to a Clutch commit, as with any action. The `template.commit`
in `clutch.yaml` must be a Clutch commit that has `clutch doctor`. An older
pin fails with "Unexpected argument 'doctor'". Pass `with: { root: <folder> }`
when `clutch.yaml` is not at the repository root. The repository moves to
`eggdev/clutch` after the rename in CL-006.

## Doctor

`clutch doctor` shows each capability that a repository has, next to what its
`clutch.yaml` declares. It reads the registry of the Clutch checkout that runs
it, so a project gets the registry of its pinned Clutch commit.

```sh
mise exec -- bun run clutch doctor
mise exec -- bun run clutch doctor --root ../shop --json
mise exec -- bun run clutch doctor --phase P1
```

- Each line shows the detected state, the declared state and the evidence or
  the waiver reason. A summary line follows.
- A repository without `clutch.yaml` reports each capability as undeclared.
- `--category` and `--phase` narrow the report.
- `--remote` reads GitHub settings for the `remote:` rules: branch rules and
  protection, secret scanning, push protection, the merge queue, auto-merge and
  CodeQL default setup. It sends only `gh api` GET requests, for the origin
  repository or `--repo OWNER/NAME`. A setting that the token cannot read is
  unknown, and an unknown result never fails `--check`.
- It exits 0 after a report, and 1 when the registry or `clutch.yaml` is bad.

`clutch doctor --check` is the gate. It fails, and exits 1, in these cases:

- An adopted capability is not present.
- A core capability is not present, and `clutch.yaml` has no waiver or `n/a`
  for it. An extra capability only gets a warning.
- A waiver passed its `until` date, or its `issue` is done in `.clutch/issues/`.
- A capability dropped below `.clutch/doctor-baseline.json`.

A remote rule that is unknown never fails the gate. When a capability rose
above the baseline, the gate exits 2. Then run
`mise exec -- bun run clutch doctor --write-baseline` to raise the baseline.
The baseline only moves up. A lower value needs `--allow-downgrade` and the
owner's review, because the baseline is a guardrail file.

## Capability registry

`docs/contributing/capabilities/registry.yaml` lists each capability that a
repository can adopt, and the rules that detect it. `clutch doctor` reads it.

Each rule checks the files that git tracks. An untracked file never counts.

| Rule                                  | Passes when                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `file: <glob>`                        | A tracked file matches. `min` raises the count. `exclude` skips globs. |
| `grep: { files, pattern }`            | A matching tracked file contains the regex.                            |
| `script: <name>`                      | The root `package.json` has the script.                                |
| `target: <name>`                      | A `package.json` or `project.json` defines the Nx target.              |
| `workflow: { on, uses, run, pinned }` | One workflow file matches every given field.                           |
| `yaml: { file, path }`                | The dotted path exists in the YAML or JSON file.                       |
| `remote: <probe>`                     | The GitHub setting holds. It is unknown without `--remote`.            |
| `any` and `all`                       | They combine rules. An unknown rule inside `any` is skipped.           |

A capability is present when every `detect` rule passes. It is partial when
some pass, or when only `partial_if` rules pass. It is missing when none pass.
It is unknown when every `detect` rule is unknown. The registry is a guardrail
file, so a person reviews each change to it.

## Test it

```sh
mise exec -- bun nx run-many -t test typecheck lint -p @repo/cli
```
