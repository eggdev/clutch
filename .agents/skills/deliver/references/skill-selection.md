# Select a skill for the current stage

Discover installed skills through the host's catalog and repository skill
folders. Read the selected skill's actual `SKILL.md` and its required
references. Names below are discovery keys, not bundled dependencies or paths
on the author's machine. Do not copy a global skill library into the project.

Respect each skill's invocation policy. An explicit-only interview or router
is used when the owner requests it. The routing below works without that
router. If a skill is missing, state that fact, follow the project guidance
and perform the underlying work with available tools. If the owner explicitly
requires a missing skill, report the missing prerequisite before that pass.

## Decide what to build

- The owner requests a product interview, viability check or scope challenge:
  `emil-product-thinking`. Keep its one-question-at-a-time interview inside
  that discussion. Never start the interview merely because a feature exists.
- The owner wants alternatives and the design is unsettled: `emil-prototype`.
  Preserve the selected direction and rejected alternatives in the task.
- A reference already settles the interactions: build against it. Do not
  reopen exploration or demand customer research for a settled product choice.

## Build the chosen direction

| Work in front of you | Skill to read |
| --- | --- |
| New screen or structural layout change | `emil-design-foundations` |
| Forms, validation, submission and recovery | `emil-forms-and-inputs` |
| Reusable React component API | `emil-component-design` |
| Text hierarchy, wrapping or font loading | `emil-typography` |
| Palette or contrast decisions | `emil-color` |
| Surface depth, borders or dark surfaces | `emil-surfaces` |
| Marketing, blog or documentation surface | `emil-marketing-pages` |
| Motion and transitions | `emil-animations` |
| Touch, focus, keyboard or screen-reader interaction | `emil-touch-and-accessibility` |
| Web interface behaving poorly on a phone | `emil-mobile-native` |
| Measured latency, rendering or scrolling problem | `emil-performance` |
| Working layout with unfinished interaction details | `emil-ui-polish` |

Read foundation guidance before polishing a new layout, because polish on a
discarded structure creates rework. Use the project's native framework and
platform docs for native navigation, gestures and device APIs. The web-focused
`emil-mobile-native` skill is not a native simulator or a React Native manual.

## Review and finish

- UI diff complete: `emil-ui-review`. It reports findings; return to delivery
  to fix confirmed defects and rerun the affected checks. Its report is not
  the task's finish line.
- Code cleanup is in scope, or generated scaffolding obscures the change:
  `emil-unslop-code`. Preserve behavior and the project's existing conventions.
- User-facing prose or documentation changed: `emil-unslop-writing`.
- Application release, launch or demo: `emil-prep-for-prod`. Honor its device
  and human checks; a "Ship" verdict does not authorize publishing.
- Writing or revising an agent skill: `emil-writing-skills`. Test its decision
  procedure on a realistic task, not just its frontmatter.
- The owner asks which Emil skill fits: `emil-ask-emil` selects one or two.

These skills do not establish backend correctness. Use project tests and real
runtime exercises for storage, authorization, sync, jobs and external services.
Never substitute a craft review for acceptance evidence.
