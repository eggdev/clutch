# Dependencies

How the repository checks its npm dependencies. Both checks run in
`validate`. See [checks](./checks.md).

## Production audit

The `audit-prod` target runs:

```sh
bun audit --prod --audit-level=moderate
```

It reads the advisories for each production dependency in `bun.lock`. A
moderate, high or critical advisory fails the target. A low advisory does not.
Dev dependencies are out of scope, because they do not ship.

The target asks the registry for advisories, so it needs network access. Nx
does not cache it, because the advisories change when the code does not.

A failure lists each package, the dependency path to it and each advisory:

```text
smol-toml@1.6.1
  (direct dependency)
  high: smol-toml: Denial of Service via malformed TOML documents (<=1.7.0) - https://github.com/advisories/GHSA-7w5x-hrqm-74c2
  moderate: smol-toml: Quadratic-time parse() from parseKey rescanning to end of document on each key line (<=1.8.0) - https://github.com/advisories/GHSA-r4xh-jqrq-34v2

2 vulnerabilities (1 high, 1 moderate)
```

Fix it in this order:

1. Run `mise exec -- bun audit fix`. It upgrades each package to the lowest
   safe version in its declared range.
2. If no safe version is in range, upgrade the direct dependency that pulls the
   package in.
3. If no upstream release has a fix, add an [override](#overrides) that pins a
   safe version, and document it.

A network failure also fails the target, with no advisory list:

```text
error: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - ConnectionRefused
```

Check the connection and the registry setting, then run the target again.

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
