# Capabilities

A capability is a practice that `clutch doctor` detects in a repository. [The registry](./registry.yaml) lists each capability and the rules that detect it. Each capability has one page here. The page says why the practice matters, how doctor detects it, how to adopt it and when to waive it.

The [CLI README](../../../apps/cli/README.md) documents the commands, the rule kinds and the format of `clutch.yaml`.

## Decisions

`clutch.yaml` records one decision for each capability:

- `adopted`: the repository has the capability.
- `waived`: the repository accepts the gap. A waiver needs a `reason`. It can also name an `issue` and an `until` date. The waiver ends when the issue is done or the date passes.
- `n/a`: the capability does not apply to the repository. It needs a `reason`.

```yaml
capabilities:
  root_agents_md: adopted
  codeql_sast:
    status: waived
    reason: Another SAST tool runs in CI.
    issue: CL-NNN
    until: 2027-01-31
  oidc_ci:
    status: n/a
    reason: CI deploys to no cloud provider.
```

## Core and extra

Each capability is core or extra. `clutch doctor --check` fails on a core capability that is not present and has no decision in `clutch.yaml`. An extra capability in the same state only gets a warning. The gate also fails on an adopted capability that is not present, and on an expired waiver.

## Read the report

Run `mise exec -- bun run clutch doctor` to see the report. It groups the capabilities by category. Each line shows the capability, the detected state, the declared state and the evidence or the waiver reason.

| Icon | State     | Meaning                                                     |
| ---- | --------- | ----------------------------------------------------------- |
| ✓    | `present` | Every detect rule passes.                                   |
| ~    | `partial` | Some detect rules pass, or only a `partial_if` rule passes. |
| ✗    | `missing` | No detect rule passes.                                      |
| ?    | `unknown` | Every detect rule is unknown, such as a remote rule.        |

A summary line follows the list. It counts the capabilities in each detected state, then in each declared state:

```text
36 capabilities: 20 present, 4 partial, 11 missing, 1 unknown. Declared: 24 adopted, 12 waived, 0 n/a, 0 undeclared.
```

A remote rule reads the repository settings on GitHub. Doctor checks it only with `--remote`, and reports it as unknown without that flag. `--category` and `--phase` narrow the report, and `--json` prints it as JSON.

## All capabilities

| Capability                                                                                   | Category          | Level |
| -------------------------------------------------------------------------------------------- | ----------------- | ----- |
| [Root AGENTS.md](./root-agents-md.md)                                                        | Agent context     | core  |
| [Nested / scoped agent rules](./nested-agent-rules.md)                                       | Agent context     | core  |
| [Agent skills directory](./skills-dir.md)                                                    | Agent context     | core  |
| [Git hooks (pre-commit / lefthook / husky / prek)](./git-hooks.md)                           | Verification      | core  |
| [Single canonical check command](./canonical-check.md)                                       | Verification      | core  |
| [One-command local setup](./dev-bootstrap.md)                                                | Verification      | core  |
| [Project task runner / CLI (just, make, mise, xtask, hogli, dda)](./project-cli.md)          | Verification      | core  |
| [Repo-owned agent verification CLI (drives the running app)](./verification-cli.md)          | Verification      | core  |
| [Changed-files / affected-scope check](./changed-scope-check.md)                             | Verification      | core  |
| [Flaky-test quarantine / registry](./flaky-quarantine.md)                                    | Verification      | core  |
| [In-repo custom lint plugin / rules](./custom-lint-plugin.md)                                | Lint & guardrails | extra |
| [Lint-suppression discipline (reason required / no-disable)](./suppression-discipline.md)    | Lint & guardrails | core  |
| [Ratchets / shrink-only baselines](./ratchets.md)                                            | Lint & guardrails | core  |
| [File-size / blob-size caps](./file-size-caps.md)                                            | Lint & guardrails | core  |
| [CODEOWNERS / ownership registry](./codeowners.md)                                           | Review & merge    | core  |
| [PR template](./pr-template.md)                                                              | Review & merge    | core  |
| [AI review bot configured in repo](./ai-review-bot.md)                                       | Review & merge    | core  |
| [AI review findings gate merge (severity / triage)](./ai-review-blocking.md)                 | Review & merge    | core  |
| [CI failure explainer / investigation agent](./ci-failure-explainer.md)                      | Review & merge    | extra |
| [PR size limits / size labels](./pr-size-limits.md)                                          | Review & merge    | core  |
| [Merge queue / merge trains](./merge-queue.md)                                               | Review & merge    | core  |
| [Risk-tiered / scoped auto-merge or auto-approve](./risk-tier-automerge.md)                  | Review & merge    | core  |
| [Protected default branch (PR-only, required checks)](./protected-main.md)                   | Trust             | core  |
| [Secret scanning](./secret-scanning.md)                                                      | Trust             | core  |
| [CodeQL / SAST](./codeql-sast.md)                                                            | Trust             | core  |
| [Dependency update bots (Renovate / Dependabot)](./dep-automation.md)                        | Trust             | core  |
| [Dependency minimum release age / update cooldown](./dep-min-age.md)                         | Trust             | core  |
| [GitHub Actions security lint (zizmor / actionlint / pinned actions)](./ci-security-lint.md) | Trust             | core  |
| [OIDC / keyless credentials in CI (id-token)](./oidc-ci.md)                                  | Trust             | extra |
| [Worktree / parallel-agent workspace setup](./worktree-parallel.md)                          | Parallel work     | core  |
| [Cloud-agent VM / sandbox setup in repo](./cloud-agent-vm.md)                                | Parallel work     | core  |
| [Repo MCP config for agents](./mcp-config.md)                                                | Parallel work     | extra |
| [Friction logs / agent learnings file](./friction-log.md)                                    | Scale loops       | core  |
| [Flake hunters / test audit loops](./flake-hunter.md)                                        | Scale loops       | extra |
| [Scheduled gardener / maintenance agents](./gardener-bots.md)                                | Scale loops       | extra |
| [Factory telemetry (agent spend, CI timing, quality signals)](./factory-observability.md)    | Scale loops       | extra |
