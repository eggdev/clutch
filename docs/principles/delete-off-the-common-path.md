# Delete what is off the common path

The common path is the one the product takes. Delete branches, fields, flags,
shims, aliases, codemods and docs that exist only for a path the product does
not take. A leftover trains the next change to preserve it.

A finished migration is one case. The migration is not done until the old way is
gone. Do not run two lanes, unless a sender we cannot update still uses the
old one (see below). The `knip` check reports unused files, exports and
dependencies. Hunt for the leftovers that it cannot see: compat shims, aliases,
codemods with nothing left to migrate, checks that still police an old name,
and doc sentences that only say the old name is gone.

Speculative code is another case. Add no empty tables, no flags for features
that do not exist, and no placeholder branches. The
[project intent](../contributing/project-intent.md) "later, not now" list says
which features to keep room for. Room means a shape that does not block them,
never code for them.

## When an old copy can still arrive

A merge to `main` is production. When a shape reached `main`, a copy of it can
still arrive from outside: a stored record, a device cache or a request from an
installed build. Code that never reached `main` needs no guard.

Who controls the sender decides the rule:

| Sender                                                                                            | Rule                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| We can update it: our web app, our services, stored records we can migrate                        | Update or migrate it in the same change. Reject the old shape at the boundary that reads it. The error names the replacement. Stored data fails closed. |
| We cannot force an update: an installed app build, a third-party integration, a public API client | Keep the old lane until measured traffic shows it is empty. Then delete it.                                                                             |

An old lane for a sender we cannot force follows these rules:

- Add the new lane first. Never remove the old lane in the change that makes
  the new lane work.
- Count the traffic on the old lane by name.
- Open a cleanup issue in the same change. Its "Ready when" is the measured
  condition, such as no requests for 30 days. A date alone is not a condition.
- The old lane only translates into the new shape. It gets no new features.

When a removal needs a second deploy, open an issue in the tracker in the same
change.

Removals of data, auth or stored shapes are one-way doors. See
[two-way and one-way doors](./two-way-doors.md).

## Example

A module exports `renderLegacyCard`, and no route or module imports it. Nothing
outside the deploy holds it. Delete the function, its test and its doc line in
one change.

## Related

- [Fail loudly at the right layer](./fail-loudly.md)
