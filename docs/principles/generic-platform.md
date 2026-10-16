# Generic platform

Each vendor has exactly one owner module. Only the owner imports the vendor. The
owner's public API is vendor-free, so other modules ask for a capability and
never see the vendor. To move off a vendor, rewrite its owner module. Callers do
not change.

The owner list is the
[primitives registry](../contributing/architecture/primitives.yaml). Each
vendor is in the `vendors` list of its owner. The `repo-imports/vendor-owner`
lint rule reads the registry and rejects a vendor import outside its owner. Add
the vendor to the registry in the same change that adds the dependency. The
registry also says what each owner does.

Modules depend on other modules, never on another module's vendor. A sign-in
module sends a code through the email module. It never imports the email
provider.

Some dependencies are shared languages, not wrapped vendors: a query builder or
a UI framework. Each shared language is a `layers` entry in the registry
that names the folders that may speak it. The owner of the driver still owns the
connection, migrations and transactions.

## Example

```ts
// packages/identity/src/server.ts is the only file that imports the auth vendor.
import { createIdentity } from '@repo/identity/src/server';

const identity = createIdentity(env);
const actor = await identity.requireActor(request);
```

The caller asks for an actor. It does not know which vendor signs people in.

## Related

- [Import boundaries](../contributing/import-boundaries.md)
- [Normalized source of truth](./normalized-source-of-truth.md)
