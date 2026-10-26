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

## Start the app

<!-- kickoff: How to start each app and local service, with the command and the URL. -->

The command that starts the app is safe to run again. Agents start it often,
and a second copy on a busy port fails in ways that are hard to read. The
command:

1. Reuses a server that is already running and healthy.
2. Otherwise starts one, and waits for its health route to answer.
3. Prints the URL and the path of the log file.
4. Stops early with a fix hint when it finds a known misconfiguration, such as
   a missing environment variable.

The workflow also exposes status, logs and stop for this task's stack. A stop
never shuts down another task. Document process ownership and restart behavior
so a replacement session can restore the same review environment.

UI checks use the real browser or native app. They never read a rendered
string in place of the interface. Follow [verification setup](./verification.md)
for platform access and criterion evidence.

## Configuration

<!-- kickoff: Configuration: where each secret lives, the example file to copy, and which values a fresh clone needs. -->
