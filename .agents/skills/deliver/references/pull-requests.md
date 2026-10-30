# Pull requests and stacks

Every pull request in a project follows these rules. The commands below do the
GitHub steps. Do not type the `gh` calls by hand, so each session does the same
thing.

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
- After the first green push, run
  `clutch issues set <id> done --pr <url>`, commit it, and run `open` again.
  The merge makes `done` true. A PR that waits on a lower PR in a stack uses
  `review` until it is ready to merge.

## Stack a pull request on another one

When the work builds on a branch whose PR is still open, the PRs form a stack.
GitHub stacks are linear. Each branch sits on the branch below it, and each PR
uses that branch as its base.

1. Find the top branch of the open stack.
2. Make the new branch from that top branch, even when the new work does not
   depend on every PR below it.
3. Run `open` with `--base <top branch>`. It adds the new PR to the top of the
   stack.

Never give two open PRs the same base branch, except the default branch. Two PRs
on one base cannot form a linear stack, and they can conflict in generated
files. To join such PRs, rebase the second branch onto the first one. Then run
`open` for it again with the new base.

Keep a stack to three open PRs or fewer. At three, ask the owner to merge the
lower PRs before you add another one.

## Merge

Merge only when the owner says so.

```sh
mise exec -- bun run pr merge <number>
```

For a PR in a stack, `merge` merges every PR from the bottom up to that one,
with merge commits. When one merge fails, none of them merge. For a PR that is
not in a stack, it merges that PR with a merge commit. Each merge to the
default branch is a release.

The default branch takes no direct pushes, so a task cannot become `done`
after its merge. When the PR is green and ready to merge, its last commit sets
the task to `done` with its PR link, and the merge makes that true. When a PR
closes without a merge, set its task back to `todo` in the next branch.
