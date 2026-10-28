# Request context

Every request carries one request context, whatever reached it: a browser
session, an API token, a scheduled job, a webhook or an inbound message. It
answers these questions in one shape:

| Field         | Question                                   |
| ------------- | ------------------------------------------ |
| `tenant`      | Whose data does this touch?                |
| `actor`       | Who acts? `null` for automation.           |
| `attribution` | Who is the work billed and audited to?     |
| `credential`  | What authenticated it, and does it narrow? |
| `membership`  | Which role does the actor hold?            |

<!-- kickoff: The file that defines the shape, and the project's names for tenant and actor. -->

## Rules

This page applies [one door for each decision](../../principles/one-door-for-each-decision.md).

- **Nothing builds a context by hand.** Each entry point names its source, and
  one function derives the context from that source. The source is a required
  parameter, so a new entry point does not compile until it names itself.
- **Tenant IDs and person IDs are separate types.** A branded type for each
  makes a mix-up a compile error. One function converts a person into their
  personal tenant. Acting in any other tenant goes through a membership check.
- **Automation has no actor.** A scheduled job, a webhook or an inbound
  message runs with `actor: null`, and attribution names the source.
- **Work started by other work inherits its lineage.** The starting actor,
  attribution and credential travel with it. A reader validates lineage again
  when it reads it from storage. Work without lineage runs as automation, which
  can only narrow what the starter could do.
- **The context is derived, never stored.** Stored jobs keep the source. The
  context is derived again when the job runs.
- **Storage keys use the tenant ID.** Public surfaces show a slug, never the
  internal tenant ID.

## Sources

| Source | How the request arrives                           | Actor  |
| ------ | ------------------------------------------------- | ------ |
| `sync` | `Push` on the organization's WebSocket at `/sync` | Person |

The sync server asks the `Actors` service in `packages/identity` for the actor
of each socket and each call. It passes the request headers of the socket.

- In local development, `runtime/dev.server.ts` reads the `x-dev-user-id` and
  `x-dev-organization-id` headers. Without them, it uses `DEV_USER_ID` and
  `DEV_ORGANIZATION_ID`.
- Any client can claim any actor with the development Layer. A project replaces
  it with a Live Layer for its sign-in vendor.

<!-- kickoff: One row for each other entry point from the journeys, and the Live Layer that builds `Actors` from the sign-in vendor. -->

## What to read when changing it

<!-- kickoff: The files that define the shape, the derivation and the entry points. -->

- [Authorization](./authorization.md): the access check that reads this shape
