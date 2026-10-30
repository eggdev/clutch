# In-repo custom lint plugin / rules

A custom lint plugin holds the lint rules that a repository writes for its own architecture and conventions.

## Why

Rank 55 of the researched practices. Almost two thirds of the leading repositories use it (63%). A generic linter does not know the boundaries of a project. An in-repo rule turns a repeated review comment into an error that names the fix.

## Detection

`clutch doctor` reports this capability as present when two rules pass. Git tracks a `.mjs` file in `tools/lint/`. Git also tracks a test file in `tools/lint/` or below it. It is partial when only one rule passes. See the `custom_lint_plugin` entry in [the registry](./registry.yaml).

## Adopt

1. Write each rule set as a plugin module in `tools/lint/`. This repository has plugins such as [`import-policy.mjs`](../../../tools/lint/import-policy.mjs) and [`gate-policy.mjs`](../../../tools/lint/gate-policy.mjs).
2. Register each plugin in the `jsPlugins` list of [`oxlint.config.ts`](../../../oxlint.config.ts).
3. Add a test next to each plugin, such as [`gate-policy.test.ts`](../../../tools/lint/gate-policy.test.ts).
4. Read [lint rules](../setup/lint-rules.md) for how this repository chooses a rule.
5. Set `custom_lint_plugin` to `adopted` in `clutch.yaml`.

## Waive

Set `custom_lint_plugin` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when the stock rules cover every convention of the project.
