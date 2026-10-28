# Generic platform

Each vendor has exactly one owner package. To move off a vendor, rewrite its
owner package. The rest of the product does not change.

- Only the owner imports the vendor, and only in its `config/`, `repo/`,
  `runtime/` or `testing/`. Its public sections never show the vendor.
- The owner declares a service in `service/`. Callers ask the service for a
  capability, and never see the vendor.
- The Live Layer in `runtime/` uses the vendor. The Test Layer in `testing/`
  uses a fake. Two adapters prove that the seam is real.
- The composition root of each app selects the Layer. A change of vendor is a
  new Live Layer and one line in the composition root.

The owner list is the
[primitives registry](../contributing/architecture/primitives.yaml). Each
vendor is in the `vendors` list of its owner. The `repo-imports/vendor-owner`
lint rule reads the registry and rejects a vendor import outside its owner.
`check-vendor-leaks` reads the declarations of each public section and rejects
a vendor type there. Add the vendor to the registry in the same change that
adds the dependency.

Packages depend on other packages, never on another package's vendor. A
sign-in package sends a code through the email package. It never imports the
email vendor.

Some dependencies are shared languages, not wrapped vendors: a query builder or
a UI framework. Each shared language is a `languages` entry in the registry
that names the folders that may speak it. The owner of the driver still owns the
connection, migrations and transactions.

## Example

`packages/identity` declares the current actor as a service:

```ts
// packages/identity/service/current-actor.ts
export class CurrentActor extends Context.Service<CurrentActor, Actor>()('identity/CurrentActor') {}
```

A server change reads the actor and does not know which vendor signs people
in. `runtime/dev.server.ts` builds the service for local development. A project
adds a Live Layer for its sign-in vendor in `runtime/`, and the composition root
in `apps/api/src/main.ts` selects it.

## Related

- [Import boundaries](../contributing/import-boundaries.md)
- [Server](../contributing/architecture/server.md)
- [Normalized source of truth](./normalized-source-of-truth.md)
