# Environment variables

Effect `Config` defines each environment variable. It is the source for the
types and for the runtime check. Each package reads its own variables in
`config/`. An app reads its runtime variables in its composition root.

## Rules

- **Fail fast.** Startup checks the environment against the schema. A missing
  or bad required value stops startup. See
  [fail loudly in the right module](../../principles/fail-loudly.md).
- **Say where to get the value.** The error message names the variable and
  where to get its value.
- **One change for a new variable.** Update the example env file, the schema
  and the deploy workflow in the same change.
- **Fall back only for optional metadata.** When a value is optional metadata,
  such as a release name or a sample rate, startup ignores a bad value and logs
  a warning. Any other bad value stops startup.
- **Secrets stay secret.** Put a secret in the deploy secret store, never in a
  plain variable or in the example env file.

## Example

```ts
// packages/mail/config/keys.ts
export const mailConfig = Config.all({
  apiKey: Config.Redacted('MAIL_API_KEY'),
  from: Config.String('MAIL_FROM').pipe(Config.withDefault('hello@example.com')),
});
```

A Layer reads the `Config` when it builds. A missing `MAIL_API_KEY` stops
startup with an error that names the variable.

## Add a variable

1. Add it to the `config/` of the package that reads it.
2. Add it to the example env file with a safe local value.
3. Add it to the deploy workflow as a variable or a secret.
4. Add its secret name to [operator accounts](../operations/operator-accounts.md)
   when a vendor issues it.
5. Add a row to the table below.

## Variables

| Name                  | Required | Secret | Purpose                                               |
| --------------------- | -------- | ------ | ----------------------------------------------------- |
| `DATABASE_URL`        | No       | Yes    | A Postgres server. Without it, the API runs PGlite    |
| `PGLITE_DIR`          | No       | No     | The PGlite data folder. The default is `.data/pglite` |
| `PORT`                | No       | No     | The API port. The default is 4000                     |
| `DEV_USER_ID`         | No       | No     | The development actor's user ID                       |
| `DEV_ORGANIZATION_ID` | No       | No     | The development actor's organization ID               |

<!-- kickoff: One row for each other variable that exists at kickoff. -->
