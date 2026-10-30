# CodeQL / SAST

Static application security testing (SAST), such as CodeQL or Semgrep, scans the source code for security flaws on each change.

## Why

Rank 16 of the researched practices. About two thirds of the leading repositories use it (67%). Agents write a lot of code, and a reviewer can miss an injection or an unsafe pattern. A SAST scan finds known flaw patterns in each change.

## How Clutch runs it

`.github/workflows/sast.yml` runs on each pull request, on each push to the default branch and weekly. Its `sast` job is the required check, so one ruleset fits public and private repositories. Its `engine` job reads `sast` in `clutch.yaml`, which kickoff sets:

- `auto`, the default, picks the engine from the table below.
- `codeql` always runs CodeQL. Where code scanning takes no results, the `engine` job in `sast.yml` exits with an error, so the `sast` check fails.
- `semgrep` always runs Semgrep, even on a public repository.

Under `auto`:

| Repository                                                                | Engine                                                                                                           | Findings                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Code scanning takes results: a public repository, or GitHub Code Security | CodeQL, one `analyze` job per language                                                                           | The Security tab, as code scanning alerts                  |
| A private repository without GitHub Code Security                         | [Semgrep Community Edition](https://semgrep.dev/docs/getting-started/quickstart-oss), with the `p/default` rules | The job log. A finding fails the job. Nothing is uploaded. |

The `engine` job asks GitHub for the code scanning alerts list. A 403 means the repository has no Code Security, so Semgrep runs. A notice on the run names the engine.

### Private repositories

Code scanning on a private repository needs GitHub Code Security, sold to organizations for each active committer. CodeQL's license allows free use only on open-source code, so a private repository without Code Security never runs CodeQL. It runs Semgrep instead.

Semgrep runs from the `semgrep/semgrep` container image, pinned by digest. It needs no Semgrep account and no token, sends no metrics and uploads nothing. Clutch picked Semgrep over OpenGrep, its LGPL fork. Semgrep serves the `p/default` rules from its registry with no account, and publishes an official image for each release.

To run one engine by hand, start the SAST workflow from the Actions tab and pick an engine. The `clutch.yaml` choice runs the setting.

### Silence a Semgrep false positive

Fix the code first. When the finding is wrong, name the rule and the reason on its line, or on the line above:

```ts
// nosemgrep: prototype-pollution-loop -- reads only, and Object.hasOwn skips inherited keys.
```

`check-suppressions` rejects a `nosemgrep` comment without a rule and a reason. A rule that is wrong for the whole repository is turned off in `sast.yml` with `--exclude-rule`, with its reason in a comment.

## Detection

`clutch doctor` prints the chosen path on its last line, such as `SAST: auto -> codeql (public repository)`. With `--remote` it checks the choice against the repository. `codeql` on a private repository without Code Security fails `clutch doctor --remote --check`.

<!-- kickoff: The SAST engine from the setup checklist, as sast in clutch.yaml (auto, codeql or semgrep), and the reason. -->

`clutch doctor` reports this capability as present when a workflow uses `github/codeql-action/`, a workflow runs `semgrep scan`, or the `code_scanning_default_setup` remote probe passes. Doctor checks the remote probe on GitHub only with `--remote`. Without that flag, the probe is unknown and the workflow rules decide. See the `codeql_sast` entry in [the registry](./registry.yaml).

## Adopt

1. Sync `.github/workflows/sast.yml` from Clutch, or write a workflow like it.
2. Run it on each pull request, on each push to the default branch and on a weekly schedule.
3. Pin each action and image to a full digest.
4. Grant `contents: read` at the top level. Grant `security-events: write` to the CodeQL job only.
5. List each language of the repository for CodeQL, such as `javascript-typescript` and `actions`.
6. Keep CodeQL default setup off in the code security settings on GitHub: GitHub refuses the workflow's results while default setup is on.
7. Make `sast` a required check in the main ruleset.
8. Set `codeql_sast` to `adopted` in `clutch.yaml`.

## Waive

Set `codeql_sast` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when another SAST tool runs in CI. Name that tool in the reason.
