# 0007: Effect loads after the first paint

- **Status:** accepted
- **Date:** 2026-10-28

## Context

The JavaScript for the first screen has a budget of 150 KB compressed (see
[client performance](../architecture/client-performance.md)). The sync engine
uses Effect (0005). We measured each client shape with `effect@4.0.7`, React
19.3.1 and Vite 8, on a one-screen app:

| Shape                                   | First screen, brotli |
| --------------------------------------- | -------------------- |
| React alone                             | 58.1 kB              |
| Effect on the first screen              | 102.7 kB             |
| Effect in a chunk after the first paint | 59.4 kB              |
| The same, with one value import in UI   | 95.1 kB              |

The Effect sync stack (core, Schema and the RPC client) is 42.4 kB brotli.

## Decision

The first screen has no Effect code. Screens and the object pool import
schema types with `import type` only. The sync chunk loads after the first
paint. It holds the transport, the RPC client and Schema decode. The object
pool stores records in their encoded form, so loading the local database
needs no decode.

## Consequences

- A lint rule in UI code rejects value imports from `effect` and from
  `types/`. Type imports stay allowed, with `verbatimModuleSyntax` on.
- A constant that UI needs, such as a list of states, lives in plain
  TypeScript. `types/` builds its schema from that constant.
- The first-screen size check also rejects a first-screen file that contains
  `~effect/`. That string marks Effect code. Check it after each Effect
  upgrade.
- On a cold visit, the page does not preload the sync chunk. On a warm visit,
  the boot script preloads it from the service worker cache.
- Each server stream element holds at most 1,000 deltas. Decoding 10,000
  deltas took 22 ms on a desktop, and no phone time is measured yet.

**Revisit if:** a mid-range phone trace shows sync work as a task longer than
50 ms. Then move the sync engine into a module worker. That changes only the
boot code.
