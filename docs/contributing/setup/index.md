# Setup

How to run, check and ship the project. Open only the page you need.

- [Local development](./local-development.md): tools, `bun run dev`, services,
  configuration
- [Worktrees](./worktrees.md): a separate checkout for each task, with its own
  ports, data and test output
- [Verification setup](./verification.md): full-stack access, platform checks,
  representative data and evidence for delivery
- [Environment variables](./environment-variables.md): Effect `Config`, each
  variable, and how to add one
- [TypeScript](./typescript.md): one config for each environment, and committed
  generated types
- [Nx](./nx.md): how to run tasks, project names and the generators
- [Native builds and devices](./native.md): the device host, the device lock,
  and `native:build`, which builds only when the native fingerprint changed
- [Checks](./checks.md): `validate`, each check, CI
- [CI credentials](./ci-credentials.md): each secret a workflow reads, its
  scope, and the OIDC decision
- [Releases](./releases.md): changesets, the version and `CHANGELOG.md`
- [Previews](./previews.md): a preview for each PR, flow checks, and the name
  guard on destructive automation
- [Migrations](./migrations.md): Drizzle Kit, where migrations live, and why a
  merged one never changes
- [Seed data](./seeding.md): the seed world and one account for each role
- [Lint and format rules](./lint-rules.md): the Ultracite baseline, each choice
  we made, and the formatter settings
- [Dependencies](./dependencies.md): exact pins, the production audit, overrides
- [Documentation maintenance](./documentation-maintenance.md)

Do not vendor generated package docs into this repository. Link to the
official docs.
