# Environment variables

One schema defines each environment variable. It is the source for the types
and for the runtime check.

<!-- kickoff: The path of the environment schema file, and the file that reads it at startup. -->

## Rules

- **Fail fast.** Startup checks the environment against the schema. A missing
  or bad required value stops startup. See
  [fail loudly at the right layer](../../principles/fail-loudly.md).
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
export const EnvSchema = object({
  SESSION_SECRET: string().refine(
    (value) => value.length >= 32,
    'SESSION_SECRET must be 32 characters or more. Run: openssl rand -base64 48',
  ),
  MAIL_API_KEY: string().refine(
    (value) => value.length > 0,
    'Missing MAIL_API_KEY. Get it from the mail vendor dashboard, API keys page.',
  ),
});
```

## Add a variable

1. Add it to the schema, with a message that says where to get the value.
2. Add it to the example env file with a safe local value.
3. Add it to the deploy workflow as a variable or a secret.
4. Add its secret name to [operator accounts](../operations/operator-accounts.md)
   when a vendor issues it.
5. Add a row to the table below.

## Variables

| Name | Required | Secret | Purpose |
| ---- | -------- | ------ | ------- |

<!-- kickoff: One row for each variable that exists at kickoff. Delete this slot if there are none yet. -->
