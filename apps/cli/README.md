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

## Test it

```sh
mise exec -- bun nx run-many -t test typecheck lint -p @repo/cli
```
