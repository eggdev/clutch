# Lint and format rules

[`oxlint.config.ts`](../../../oxlint.config.ts) holds the lint baseline. It
extends the `core` preset of [Ultracite](https://github.com/haydenbleasel/ultracite)
and then states each choice that differs from it. The repository import policy
is in the same file. See [import boundaries](../import-boundaries.md).

## How a rule is chosen

1. **Ultracite is the base.** Its `core` preset turns on about 470 rules. The
   version is pinned in `package.json`.
2. **Decide a rule when it fires.** A rule that raises no error costs nothing,
   so it stays as Ultracite sets it. When a rule fires on real code, keep it,
   turn it off or set its options. Write the choice in `oxlint.config.ts` with
   a comment that gives the reason.
3. **No suppression comments.** A rule is on everywhere or off everywhere. A
   rule with legitimate exceptions is configured or turned off, with the
   reason. It is never silenced in one file.
4. **An Ultracite upgrade is a reviewed change.** Read the preset diff. Run the
   lint, and decide each new rule that fires, as in step 2.

## Choices

The comments in `oxlint.config.ts` are the record. In short:

| Kind          | Rules                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style         | Function declarations, `Array<T>`, `type` over `interface`, named exports                                                                                                       |
| Off           | `sort-keys`, `no-await-in-loop`, `promise/avoid-new`, `default-case`, `prefer-named-capture-group`, `no-plusplus`, `no-bitwise`, and two rules that another rule already covers |
| Configured    | `prefer-destructuring` for objects only                                                                                                                                         |
| Default files | Config files and Worker entries (`apps/*/src/worker.ts`) that a tool loads by default export may use one                                                                        |

`typescript/no-explicit-any` and `no-warning-comments` come from the preset. A
marker comment such as FIXME or HACK fails lint. Record the work in an issue.

## Formatting

Oxfmt formats each file. [`.oxfmtrc.json`](../../../.oxfmtrc.json) states each
setting, even where it matches the default, so a default change in an upgrade
does not reformat the repository.

| Setting           | Value      | Reason                                                           |
| ----------------- | ---------- | ---------------------------------------------------------------- |
| Quotes            | Single     | Matches the projects this template comes from                    |
| Line width        | 100        | Long type signatures and test names wrap less                    |
| Trailing commas   | `all`      | Function parameters get them too, so a new item changes one line |
| Imports           | Sorted     | Import order is never a review comment                           |
| `package.json`    | Sorted     | The same, for a file that many changes touch                     |
| Markdown wrapping | `preserve` | The formatter keeps the line breaks that a writer chose          |

## Run it

```sh
mise exec -- bun run check
mise exec -- bun x oxlint --fix <paths>
```

The pre-commit hook runs `oxlint --fix` on staged files. See
[Git hooks](./checks.md#git-hooks).
