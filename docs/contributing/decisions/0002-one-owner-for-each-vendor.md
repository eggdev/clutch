# 0002: To change a vendor, rewrite one package

- **Status:** accepted
- **Date:** 2026-10-28

## Context

[Generic platform](../../principles/generic-platform.md) gives each vendor one
owner package, and `repo-imports/vendor-owner` checks who imports the vendor.
A vendor can still leak. A public function can return a vendor type, and type
inference carries that type to each caller. Then a change of vendor edits
every caller.

## Decision

A change of vendor, such as a new auth provider, edits one package. The rest
of the product does not change.

1. A vendor import is allowed only in a private section or in `runtime/`.
   It is never allowed in `types/`, `service/` or `ui/`.
2. A `check-vendor-leaks` check reads the declaration files of the public
   sections. It rejects a reference to a vendor package.
3. Each package that owns a vendor has a fake and a Test Layer in `testing/`.

The service is an Effect `Context.Tag` in `service/`. The Live Layer in
`runtime/` uses the vendor. The Test Layer in `testing/` uses the fake. The
composition root of each app selects the Layer.

## Consequences

- One adapter shows a seam that nobody tested. Two adapters, the Live Layer
  and the Test Layer, prove that the interface does not depend on the vendor.
- A move to a new vendor is a third adapter and a one-line change in the
  composition root.
- Each owner package must keep its fake correct. Tests through the interface
  run against both Layers.
- The template already emits declaration files (`emitDeclarationOnly`), so the
  leak check needs no type-aware lint.

**Revisit if:** a vendor change edits files outside its owner package and the
composition root.
