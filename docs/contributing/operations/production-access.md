# Production access

Agents never hold a production credential that can write data or read
customer content. An agent cannot leak or misuse a credential it does not
have. People follow the same path, so no one keeps standing access to
customer data.

| Need                                      | Path                                              |
| ----------------------------------------- | ------------------------------------------------- |
| Change production                         | The deploy workflow, or a runbook step            |
| Read numbers: counts, rates, usage trends | A read-only analytics credential, described below |
| Query production data                     | A production query workflow, described below      |
| Support a customer                        | The support access that their admin grants        |

## Analytics credentials

An agent may hold one analytics credential. It is read-only, and it reads only
aggregates: counts, rates and trends with no customer content and no personal
data. It cannot reach the production database, object storage or a secret.

<!-- kickoff: The analytics source, the credential name and what it can read. Delete this slot when the project has no analytics source. -->

## Production query workflows

A question that aggregates cannot answer runs as a CI workflow:

1. The workflow runs only from `main`, so each query is reviewed code.
2. A person starts it by hand. The workflow refuses to run unless the actor is
   on its allowlist and types the confirmation text. The allowlist changes
   only in a reviewed PR.
3. The query is read-only. Writes go through a runbook.
4. The output leaves CI only sealed to the requester's public key. Actions logs
   and artifacts can be world-readable, so the run summary shows no data and
   no counts.
5. The requester opens the sealed output on their machine and keeps it out of
   the repository.

<!-- kickoff: The production query workflows, one line each: the file, what it reads and who may start it. Delete this slot when there is none. -->

## Rules

- Never paste a production credential into an agent session, a chat or an
  issue. When an agent needs production data, write a query workflow.
- A CI secret that reaches production lives in the `production` environment,
  and only production steps read it.
- A credential for one runtime is never the deploy credential. See
  [operator accounts](./operator-accounts.md).

## Related

- [Security](../security.md)
- [Two-way and one-way doors](../../principles/two-way-doors.md)
