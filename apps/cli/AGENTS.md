# Clutch CLI agent rules

The CLI source is in `src/`. The entry is `src/main.ts`.

- Run it: `mise exec -- bun run clutch <command>`.
- Test it: `mise exec -- bun test apps/cli`.
- Each command has one `src/<name>-command.ts` file. Keep tests next to the source.
- Import from `src/` with the `@/` alias, such as `@/commands`.
- Add a new command to `src/commands.ts` and to the command index.

Links:

- [CLI docs](./README.md)
- [Command index](../../.agents/skills/deliver/references/commands.md)
- [Doctor capability registry](../../docs/contributing/capabilities/registry.yaml)
