# Client performance

The speed budgets for the client, and the checks that keep them. The rules
behind this page are [local first](../../principles/local-first.md),
[fast first load](../../principles/fast-first-load.md) and
[compositor-only motion](../../principles/compositor-only-motion.md).

## Budgets

These budgets are the same in every project that starts from the template. A
project can make a budget stricter. It never makes one looser. Each budget has
a check in CI.

| Budget                                       | Limit                       | Measured by                                          |
| -------------------------------------------- | --------------------------- | ---------------------------------------------------- |
| Input to next paint, for a local write       | 50 ms at p75                | End-to-end test with a trace                         |
| Network requests before a warm screen paints | 0                           | End-to-end test with a warm store                    |
| JavaScript for the first screen, compressed  | 150 KB                      | Build output check                                   |
| Largest contentful paint, cold visit         | 1.5 s at p75 on a mid phone | Lab run against each preview                         |
| Largest contentful paint, warm visit         | 0.5 s at p75                | Lab run against each preview                         |
| Animated layout properties                   | 0                           | `lint`: `no-low-performance-animation-properties`    |
| Duration literals outside the speed tokens   | 0                           | `lint`: `declaration-property-value-disallowed-list` |
| Longest speed token                          | 350 ms                      | `lint`: `declaration-property-value-allowed-list`    |
| Motion for a frequent interaction            | 150 ms                      | The quick and fade-out speed tokens                  |

The [CSS lint](../setup/lint-rules.md#css) runs the three lint rules.

<!-- kickoff: The file or target for each check that needs the app: the end-to-end trace, the warm-store test, the build output check and the lab run. Then the tracking issue for the weekly check against the live site. -->

## Rules

- A stricter budget goes in the same PR as the reason for it.
- The build marks the app start with `performance.mark('appStart')` in the
  inline boot script. Each budget that starts at boot measures from that mark.
- A new dependency in the first-screen chunks names its compressed size in
  the PR.

## Build

<!-- kickoff: The build tool, its config file, the browser targets, the chunk rule (one chunk for each dependency), the preload list and the service worker. -->

## What to read when changing it

<!-- kickoff: The build config, the HTML entry, the service worker, the duration tokens and the budget checks. -->

- [Local-first sync](./local-first-sync.md)
- [Fix the root bottleneck](../../principles/fix-the-root-bottleneck.md)
