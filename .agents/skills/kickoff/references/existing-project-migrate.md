# Existing project: migrate

The install CLI starts this stage with `/kickoff migrate`. Nobody watches it.
Your goal: `mise exec -- bun run validate` passes, and the project follows each
decision from the interview.

## Rules

1. **Ask nothing.** Write each item that needs the owner into the findings.
2. **Follow the decisions.** Read each `resolution` in
   `.template-install/manifest.json` and each decision record in
   `docs/contributing/decisions/`. A convention that the owner kept changes
   the configuration, not the code.
3. **Do not hide a failure.** Do not add a disable comment, an ignore entry, a
   baseline, a skipped test or a larger budget, unless a decision record names
   it.
4. **Do not change behavior.** When a fix would change what a user sees or
   what the product stores, stop work on that item and record it.
5. **One commit for each step.** Run the step's check before you commit. Use
   the message `Migrate: <step>`.
6. **Use only these commands.** The run denies all others:
   - the survey commands in [existing-project-survey.md](./existing-project-survey.md#rules)
   - `git rm` and `git mv`
   - `mise exec -- bun run format`
   - `mise exec -- bun x oxlint --fix`
   - `mise exec -- bun test`
   - `mise exec -- bun nx run-many -t <target>` for `typecheck`, `lint`,
     `test`, `format-check` and `checks`

## Steps

Do the steps in order. Each step starts from a clean tree.

1. **Package manager.** Delete the lockfiles of other package managers. Run
   `mise exec -- bun install`.
2. **Replaced tools.** For each entry resolved as `template`, delete the
   project's configuration files, dependencies and scripts for that tool.
3. **Projects.** Give each app and package the shape that the template
   expects: its `package.json`, its tsconfig files, its Nx tags and its
   registry entry. Run the project's existing tests from its Nx `test` target.
4. **Format.** Run `mise exec -- bun run format`. Commit this step alone,
   because its diff is large and mechanical.
5. **Lint fixes.** Run `mise exec -- bun x oxlint --fix .`.
6. **Types.** Fix each error from the `typecheck` target.
7. **Lint.** Fix the rest of the `lint` errors by hand. Use one commit for
   each rule when a rule has many errors.
8. **Tests.** Make the `test` target pass.
9. **Checks.** Fix the `checks` target, one commit for each check.
10. **Validate.** Run `mise exec -- bun run validate`.

## End

- **Validate passes.** Delete the install folder with
  `git rm -r .template-install`, and commit
  `Migrate: remove the install folder`. Kickoff is done. The CLI reads the
  missing manifest as the end.
- **Items need the owner.** Add a section **Migration: open** to
  `.template-install/findings.md`. For each item, write the failure, what you
  tried and the decision that the owner must make. Set `stage` to `interview`,
  and commit. The next run of the CLI opens a short interview about those items.
- **You must stop early.** Commit the finished steps, and leave `stage` as
  `migrate`. The next run continues after the last `Migrate:` commit.
