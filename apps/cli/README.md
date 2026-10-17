# Install CLI

Installs this template into an existing project. The CLI checks the project,
makes a git worktree next to it on the branch `template/install`, copies the
files that [`template.files.yaml`](../../template.files.yaml) names, and
writes `.template-install/manifest.json`. The kickoff skill then works
through the manifest with the owner.

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

## Test it

```sh
mise exec -- bun nx run-many -t test typecheck lint -p cli
```
