# Repo MCP config for agents

A repository MCP config lists the Model Context Protocol servers that agents load in the repository.

## Why

Rank 31 of the researched practices. About two in five of the leading repositories use it (41%). Each agent gets the same tools in each checkout, such as a browser driver or read access to GitHub. Without the file, each person sets up the tools by hand, and agents differ.

## Detection

`clutch doctor` reports this capability as present when git tracks `.mcp.json` or `.cursor/mcp.json`. It is partial when git tracks only `.mcp.example.json`. See the `mcp_config` entry in [the registry](./registry.yaml).

## Adopt

1. Add `.mcp.json` at the root for Claude Code. Add `.cursor/mcp.json` for Cursor.
2. Put no secret in either file. Read each token from an environment variable.
3. Start with the servers that verification and review use, such as Playwright MCP.
4. Scan both files for secrets before each commit.
5. List the servers in a contributor docs page.
6. Set `mcp_config` to `adopted` in `clutch.yaml`.

## Waive

Set `mcp_config` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when agents need no tools outside the shell.
