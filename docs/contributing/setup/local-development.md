# Local development

## Tools

[mise](https://mise.jdx.dev) pins Bun and Node in `mise.toml`. Run each command
through it:

```sh
mise install
mise exec -- bun install
mise exec -- bun run validate
```

`bun install` also installs the Git hooks. See
[Git hooks](./checks.md#git-hooks).

<!-- kickoff: How to start each app and local service, with the command and the URL. -->

<!-- kickoff: Configuration: where each secret lives, the example file to copy, and which values a fresh clone needs. -->
