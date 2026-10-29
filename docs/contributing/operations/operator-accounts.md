# Operator accounts

A map of each vendor account that the product or its CI uses. If the operator
loses access, this page and the password manager get it back.

This page holds secret names. Secret values never go in the repository.

## Accounts

For each vendor, record:

| Field         | Content                                                         |
| ------------- | --------------------------------------------------------------- |
| Owns          | What the account runs or stores for the product                 |
| Secret names  | Each secret and variable name, and who holds it (CI or runtime) |
| Configured in | The file, workflow or dashboard page that sets it               |
| Recovery      | How to get access back: login, recovery codes, support contact  |

<!-- kickoff: One section for each vendor account, with the four fields above. Include the domain registrar, the host, the source host, email, payments and the error tracker. -->

## Password manager coverage

The password manager holds each fact that the repository cannot hold:
account logins, recovery codes, registrar details and secret values.

Each item on this page names what the password manager records. Use the form
`Password manager: <what is recorded>`. Never write the value.

<!-- kickoff: The password manager the owner uses, and a numbered list of what it records for each vendor. -->

## Runtime tokens

1. Each runtime gets its own token.
2. Each token has the smallest permission set that its runtime needs. Record
   the permissions in the account section.
3. The deploy token stays in CI. Never give it to a runtime.
4. CI stops the deploy before any production write when a runtime token is
   missing, or when it equals the deploy token. That check belongs in CI, next
   to the deploy job.

A leaked runtime token then exposes only that runtime.

## Rules

- Add a vendor to this page in the same change that adds its first secret.
- When a token changes, update its name or permissions here in the same change.
- To rotate a key, see [secret rotation](./secret-rotation.md).
- Each variable has one home for its meaning. See
  [environment variables](../setup/environment-variables.md).
