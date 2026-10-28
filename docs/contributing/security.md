# Security

This page holds the security rules that each change must keep, and the risks
that the [owner](./project-intent.md#owner) accepts.

An audit (the `audit` skill in `.agents/skills/`) or a security review reads
this page first. It does not reopen an
accepted risk. To challenge one, show that its revisit-if condition is true.

## Rules that changes keep

Read this list before you change auth, routing, response headers, storage
queries, logging or deploy configuration.

1. **Trusted HTML keeps a strict Content Security Policy.** All first-party
   pages go through one response helper that sets the security headers. Never
   add `'unsafe-inline'` or `'unsafe-eval'` to `script-src`. Allow a required
   inline script by its hash.
2. **Untrusted content runs on a separate origin.** Content that a third party
   writes never runs on the app origin. It never gets first-party cookies or
   auth headers. Do not merge its policy with the strict policy.
3. **SQL is parameterized.** Bind each value. Never put user input into a SQL
   string.
4. **Every data path is scoped to its tenant.** Each query, storage key and
   search filter includes the tenant or account ID. Data that crosses tenants is
   a bug.
5. **Credential endpoints share one rate-limit bucket.** Each endpoint that
   accepts a password, token, reset code or second factor joins the same bucket.
   Then parallel paths do not multiply the attempts. Excess requests get `429`
   with `Retry-After`.
6. **The production rate limiter fails closed.** Startup in production stops
   when the limiter is missing. A development fallback never becomes the
   production limiter.
7. **Developer-only routes fail closed in production.** A route that helps
   debug, seeds data or runs content from a test gates on one non-production
   check. In production it does not exist.
8. **Secrets never go in logs or URLs.** Do not log a secret, token, cookie or
   reset code. Do not put one in a query string. Do not pass one as a command
   argument; pipe it on stdin. Redact email addresses in error reports.
9. **The server decides.** Validate input and permissions on the server. A
   browser check is a hint for the user.
10. **New passwords go through one shared policy.** Each place that sets a
    password calls the same check.
11. **Untrusted text renders as text.** Render third-party markdown or HTML
    only through an allowlist renderer. Never use `innerHTML` or a raw HTML
    string. Allow only `http:`, `https:` and `mailto:` links.
12. **CSRF protection has one design, and each part of it holds.** Write that
    design in the project rules below. When it uses `SameSite=Lax` cookies and
    JSON bodies, no mutating endpoint accepts a form post, and no session cookie
    uses `SameSite=None`. Writes go over the sync socket, so the socket upgrade
    must check the `Origin` header. The template's sync server has no `Origin`
    check. A project adds it with its sign-in vendor.
13. **Account recovery revokes old access.** A password reset ends every other
    session and token for the account, and tells the owner by email.
14. **Signup and reset do not show which emails have accounts.** Send the same
    response for a known and an unknown address.
15. **Background jobs do not grant access.** Role, membership, billing and
    secret grants need a signed-in person. A job, webhook or third-party code
    cannot grant itself access.
16. **Agents hold no production credential that writes data or reads customer
    content.** Production data questions run as reviewed query workflows. See
    [production access](./operations/production-access.md).

<!-- kickoff: Project rules. A numbered list that continues from 17. Each rule is one bold sentence, then the file or check that enforces it. Include the CSRF design, the tenant key name and the auth surfaces. -->

When a rule can be a check, add the check. See
[harness engineering](./harness-engineering.md) and [checks](./setup/checks.md).
A change that weakens a rule is a one-way door. See
[two-way and one-way doors](../principles/two-way-doors.md).

## Accepted risks

Each entry states:

| Part       | Content                                        |
| ---------- | ---------------------------------------------- |
| Risk       | What an attacker or a failure can do           |
| Why        | Why the owner accepts it, with the limit on it |
| Revisit if | The condition that ends the acceptance         |

Example:

- **No CSRF tokens.**
  - Risk: a cross-site request can use the session cookie.
  - Why: cookies are `SameSite=Lax` and every mutating endpoint requires a JSON
    body, which a cross-site form cannot send.
  - Revisit if: a mutating endpoint accepts a form post, or a cookie uses
    `SameSite=None`.

<!-- kickoff: The accepted risks for this product, in the format above. Ask the owner for each one. Delete the example if it does not apply. -->

To add an accepted risk, get the owner's approval in the PR. To remove one, fix
the risk and delete the entry in the same change.

## Related

- [Fail loudly in the right module](../principles/fail-loudly.md)
- [Secret rotation](./operations/secret-rotation.md)
- [Operator accounts](./operations/operator-accounts.md)
- [Environment variables](./setup/environment-variables.md)
