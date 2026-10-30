# GitHub Actions security lint (zizmor / actionlint / pinned actions)

GitHub Actions security lint checks the workflow files for unsafe patterns, and pins each action to a full commit SHA.

## Why

Rank 34 of the researched practices. About three in five of the leading repositories use it (59%). A workflow runs with the tokens of the repository. A moved tag or an injected expression can leak them, and pins and a linter close those paths.

## Detection

`clutch doctor` reports this capability as present when two rules pass. First, a `package.json` or `project.json` defines the Nx target `check-workflows`, or a workflow runs actionlint or zizmor. Second, a workflow pins each action it uses to a full commit SHA. It is partial when only one rule passes. See the `ci_security_lint` entry in [the registry](./registry.yaml).

## Adopt

1. Add a root target that checks the workflow files. This repository has `check-workflows`, in [`tools/check-workflows.ts`](../../../tools/check-workflows.ts).
2. Pin actionlint and zizmor in `mise.toml`. Run both in the canonical check command.
3. Pin each `uses:` reference to a 40-character commit SHA. Keep the tag in a comment after the SHA.
4. Get each SHA with `gh api repos/<owner>/<action>/git/ref/tags/<tag>`. Dereference an annotated tag.
5. Fix each finding, or narrow a permission. Do not add an ignore file.
6. Set `ci_security_lint` to `adopted` in `clutch.yaml`.

## Waive

Set `ci_security_lint` to `waived` in `clutch.yaml` with a reason. A waiver is rarely reasonable for a repository with workflows. When the repository has no GitHub Actions workflows, set `n/a` instead.
