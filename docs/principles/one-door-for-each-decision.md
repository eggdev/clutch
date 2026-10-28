# One door for each decision

Some checks are dangerous to forget: who may act, whose data a request
touches, which plan limit applies, whether a flag is on. A forgotten check of
this kind fails silently. The route works, and it leaks data or gives away the
product. Review misses it, because a missing check looks the same as a route
that needs none.

Each of these decisions has one door:

1. **One function makes the decision.** Every caller goes through it. When the
   rule changes, one edit changes it everywhere.
2. **Every surface declares what it needs.** A route, an API operation, a tool
   or a job states its requirement in a required field. `'none'` is an
   explicit value, so an open surface is a choice that a reviewer can see.
3. **A check fails on a missing declaration.** The type system rejects it, or
   a test walks the route table and fails. Forgetting is not possible.

## Where it applies

| Decision      | The door                                  | The declaration                   |
| ------------- | ----------------------------------------- | --------------------------------- |
| Who is acting | One function derives the request context  | Each entry point names its source |
| Access        | One access check                          | Each surface names its permission |
| Plan limits   | One limit check, in the write transaction | Each create path names its limit  |
| Feature flags | One registry in code, which fails closed  | Each gate names a registered flag |

Use it for security, money and who sees what. Do not use it for layout,
formatting or plain business logic. There, a second way to do a thing costs
little.

When you add a new kind of guard, such as a rate limit or an export
permission, give it a door and a declaration before the second caller exists.

## Example

```ts
export const routes = [
  { path: '/projects/:id', permission: 'project:read', handler: showProject },
  { path: '/health', permission: 'none', handler: health },
] satisfies Array<{ path: string; permission: Permission | 'none'; handler: Handler }>;
```

A route without `permission` does not compile. `showProject` also calls
`authorize(request, 'project:read', project)` with the project it loads, so a
later grant model narrows it with no new code.

## Related

- [Authorization](../contributing/architecture/authorization.md)
- [Request context](../contributing/architecture/request-context.md)
- [Fail loudly in the right module](./fail-loudly.md)
