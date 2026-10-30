# AI review bot configured in repo

An AI review bot is an agent that reviews each pull request against the review rules of the repository.

## Why

Rank 18 of the researched practices. About three in five of the leading repositories use it (59%). Agents open more pull requests than people can read line by line. An agent review applies the written rules to each one, and a person reads the findings.

## Detection

`clutch doctor` looks for review config first: `.cursor/BUGBOT.md`, a `.coderabbit.yml` or `.coderabbit.yaml` file, or a workflow that uses `anthropics/claude-code-action`. Config alone does not prove that a reviewer runs. So `--remote` also checks for the `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` Actions secret, or for Bugbot or CodeRabbit comments on one of the 10 latest pull requests. Without `--remote`, the capability is unknown. See the `ai_review_bot` entry in [the registry](./registry.yaml).

## Adopt

1. Write the review rules in one page. This repository uses [review](../review.md).
2. Add a workflow that runs the review on each pull request. See [`.github/workflows/agent-review.yml`](../../../.github/workflows/agent-review.yml).
3. Add the `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` secret on GitHub. Without a secret, the review job passes with a notice.
4. For Cursor Bugbot, add `.cursor/BUGBOT.md` and point it at the same rules.
5. Set `ai_review_bot` to `adopted` in `clutch.yaml`.

## Waive

Set `ai_review_bot` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when a person reviews each pull request and no agent opens them.
