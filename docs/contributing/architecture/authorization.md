# Authorization

One function decides whether a request may do something. It reads the
[request context](./request-context.md) and a permission, and optionally the
resource it touches.

| Question                         | Answer                                                                    |
| -------------------------------- | ------------------------------------------------------------------------- |
| Who may act in a tenant?         | Members, through the roles below                                          |
| Who may act on the whole system? | Operators, through a separate system. Neither system implies the other.   |
| Where is the decision made?      | <!-- kickoff: the access check function and its file -->                  |
| What does a denial look like?    | A typed error that names the denial code, the permission and the resource |

## The access check

The check runs these steps in order, and stops at the first denial:

1. **Signed in.** A request without a person is denied, unless the surface
   declares that it needs no permission.
2. **Tenant binding.** The resource belongs to the request's tenant.
3. **Effective permissions.** The actor's roles and grants allow the
   permission.
4. **Credential narrowing.** The credential's scopes allow the permission.

Nothing caches a grant across requests. Each request reads the current access
state. See [fix the root bottleneck](../../principles/fix-the-root-bottleneck.md)
for what to do when the check gets slow.

## Who sees which records

`packages/access` owns what each actor may see.

- `Access.groupsFor(actor)` names the sync groups the actor may load. Every
  actor loads its organization and its user groups at once. Each space of the
  actor loads when a gate asks for it.
- `canUseSpace(db, actor, spaceId)` is the check that a server change runs in
  its own transaction. A note command calls it before it writes.
- Every actor is in the general space, which has no record, and no one can
  leave it.
- A membership is a record in the user's own group. A change to it makes the
  sync server ask `groupsFor` again.

`runtime/sync-groups.server.ts` gives `groupsFor` to the sync server through
the `SyncGroups` seam. See [local-first sync](./local-first-sync.md#sync-groups).

## Every surface declares its permission

This page applies [one door for each decision](../../principles/one-door-for-each-decision.md).
Each route, API operation and tool declares the permission it needs. The
declaration is a required field, so a surface without one does not compile.
`'none'` is an explicit value: the surface touches no tenant data. A test walks
the route table and fails on a route that declares nothing.

Handlers that touch a concrete resource also call the check with that
resource, so a later grant model narrows them with no new code.

## Actions that need a live person

Some actions never run unattended: changing members, roles or billing. One
predicate decides what a live person is: an actor, plus a credential that a
person used directly. Automation and work started by automation are never live.
A surface declares the requirement once, and the dispatch path checks it.

## Roles

<!-- kickoff: A table: Role, what it may do. Name the operator system and how operators get access to tenant data, from project intent. -->

## What to read when changing it

<!-- kickoff: The files that define permissions, the access check and the route table test. -->

- `packages/access/service/access.ts` and `packages/access/runtime/sync-groups.server.ts`
- [Request context](./request-context.md)
