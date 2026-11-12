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
- `Access.canUseGroup(db, actor, group)` decides if the actor may write a
  record of one sync group. The organization and the user's own group pass. A
  space group passes for a member of the space.
- Every actor is in the general space, which has no record, and no one can
  leave it.
- A membership is a record in the user's own group. A change to it makes the
  sync server ask `groupsFor` again.

`SyncGroupsFromAccess` in `packages/access/service/access.ts` gives both to the sync engine
through the `SyncGroups` seam. See [local-first sync](./local-first-sync.md#sync-groups).

## One door for each write

Each command declares its access in a required `access` field.
`serverChange` runs the rule before the change, so a server change never
checks access by hand. A command without the field does not compile.

| Rule                                       | Who may run the change                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `access: 'organization'`                   | Any actor of the organization                                            |
| `access: 'group'`, with a `group` function | An actor that `canUseGroup` allows for the returned group                |
| `permission`, when the command has one     | An actor whose role on the group grants the permission, through `allows` |

The `group` function returns the sync group of the record that the change
writes. It returns `null` when the record does not exist, and the change is
rejected. `packages/notes/commands/rename-note.server.ts` reads the note's
space this way.

A command with `access: 'group'` writes only records of the group that its `group` function returns.
`serverChange` checks each change that `run` returns. A change without that group is a defect, and nothing commits.
The rule does not apply to `access: 'organization'`, because a record of the organization may sit in a smaller group of it.
`packages/sync/commands/server-change.server.test.ts` tests both cases.

## Permissions

A command may name a `permission`, such as `project:publish`. The server
checks it after the access rule. The sync engine calls `allows` on the
`SyncGroups` seam with the database, the actor, the group and the permission.

- The group is the group of the record, or the organization group when `access` is `'organization'`.
- `allows` is optional. A project with roles provides it. `SyncGroupsFromAccess` in `packages/access/service/access.ts` gives none.
- Without `allows`, a command with a permission is refused with `forbidden`. A missing rule never opens a command.
- A refused permission gives `forbidden` and the reason `You need the <permission> permission.`
- `packages/sync/commands/server-change.server.test.ts` tests all three cases.

## Which surfaces check a permission

This page applies [one door for each decision](../../principles/one-door-for-each-decision.md).
A command may declare a `permission`. A tool runs its command, so it has the command's rule.
A route declares no permission, so no check covers it. `tool: 'none'` is an explicit value: the command offers no tool.
A command with a `permission` is refused until a project supplies `allows`.

- A command declares `access` in a required field, so one without it does not
  compile. A server half with `access: 'group'` needs a `group` function, and
  one without it does not compile. `packages/sync/commands/server-change.server.test.ts`
  proves both.
- A command that changes who is a member declares `tool: 'none'`, so no agent
  may call it. `packages/access/contract/access.ts` does this.
- An HTTP route from `defineRoute` has no permission field yet, and no check
  covers it. A route checks its caller itself, such as a webhook that checks
  a signature.

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

- `packages/access/service/access.ts`, `packages/access/contract/access.ts` and `packages/sync/commands/server-change.server.ts`
- [Request context](./request-context.md)
