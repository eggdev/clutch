# Seed data

One seed world serves local development, previews and migration rehearsals. A
seed builds it through the product's own commands, never through raw inserts,
so seed data always passes the same rules as user data.

## Rules

- **The seed is deterministic.** The same run gives the same accounts, IDs and
  records, so a test or a person can name them.
- **Each role has one seed account.** A reviewer can sign in as any role.
  Credentials are fake and local, and the seed page lists them.
- **A schema change updates the seed in the same change.** A seed that fails
  on the new schema fails `validate`.
- **Seeding refuses production.** A remote seed runs only against a preview
  and checks the target name first. See
  [destructive automation](./previews.md#destructive-automation-checks-the-name-first).

<!-- kickoff: The seed command, the seed accounts (one row for each role: email, role, what it can show), and the records each journey needs. -->
