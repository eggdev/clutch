# 0009: React is the default, with one profile for each stack

- **Status:** accepted
- **Date:** 2026-10-28

## Context

Almost every project from this template has a React client. Agents write
`useEffect` for data loads, derived values and event logic, and each of those
has a better tool. Rules that differ for each framework cost more to keep than
rules that are the same everywhere.

## Decision

The template is a React template. The React core is the same for each stack:

- the Ultracite React preset, with the React Compiler rules as errors
- a ban on `useEffect`, `useLayoutEffect` and `useInsertionEffect` outside one
  allowed module of hooks
- the tiers and sections of 0001, and the sync model of 0003

Kickoff picks a profile. A profile sets the routing, the paths that generators
write to, and the subscriptions that the allowed hooks wrap:

| Platform | Profiles      |
| -------- | ------------- |
| Web      | Vite, Next.js |
| Native   | One, Expo     |

One is the usual choice for native. Heavy client analysis, such as DuckDB in
the browser, is a kickoff document, not a template default.

## Consequences

- An effect is visible at a glance: it is in the allowed module or nowhere.
- `no-restricted-imports` rejects the effect hooks, aliased imports and
  namespace imports too. A small lint rule must also catch `React.useEffect`
  on a default import.
- The ban needs its replacements first, or agents switch to
  `useLayoutEffect`. The list of allowed hooks is still open.
- A project with no React client, such as a pure API, deletes the React core
  at kickoff.

**Revisit if:** more than one project in four picks a profile outside this
table.
