# Agent tools

The MCP servers that coding agents use in this repository. Each checkout gets
the same servers from files in git. This page covers developer tools only. The
product's own MCP server is in [MCP](../architecture/mcp.md).

## The servers

| Server     | What agents use it for                                                          | Runs                                                         | Needs                             |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| playwright | Drive a browser for journeys and flow checks: open a page, click, read the page | Locally, with `npx --yes @playwright/mcp@0.0.83`             | Node from `mise.toml`             |
| github     | Read issues, pull requests, files and Actions runs                              | GitHub's hosted server, `https://api.githubcopilot.com/mcp/` | `GITHUB_TOKEN` in the environment |

The GitHub server sends `X-MCP-Readonly: true`, so agents get only its read
tools. They write to GitHub through the repository's commands, such as
`bun run pr`, never through MCP. `X-MCP-Toolsets` limits it to repos, issues,
pull requests and Actions.

## The files

- `.mcp.json` for Claude Code. It reads the token as `${GITHUB_TOKEN:-}`, so an
  unset variable leaves the GitHub server signed out and keeps the file valid.
- `.cursor/mcp.json` for Cursor. It reads the token as `${env:GITHUB_TOKEN}`.

Neither file holds a secret. Each token comes from the environment, and
`gitleaks` scans both files in the pre-commit hook and in CI. Claude Code asks
you to approve a project server the first time it starts.

Codex is not set up yet. Its project MCP config needs a check against the
Codex docs first.

## Change a server

1. Pin each local server to one exact version, never `latest` or a range. Pick
   a version older than 3 days, like every other dependency.
2. Change both files in the same pull request, so every agent gets the same
   servers.
3. Put no secret in a file. Read it from an environment variable.
4. Update the table above.

Both files are agent steering, so a person reviews each change to them.

## Check it

```sh
claude mcp list
mise exec -- gitleaks dir .mcp.json --redact
mise exec -- gitleaks dir .cursor/mcp.json --redact
```
