# 0004: No design canvas tool for proposals

- **Status:** accepted
- **Date:** 2026-11-03

## Context

The [design-proposal](../../../.agents/skills/design-proposal/SKILL.md) skill
builds each proposal in the app. Today's screen and 2 or 3 directions render on
the project's real components and tokens, at phone and desktop widths. The
owner picks a direction, and the build follows it. Brendan asked whether Pencil
(pencil.dev) or Paper (paper.design) adds real value on top. Both are canvas
tools that coding agents drive through MCP. Checked on 2026-11-03:

| Criterion       | Pencil                                                         | Paper                                                         | In-app proposal                  |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| MCP             | Read and write on `.pen` files, from the IDE or a desktop app  | Read and write: frames, styles, text, screenshots, JSX export | Not needed. The agent edits code |
| Real components | No. Its own shapes and components, which an agent then recodes | No. Its own HTML and CSS, exported as React and Tailwind JSX  | Yes. The design system itself    |
| React Native    | No native runtime                                              | No. The canvas is HTML and CSS, so web only                   | Yes, on iOS and web              |
| Cost            | Free in early access. Future price unknown                     | Free tier. Pro is $16 a month                                 | None beyond the agent            |
| Lock-in         | A closed `.pen` format. Desktop only, no collaboration         | Lower: HTML and CSS. Hosted in the tool, in open alpha        | None. Code in the repo           |

The 75-repo design study found the same pattern. Design lives in code and in
agent skills. Figma appears in 0 to 3% of UI PR bodies. The clearest pipelines,
paperclip and lobehub, prototype on the real runtime, so adopting a direction
moves code instead of rewriting it.

## Decision

Clutch adopts neither tool. A proposal stays in the app, on the design system,
and in the repo. Neither canvas renders a project's own React Native
components, so each design made there is throwaway markup that the build must
redo. That redo is where a design drifts from the build, which proposals exist
to prevent.

## Consequences

- The owner judges real screens on a phone, with real states, not a picture of
  them. Visual review screenshots the same code, so the baseline is exact.
- Freehand sketching before any code is harder. An agent writes a rough
  direction in code instead. That is cheap with the design system's components.

If the revisit condition is met, the shape to build: the tool's MCP server goes
in `.mcp.json` for design sessions only. The skill adds one optional step,
"sketch in the tool", before "build the directions". The record and the
in-app prototype stay the source of truth. No build PR reads the tool.

**Revisit if:** a canvas tool renders a project's own design system components,
React Native included, and reads and writes them through MCP. Or the owner asks
for a freehand canvas for 2 proposals in a row.
