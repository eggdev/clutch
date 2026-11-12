# 0005: The owner signs off what cannot be paid back

- **Status:** accepted
- **Date:** 2026-11-12

## Context

Decision 0002 held a hard core for the owner: the merge gate, credentials, auth and access, migrations, and the decision records and policy docs. Agent review added an `owner` finding for each weaker check.

On 2026-11-12, 34 of the last 100 merged PRs had waited for the owner by a path rule. 28 of them changed the code or the rules of the merge gate, and 10 changed a decision record or a policy doc. Some changed both. None was a major change. A council review of the same day asked for more holds. Its rule would have held 90 in 100.

The owner chose the other direction. He decides what to build, and he picks the direction in the prototype and the design phase. After that, a change that passes its proof merges with no word from him. He pays a problem back after he finds it.

## Decision

A pull request waits for the owner only where a mistake cannot be paid back later:

- a major change: a title with `!`, a changeset that names a major bump, or a contract break
- a credential: the secret-scanning files, the MCP server lists, and a workflow line that gives a write permission, a secret, an environment or a privileged trigger
- who an actor is and what it may see: auth, access and identity
- a migration

The code and the rules of the merge gate, the decision records and the policy docs merge as any other change. We will not hold a path because it is important. The proof holds it: the checks, the journeys and the blocking findings of agent review. The automatic revert and the brake of auto-merge pay a wrong merge back.

## Consequences

An agent can change a check, a lint rule or this policy with no person. The owner accepts that risk, and reads such changes after the fact. CL-472 moves the `owner` findings of agent review into the weekly digest for that purpose.

On the same 100 PRs, the rule holds 16. Fifteen of them are workflow lines that give a grant. The owner may drop that hold. A leaked credential is the reason that it stays.

Auth, access and migrations stay with the owner for now. They leave him when their journeys exist and pass on each PR. See CL-441 and [proof gates code](../../principles/proof-gates-code.md).

**Revisit if:** an auto-merged change to the merge gate or to a check is reverted, or a problem that the owner finds traces back to one. Then hold that path again, with the evidence.
