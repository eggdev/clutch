# Client performance

The speed budgets for the client, and the checks that keep them. The rules
behind this page are [local first](../../principles/local-first.md),
[stay at 60 FPS](../../principles/stay-at-60-fps.md),
[fast first load](../../principles/fast-first-load.md) and
[compositor-only motion](../../principles/compositor-only-motion.md).

## Budgets

These budgets are the same in every project that starts from the template. A
project can make a budget stricter. It never makes one looser. The table names
what measures each budget. `check-bundle`, `renderWarm` and the lint rules run
in CI. The trace and lab-run rows need the deployed app, so the template has no
check for them. Each project adds them at kickoff.

| Budget                                       | Limit                       | Measured by                                          |
| -------------------------------------------- | --------------------------- | ---------------------------------------------------- |
| Input to next paint, for a local write       | 50 ms at p75                | End-to-end test with a trace                         |
| Network requests before a warm screen paints | 0                           | `renderWarm` in `packages/sync/testing/`             |
| Longest main-thread task                     | 50 ms                       | End-to-end test with a trace                         |
| Modules that load before the first paint     | `budget` in the check       | `check-bundle`                                       |
| Effect code in the first screen              | 0                           | `check-bundle`                                       |
| Largest contentful paint, cold visit         | 1.5 s at p75 on a mid phone | Lab run against each preview                         |
| Largest contentful paint, warm visit         | 0.5 s at p75                | Lab run against each preview                         |
| Animated layout properties                   | 0                           | `lint`: `no-low-performance-animation-properties`    |
| Duration literals outside the speed tokens   | 0                           | `lint`: `declaration-property-value-disallowed-list` |
| Duration classes outside the speed tokens    | 0                           | `lint`: `repo-classes/speed-tokens-only`             |
| `transition-all` classes                     | 0                           | `lint`: `repo-classes/no-transition-all`             |
| Longest speed token                          | 350 ms                      | `lint`: `declaration-property-value-allowed-list`    |
| Motion for a frequent interaction            | 150 ms                      | The quick and fade-out speed tokens                  |

The [CSS lint](../setup/lint-rules.md#css) and the
[Tailwind class lint](../setup/lint-rules.md#tailwind-classes) run the lint
rules.

`check-bundle` runs the `build:web` script of each client app. A client app is
an app under `apps/` that depends on `react` or `react-native`. The check then
reads each built HTML page. The first screen of a page is its module scripts
and module preloads, and each chunk that they import statically. The check
counts the source modules of those chunks. A One build has no source maps, so
the `chunkModules` plugin of `@repo/app-build` writes the modules of each chunk
to `.vite/chunk-modules.json`. The budget is the count of the largest page,
`notes.html`, and `budget` in `tools/check-bundle.ts` holds it. The check rejects a first screen over the budget, or one with a
module of Effect in it. `validate` runs it, so CI and the pre-push hook run it
too.

<!-- kickoff: The file or target for each check that needs the app: the end-to-end trace, the warm-navigation test on a 300 ms network and the lab run. Then the tracking issue for the weekly check against the live site. -->

## Rules

- A stricter budget goes in the same PR as the reason for it.
- The build marks the app start with `performance.mark('appStart')` in the
  inline boot script. Each budget that starts at boot measures from that mark.
- A new dependency in the first-screen chunks names its compressed size in
  the PR.

## Build

`apps/app/vite.config.ts` sets the Vite plugins of the web build. The rules from
[fast first load](../../principles/fast-first-load.md) apply:

- The sync transport, the RPC client and Schema decode load in one chunk after
  the first paint. The head never preloads that chunk on a cold visit.
- The `build:web` script of `apps/app` runs `one build`, then
  `tools/web/service-worker.ts` on `dist/client`. That step writes `sw.js`,
  which precaches every file of the built client. It also writes the sync chunk
  names into the boot script of each page.
- `apps/app/lib/service-worker.ts` registers the worker after the page loads,
  in a production build of the web only. `service-worker.native.ts` does
  nothing.
- Each build gets its own cache name. The worker of a build deletes the caches
  of other builds when it activates.
- Client code imports from `effect` and from `types/` as types only. A value
  import would pull Effect into the first screen.

<!-- kickoff: The browser targets, the chunk rule (one chunk for each dependency) and the preload list. -->

## What to read when changing it

- `apps/app/vite.config.ts`, `apps/app/app/_layout+ssg.tsx` and `apps/app/lib/boot.ts`
- `apps/app/lib/boot-script.ts`
- `tools/check-bundle.ts` and `packages/app-build/runtime/chunk-modules.ts`
- `tools/web/service-worker.ts` and `apps/app/lib/service-worker.ts`
- `packages/sync/runtime/boot.ts`

<!-- kickoff: The other budget checks. -->

- [Local-first sync](./local-first-sync.md)
- [Fix the root bottleneck](../../principles/fix-the-root-bottleneck.md)
