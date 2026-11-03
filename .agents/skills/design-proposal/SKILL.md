---
name: design-proposal
description: Create, iterate, adopt and retire a design proposal - today's screen next to 2 or 3 directions, built on the project's real components and tokens, rendered in the app at phone and desktop widths, for the owner to pick one. Use before building a new visible feature or a material UI change, when the owner answers a proposal, when the build of an adopted proposal ships, and when gardening lists a stale proposal. Skip it for a routine change.
---

# Design proposals

The owner decides product direction. A proposal is where that judgment goes,
so the owner does not judge each UI PR. An agent builds the options. The owner
picks one. The adopted direction is then the spec that each build PR is checked
against, and its screenshots are the baseline for visual review. So the design
stays true from the prototype to the merge.

Each proposal is one record, `docs/design/proposals/<slug>.md`, plus one
prototype file that renders it in the app. `bun tools/check-proposals.ts`
checks both, in `validate`.

## When to propose

| Change                                                                  | Propose? |
| ----------------------------------------------------------------------- | -------- |
| A new screen, flow or visible feature                                   | Yes      |
| A change to the layout, hierarchy or primary action of a screen         | Yes      |
| A new visual pattern that the design system has no component for        | Yes      |
| A bug fix, a copy fix, a token value, a state an adopted spec describes | No       |
| Work inside an adopted proposal                                         | No: build it |
| Internal refactor with no visible change                                | No       |

When unsure, ask one question: would the owner want to choose between two
versions of this? If not, build it. Proposals are cheap, but the owner's
attention is not.

## Lifecycle

| Status       | Means                                                                 | Prototype file |
| ------------ | --------------------------------------------------------------------- | -------------- |
| `proposed`   | Today plus 2 or 3 directions wait for the owner                       | All directions |
| `adopted`    | The owner chose one. It is the spec for the build PRs                 | Today and the chosen one |
| `current`    | The build shipped. The screen is the design                           | Deleted        |
| `historical` | A later proposal replaced it, or the feature went away                | Deleted        |

## Create

1. **Read the screen.** Read the feature, its screen and the data it shows.
   Note the job the person does there and the one primary action.
2. **Build today.** Render the real screen with sample data, when its
   component takes plain props. Otherwise copy its layout from the same
   components. Today is the baseline, so do not improve it.
3. **Build 2 or 3 directions that differ in kind**: what comes first, how the
   choice is framed, how much the screen holds. Three shades of one layout
   are one direction. Name each in 2 to 4 words. Give each a one-line bet:
   what it makes easier, and what it costs.
4. **Use only the design system.** Import components from the design system,
   and style with the role tokens in
   `docs/contributing/architecture/styling.md`. No raw color, no arbitrary
   value, no one-off component. A direction that needs a new component says
   so in the record. So adoption is "move the code into the feature", not a
   rewrite.
5. **Render it in the app**, in a development-only proposals section of the
   gallery, or a development-only route in a project without one. Show each
   direction in a phone frame (390 px) and a desktop frame (1024 px or the
   full width), labelled with its letter and name. Use realistic sample
   data, including one long value and one empty case. Production builds never
   ship it.
6. **Write the record** from [the record template](./references/record.md).
7. **Take screenshots** of each direction at both widths, and attach them to
   the PR.
8. **Open the proposal PR** on the issue for the work. The prototype is
   development-only code, so it merges like any PR. Merging it does not adopt
   anything.
9. **Ask the owner once**, in the cheapest place they read. See
   [ask the owner](#ask-the-owner).

## Iterate

An answer such as "B, but with the total from C" is still a choice. Change
direction B, keep `proposed`, take new screenshots, and ask again only when the
change is large. A request for a new direction replaces the weakest one, so a
proposal never holds more than 3.

## Adopt

When the owner picks a direction:

1. Set `status: adopted`, `adopted: <letter>`, and `decided: <date>`. Quote
   the answer and link it in the Decision section.
2. Delete the other directions from the prototype. Keep today and the chosen
   one, so the build can compare them.
3. Fill the Spec section: the order of the content, the components, the
   primary action, each state (loading, empty, error, done) and each width.
   Each line is something a reviewer can check on a screenshot.
4. The adopted screenshots are the baseline for visual review. Store them
   where the project's visual review keeps its baselines.
5. File or update the build issues. Each one links the record.

## Build against the spec

Each build PR names the record in its Intent section, such as "Design:
docs/design/proposals/approval.md (adopted B)". It attaches screenshots at the
same widths, and says how they match the Spec. A difference is either a fix
in the PR, or a change to the record in the same PR, with the reason. A
material change, one that the owner would choose differently, goes back to
the owner as a new direction.

## Retire

- **The build shipped.** In the PR that finishes the last build issue, set
  `status: current` and delete the prototype file. `check-proposals` fails
  when a current record still has its prototype.
- **Replaced or dropped.** Set `status: historical` and say why in `retired`,
  such as "replaced by checkout-v2.md". Delete the prototype file.
- **Stale.** Weekly gardening runs `bun tools/check-proposals.ts --stale`. It
  lists a proposal with no choice after 14 days, and an adoption whose issue
  is done. Ask once more, or retire it, or mark it current.

## Ask the owner

Ask in one place, with the screenshots and the letters:

- When the session can write to the owner's daily brief ledger, add one open
  `text` thought to its `thoughts.json`. The title names the screen. The
  thought holds one line per direction and the link to the proposal PR. The
  question is "Which direction: A, B or C? Or say what to change." The answer
  arrives in `answers.json` under the thought's id.
- Otherwise, ask in the proposal PR body, and read the owner's reply there.

Do not ask in both places, and do not ask again before the answer arrives.
Continue other work while it waits.

## Related

- [Research and design](../deliver/references/research-and-design.md) routes
  an unsettled visible interaction here.
- The `emil-prototype` skill, when installed, has craft guidance for building
  the directions and for live controls.
- Visual review compares each UI PR's screenshots with the baseline, and a
  lint rule makes product code use the design system components. Both are
  other issues. This skill supplies the baseline and the spec.
