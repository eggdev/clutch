# Daily security agent (triage, audit, fix PR)

Once a day, an agent triages new vulnerability reports and checks the project for known problems. It opens at most one pull request with its fixes.

## Why

[SECURITY.md](../../../SECURITY.md) promises to acknowledge a report within 3 business days and to fix a critical bug within 30 days. A project with one owner has nobody on call to keep that promise. The daily pass keeps it, and the owner only decides.

## What it reads

`.github/workflows/security.yml` runs the agent on the pass in [the security agent reference](../../../.agents/skills/audit-codebase/references/security-agent.md). The agent reads these inputs:

- private vulnerability reports in the triage state,
- code scanning, Dependabot and secret scanning alerts,
- open Renovate pull requests and the `bun audit` result,
- a `gitleaks` scan of the whole history,
- the project's logs, through the `security-logs` script. [The security page](../security.md#logs) names the source.

## What it writes

- **A triage note in each new private report.** A workflow step adds the agent's note to the report's description. The owner and the reporter can read it there, and nobody else. The step sets the severity when the report has none. It never changes the state, so it cannot accept, close or publish a report. The owner does that.
- **One pull request with fixes.** It goes on a `security/<date>` branch, and the release bot opens it, so CI and agent review run on it. The workflow refuses to push when the title or body names a private report. While a security PR is open, the pass skips the day.

The agent runs on the cheapest model, `claude-haiku-5-5`, because it runs every day. Its token reads only. Only the steps after it can write, and each one asks for one permission.

## Setup

1. Set `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Without either, the run ends green with a notice.
2. Set up [the release bot](../setup/releases.md#the-release-bot), and give it the extra permissions for this agent. Without the bot, the agent reads only code scanning alerts, and the pull request starts no CI.
3. Turn on private vulnerability reporting, so reports arrive as advisories.
4. Fill the logs slot on [the security page](../security.md#logs), and add the `security-logs` script.

## Detection

`clutch doctor` reports this capability as present when a workflow runs the agent on `references/security-agent.md`. With `--remote`, it also checks for the Anthropic secret. See the `security_agent_loop` entry in [the registry](./registry.yaml).

## Adopt

1. Keep `.github/workflows/security.yml`, which `clutch sync` brings.
2. Do the setup above.
3. Set `security_agent_loop` to `adopted` in `clutch.yaml`.

## Waive

Set `security_agent_loop` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when a person triages reports and alerts every day.
