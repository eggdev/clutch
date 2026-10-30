# CI credentials

Each credential that a workflow reads, what it can reach, and why it is not
OIDC. Change a secret only with the owner. `clutch.yaml` records the
`oidc_ci` decision.

## Secrets and variables

| Name                      | Kind                                | Read by                                                      | Provider                    | GitHub OIDC                               |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------ | --------------------------- | ----------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret                              | `agent-review.yml`, `gardening.yml`                          | Anthropic, Claude plan      | No. A plan token has no OIDC exchange     |
| `ANTHROPIC_API_KEY`       | secret                              | `agent-review.yml`, `gardening.yml`                          | Anthropic, Claude API       | Yes, through workload identity federation |
| `CLUTCH_APP_PRIVATE_KEY`  | secret in the `release` environment | `release.yml`, `gardening.yml`, `renovate.yml`, `revert.yml` | GitHub App, the release bot | No. The key signs the app's own login     |
| `CLUTCH_APP_ID`           | variable                            | the same workflows                                           | GitHub App, the release bot | Not a secret                              |

The default `github.token` is not in the table. GitHub mints it for each job,
and it ends with the job. Each job's `permissions` block sets its scope.

## Scope of each one

- `CLAUDE_CODE_OAUTH_TOKEN` signs in to the owner's Claude plan, so a job's
  usage counts against that plan. It reaches Claude only, not GitHub. Agent
  review and the weekly gardening pass read it.
- `ANTHROPIC_API_KEY` is the alternative for a project that pays for the
  Claude API. A workflow uses whichever of the two is set, and turns itself off
  with a notice when neither is. Clutch sets only the plan token.
- `CLUTCH_APP_PRIVATE_KEY` lets `actions/create-github-app-token` mint an
  installation token for the release bot. That token lasts one hour. Each
  workflow asks only for the permissions that its step uses, such as
  `permission-contents: write`. The
  [release bot setup](./releases.md#the-release-bot) gives the app Contents,
  Pull requests and Workflows read and write, and nothing more. It is on the bypass
  list of the `main` ruleset, so its token can push the release commit.
  Protect this key most. It lives in the `release` environment, which only
  the default branch may deploy to, so a run on any other branch cannot read
  it. See [the release bot](./releases.md#the-release-bot).

A fork PR gets none of these secrets, so a fork cannot reach any of them. See
[CI](./checks.md#ci).

## Why there is no OIDC

GitHub OIDC replaces a stored secret with a short-lived token from a cloud
provider. CI here deploys to no cloud, so no workflow logs in to AWS, Google
Cloud or Azure.

- A Claude plan token has no OIDC exchange. The Claude API has one:
  `anthropics/claude-code-action` takes `anthropic_federation_rule_id` and
  `anthropic_organization_id`, and swaps the job's OIDC token for API access.
  That bills the Claude API instead of the plan. The owner chose to keep the
  plan, so `oidc_ci` is waived.
- A GitHub App has no OIDC login. Its private key is the only way to mint its
  installation tokens.

Move to OIDC when CI starts to deploy to a cloud, or when the project switches
to Claude API billing. Then replace the waiver with `oidc_ci: adopted`.

## The `id-token: write` grant

Only `gardening.yml` grants `id-token: write`. The Claude action uses it to
trade the job's OIDC token for a Claude GitHub App token. Gardening uses that
token to open its PR when the release bot is missing. Agent review passes
`github.token` to the action, so it never makes that trade and has no grant.
