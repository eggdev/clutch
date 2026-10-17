# Dependencies

How the repository checks its npm dependencies. Both checks run in
`validate`. See [checks](./checks.md).

## Production audit

The `audit-prod` target runs [`tools/audit-prod.ts`](../../../tools/audit-prod.ts).
It reads the advisories for each production dependency in `bun.lock` with
`bun audit --prod`. A moderate, high or critical advisory fails the target. A
low advisory does not. Dev dependencies are out of scope, because they do not
ship.

The target asks the registry for advisories, so it needs network access. Nx
does not cache it, because the advisories change when the code does not. A
network failure fails the target with no advisory list. Check the connection
and the registry setting, then run the target again.

Fix a failure in this order:

1. Run `mise exec -- bun audit fix`. It upgrades each package to the lowest
   safe version in its declared range.
2. If no safe version is in range, upgrade the direct dependency that pulls the
   package in.
3. If a release has a fix that the range excludes, add an
   [override](#overrides) that pins a safe version, and document it.
4. If no release has a fix, the owner decides. An accepted advisory is an
   entry in [`tools/accepted-advisories.yaml`](../../../tools/accepted-advisories.yaml)
   with its reason and the event that removes it. The target fails on an
   entry whose advisory is gone from the audit, so a stale entry cannot stay.

## Overrides

Bun reads `overrides` and `resolutions` in the root `package.json`. Each key
forces one version of a package across the whole tree. An override hides the
choice from the package that asked for another version, so each one needs a
written reason.

`check-dependency-overrides` fails when:

- A key in `overrides` or `resolutions` has no `###` heading in this section.
  The first code span of the heading names the package.
- A heading has no text under it.
- A heading names a package with no override. Delete the stale section with
  the override.
- `package.json` repeats a key at any depth. JSON keeps only the last value, so
  the first one does nothing.

Write each entry like this:

```md
### `esbuild` to `0.28.2`

Floors esbuild above GHSA-xxxx-xxxx-xxxx. Vite pulls in an older copy. Remove
the override when Vite depends on 0.28.2 or later.
```

Say why the override exists, the advisory or bug it closes, and the event that
lets you remove it.

### `undici` to `7.29.1`

Floors undici above GHSA-w293-vg96-wgc3, GHSA-rfgv-xxqx-mfg5 and the other
advisories fixed in 7.29.1. Nx pins undici to exactly 7.29.0, so
`bun audit fix` cannot move it. Remove the override when Nx depends on 7.29.1
or later.
