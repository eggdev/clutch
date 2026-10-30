# Clutch CLI

Installs this template into an existing project. The CLI checks the project,
switches its checkout to a new branch `template/install` from the default
branch, copies the files that [`template.files.yaml`](../../template.files.yaml)
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

## Review tooling only

For an existing project, run from its Git root:

```sh
bun <template clone>/apps/cli/src/main.ts review install --check --json
bun <template clone>/apps/cli/src/main.ts review install
```

This installs the shared delivery, audit, recap and verification-authoring skills,
their Claude links and Python helpers. It does not install dependencies or copy
the central queue or this template's generated verify executor. Use
setup-verification afterward to author or maintain the project's own verify.

Only committed template files are exported. Check is read-only and exits 2 when
changes are planned, 1 for conflict/error and 0 when unchanged. Installation needs
a clean target if changes are required; it stays on the current branch and leaves
the result uncommitted for review. Repeat the same command for updates.

`.review/tooling.json` records managed hashes; known legacy checksums support
migration from older template skills. Customized shared files stop the complete
preflight. Reconcile them explicitly and retry. Existing project verify skills
are always preserved. Full template installation also excludes this template's
verify; kickoff uses setup-verification for the receiving project.

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
  sync. A project with only review tooling starts from `.review/tooling.json`.
- `--check` changes nothing. It exits 0 when the project is up to date, 2 when a
  sync would change files or a file needs a decision, and 1 on an error.
- A sync never commits. Commit the result on a branch, and open a PR.
- When a managed file needs a decision, nothing changes. Ask the owner whether
  to keep the edit or take the Clutch copy.

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
- `--category` and `--phase` narrow the report. `--remote` is for remote probes.
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
| `remote: <probe>`                     | It is always unknown for now.                                          |
| `any` and `all`                       | They combine rules. An unknown rule inside `any` is skipped.           |

A capability is present when every `detect` rule passes. It is partial when
some pass, or when only `partial_if` rules pass. It is missing when none pass.
It is unknown when every `detect` rule is unknown. The registry is a guardrail
file, so a person reviews each change to it.

## Test it

```sh
mise exec -- bun nx run-many -t test typecheck lint -p @repo/cli
```
