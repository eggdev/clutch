# End-to-end testing

End-to-end tests drive the real app through its user-facing entry point:
browser, native app or CLI. A journey is one end-to-end test. See
[journeys](./setup/verification.md#journeys) for the files, the runner and the
check. The locator guidance below applies to browser journeys. Native journeys
use the Maestro flow format.

## What to test

- Each [hard invariant](./project-intent.md#hard-invariants) has one journey.
  Project intent lists them.
- Add a journey only when the flow is user-critical and a faster test cannot
  cover it.
- Prefer one broad journey over many narrow regression tests. Do not add a
  journey to lock in a bug fix that is unlikely to come back.
- Do not test styling, implementation details or utility functions here.

## Structure

- Flat `test(...)`. Inline the setup. No `describe` and no shared `beforeEach`.
- Write each test like a manual tester's script: one setup, then each action
  and assertion of the journey.
- Do not split one journey into small tests to isolate each assertion.

## Locators

- `getByRole` for buttons, links, headings and inputs.
- `getByLabel` for form fields.
- `getByText` only for short, stable copy.
- A CSS locator only when no accessible locator exists.

## Assertions

- Assert what the user sees: a message, a redirect, a visible element.
- Wait for the UI result. Never wait for a fixed time.
- Assert the important states between steps inside the same journey. Do not
  write separate tests for a loading state or a transition.
- Use real input values. Keep credentials and email addresses fake and local.

## Server health and no retry

- Before each test, probe the server health route. When the server is dead,
  fail at once with a named error.
- A journey runs once on each device, with no retry. A failed run fails the
  check, so one commit gets one verdict.
- A crash, a timeout, an assertion, a layout shift, a click budget and an axe
  failure each fail the check.
- Fix a flaky journey. Do not make it wait longer, and do not add retries.
  The [flake hunt](#flake-hunt) counts how often each journey fails.

## Flake hunt

A journey that fails at random can pass one PR and fail the next. The
`journeys` job of the nightly [flake hunt](../../.github/workflows/flake-hunt.yml)
shows it. It runs `bun tools/journeys/run.ts --hunt 20`: each web journey runs
20 times on each device, with no retry.

- The step summary has a table with one row for each journey and one column for
  each device. A cell such as `2 of 20` counts the first runs that failed.
  `no run` means the journey did not run on that device.
- A journey that failed a run gets a warning in the run. A journey that did not
  run on a device gets another one.
- The job passes when a journey fails, because it only measures. It fails when
  it measured nothing for a journey. That is the case when Playwright wrote no
  report, when a journey file did not load, and when a journey ran on no device.
- It quarantines no journey, files no friction entry, writes no measures file
  and opens no PR. It never blocks a PR.
- The job has a limit of 45 minutes, and Playwright writes the report at the
  end. A hunt that passes the limit leaves no table. Lower the count or raise
  the limit when the journeys grow.
- The report and the trace of each failed run are in the `journey-hunt-traces`
  artifact for 14 days.
- When the hunt names a journey, file one issue for it with the cause. File an
  issue that gives more journeys the clock only when the cause is timing.
- The blocking `journeys` check has no retry either, so a failed run there
  fails the PR.
- Run it locally with a smaller count: `mise exec -- bun run journey --hunt 3`.

The same workflow has a `claims` job. It proves the contract claims of each
package with a new seed each night. Unlike the `journeys` job, it fails when
a claim breaks. See [Claims](./architecture/contract.md#claims).

## Devices

Each web journey runs on three devices, on every PR. They are the three
widths of [mobile first](../principles/mobile-first.md#three-widths).

| Device  | Viewport   | Emulation                                     | Screenshot name |
| ------- | ---------- | --------------------------------------------- | --------------- |
| Phone   | 390 × 844  | Touch, a 3x screen, a Chrome on Android agent | `mobile`        |
| Tablet  | 820 × 1180 | Touch, a 2x screen, a Chrome on Android agent | `tablet`        |
| Desktop | 1440 × 900 | Desktop Chrome                                | `desktop`       |

`webDevices` in `tools/journeys/journeys.ts` names them. The Playwright config
makes one project for each one. A journey takes `test` from
`@repo/journeys/testing/test`, which measures each run:

```ts
import { expect } from '@playwright/test';
import { test } from '@repo/journeys/testing/test';
```

`check-journeys` fails a web journey that does not take `test` from
`@repo/journeys/testing/test`. It also fails one that takes the `test` of
`@playwright/test` by name, as its default export or through a namespace.

## Budgets

The journey test holds each run to the budgets in `budgets:` of `clutch.yaml`.
The [core journey catalog](./journeys/core.md#budgets) names them.

- **Layout shift.** The test counts each layout shift that comes with no user
  input in the last 500 ms. It takes the largest session window, as Chrome
  does. A run at or over `budgets.layoutShift` fails, and names the elements
  that moved. The default is 0.01.
  The check compares the value before it rounds it. It rounds only the value
  in the message.
- **Clicks.** The test counts each activation. That is each click or tap,
  and each key that clicks a control, such as Space or Enter on a button. A
  choice in a `<select>` also counts. Enter that sends a form with no submit button also
  counts. A press and hold or a drag that activates nothing does not count.
  Typing counts as keys only. At the outcome where the budget of a core
  journey ends, a run over its budget in `budgets.clicks` fails. The default
  for sign-up is 3.
- **Accessibility.** `accessible(page, 'where')` runs axe, and fails on any
  violation, `minor` included. `outcome()` runs axe after each outcome holds,
  and the test runs it once more on the last page.

A failure of one of these budgets fails the run. The measures file names the
kind of each failure.

The runner does not check `timeToValue` yet. Each outcome records its time
from the start of the test, so a later tool can check it.

A larger budget is the owner's decision. See
[proof gates code](../principles/proof-gates-code.md#the-owner-decides).

## Measures

Each journey writes one JSON file, which the council review reads:

- `test-results/journeys/measures/<id>.json` for a web journey
- `test-results/journeys/measures/<id>.<ios|android>.json` for a native journey

The file has a run for each device. Each run has its result, `passed` or
`failed`, and its try. A web try has these measures:

| Field                   | What it holds                                                               |
| ----------------------- | --------------------------------------------------------------------------- |
| `layoutShift`           | The largest window, its page and the elements it moved                      |
| `shifts`                | Each layout shift with no recent input                                      |
| `clicks`, `keys`        | Each activation, and each key press                                         |
| `steps`                 | What a click budget counts                                                  |
| `clickBudget`           | The budget, the steps it counted, and where it starts                       |
| `outcomes`              | Each outcome, its `elapsedMs`, and the clicks and keys                      |
| `axe`                   | Each axe run, with each violation and its impact                            |
| `failure`               | The kind and the message of what failed the try                             |
| `screen`                | The layout problems of the last page, as shown and at the largest text size |
| `durationMs`, `budgets` | The time of the try, and the budgets that it used                           |

The `failure` kind is `layout-shift`, `click-budget` or `axe` for a measured
budget. It is `timeout`, `assertion` or `crash` for any other failure. A device
run that failed a measured budget also has `budgetFailure`, with its kind and
its message.

The measures read the top document only. A click or a layout shift inside an
iframe, such as a payment or captcha frame, is not counted. A native try has only its result and its time. CI keeps the web files as the
`journey-measures-web` artifact.

## Agent and pool

A journey reads what the app stores and calls what the app serves. It adds no hook to the app.
Four helpers in `@repo/journeys/testing` do that:

- `poolState(page)` reads the object pool that the page keeps in IndexedDB. It returns `undefined` when the pool is missing, and it never creates one.
- `records(page, 'Note')` returns the records of one model in that pool.
- `settled(page)` waits until each command that the page ran has its answer from the server.
- `callTool(page, 'notes_create', input)` calls an agent tool as the organization of the page. It posts a JSON-RPC `tools/call` to `/mcp`, and it throws with the code and the reason when the tool refuses.

A journey does not need the name of the page's database. `poolState` reads the
one database that has the stores `records` and `transactions`. See
[the pool helper](../../packages/journeys/testing/pool.ts).

The [notes journey](../../features/notes/journeys/notes-sync.journey.ts) uses all four.

## Screen findings

The journey test checks the last page of each passed try for layout problems that a person sees.
`screenProblems` reports each one as a sentence. A page that scrolls sideways is one. A box that clips its text is another, and so is a visible text past the right edge of the window.
`atLargestText` runs the same check with the root font size at 200%, which is what a person with the largest text setting sees.

The test records both lists in the measures, under `screen`. A finding never fails a try.
`bun run verify` prints each finding. See [verify report](./setup/verification.md#verify-report).

## Data journeys

A data journey is one file, `features/<feature>/journeys/<id>.journey.ts`. It
calls `journey(title, steps)` from `@repo/journeys/testing/journey`, and its
steps come from the builders in `@repo/journeys/testing/steps`. The web run
registers it as a Playwright test. The native run compiles it to a Maestro
flow, so one journey runs on both platforms.

`tool(declared, input)` takes a command declaration, such as `createNote` in `packages/notes/contract/notes.ts`. `holds(record, field, values)` takes a record declaration, such as `noteRecord`. Each builder reads the names and the types from the contract, so a rename or a wrong field fails the type check. A command with `tool: 'none'` throws when the journey file loads.

Each step is data. `open`, `tap`, `fill`, `submit`, `see`, `gone`, `offline`,
`shot`, `tool`, `serverHolds` and `outcome` have a native form. `settled`, `holds`, `accessible`,
`advance` and a step on the second device have none. Mark such a step with `webOnly(...)`,
and the native compile leaves it out. A step with no native form and no mark
fails the compile, and the error names the step. A flow whose last `tap`, `fill`, `submit` or `tool` has no check after it on
the device fails too. A check is `see`, `gone` or `outcome`, and a flow with
none proves nothing about the act. The compile is `toMaestro` in
`tools/journeys/maestro.ts`. `tools/journeys/native.test.ts` runs it on a fake
device host.

A journey never sleeps. A step may wait for a target, with a limit, and
`settled()` waits until no command of the device waits for the server.
`advance(ms)` moves the clock of the device forward and fires each timer that
comes due, such as a delay of the screen. A journey with an `advance` step
owns the clock of each device, and `packages/journeys/testing/journey.ts`
installs it before the first page loads. Any other journey runs on real time.
Its network is real, and a clock that jumps fires the timers of a retry before
the answer can come.
`packages/journeys/testing/journey.browser.test.ts` proves the step in a real
Chromium: it moves the clock past a timer of one minute.

The native run writes the flow to `test-results/journeys/native/<id>.maestro.yaml`
and runs it on the opened device in parts. See [native journeys](#native-journeys).
It records each outcome with the taps and submits before it. A core journey whose outcome goes over the click budget fails,
with the rule of the web run in `@repo/journeys/types/budget`. The app ID comes
from `expo.ios.bundleIdentifier` or `expo.android.package` in the app's `app.json`.

A `tap`, `fill`, `see` or `gone` on a `fieldWith` target compiles to a script
step that calls the `device` object, such as
`evalScript: ${device.wait("label=\"Note title\" value=\"Milk\"", 10000)}`.
A `text` selector of a flow matches the label of a field, never its value. So
no flow step finds a field by its value. The native commands of `agent-device`
read `label="…" value="…"`. `device.wait`, `device.gone`, `device.fill` and
`device.press` call `agent-device wait`, `wait absent`, `fill` and `press`. A
`submit` stays `pressKey: Enter`.

The native flow does not prove what it leaves out. It runs the first device
only. It does not run axe or check the object pool. Read the
`Limits:` line of the journey header for the steps that it skips. A core journey
stays in the script form, and `tools/check-journeys.ts` rejects a `Core:` line in
a `.journey.ts` file.

A PR that loses a step other than a `tap`, `fill` or `submit`, or moves one
into `webOnly`, waits for the owner. See [proof gates code](../principles/proof-gates-code.md#proof-decides-the-rest).

## Native journeys

Each native journey runs on the device that the caller opened from the
[device pool](./setup/native.md#the-device-pool), through `agent-device`. The
Maestro command line tool is not needed. A leased device has no app, so install
the build first. [Native journeys](./setup/native.md#native-journeys) gives the
order:

```sh
AGENT_DEVICE=<path> mise exec -- bun run native:build --platform ios --install
AGENT_DEVICE=<path> mise exec -- bun run journey --native ios
```

No CI job runs a native journey for now. An agent runs one from its session,
on a device of the shared pool. CL-596 adds a native check to local CI. A
native run with no native journey fails.

A journey in data form compiles to a Maestro flow. The first launch of a flow
clears the state of the app. Each launch passes two launch arguments.
`devOrganization` gives the run an organization of its own. The app sends it on
the sync socket, on iOS only. See `apps/app/lib/server.native.ts`.
`RCT_jsLocation` tells a debug build where its dev server is. The flow writes
each name with a leading `-`, such as `-devOrganization`. `agent-device` passes
each name to the app as it is, and iOS reads an argument as `-name value`.

The runner drives the build that is on the device, so the device must have the
build of the sources. `native:build --install` records the fingerprint of the
build that it installs on the opened device. The runner compares that record
with the native fingerprint of the app now. When the device has no record, or a
record of another fingerprint, the runner runs no flow and names the install
command. The runner then checks that each dev server answers on this machine,
and links the dev servers to the build machine. See
[the dev server link](./setup/native.md#the-dev-server-link).

The `agent-device` daemon is on the pool machine. It refuses each script step of
a flow that it gets over the network, and a screenshot that it takes stays
there. So the runner cuts each flow into parts at each top-level `evalScript`
and `takeScreenshot` step, and runs the parts in order:

- Each stretch of device steps goes to the device as one flow file, with
  `agent-device replay --maestro`.
- Each `evalScript` step runs on this machine. The script gets `http.post`,
  `json`, `output` and the `device` object.
- Each `takeScreenshot` step saves the screen on this machine, with
  `agent-device screenshot`.

The first part that fails stops the journey. A script or screenshot step inside
another step, a `runFlow` of another file and a `runScript` step are refused
before the device gets a step. A value such as `${output.held36}` in a device
step gets its value on this machine, before the device gets the step. The cut is
`flowOf` in `tools/journeys/flow-parts.ts`.

Each journey writes its evidence to `test-results/journeys/native/<id>/`. The
runner removes the folder at the start of the journey.

| File               | What it holds                                                     |
| ------------------ | ----------------------------------------------------------------- |
| `output.txt`       | The output of each part, in order.                                |
| `parts/`           | The flow file of each stretch of device steps, by its first step. |
| `<name>.png`       | The screenshot of each `takeScreenshot` step.                     |
| `final-screen.png` | The screen after the last part, or after the part that failed.    |

A step with no native form carries `webOnly(step, reason)`. The compiler
refuses a web-only step with no reason, and a flow with no `see`, `gone` or
`outcome` step. The run prints the reason of each step that it leaves out.
`tools/journeys/maestro.test.ts` holds both rules.

`serverHolds(load, id, field, values)` asks the list tool of a load function what
the server holds for one group. It has the same form on web and on a device, and
it asks again for a short time. On a device, a `see` after a `fill` matches the
text that the flow typed. So `serverHolds` is the proof that the write left the
device.

A `tool` step calls `/mcp` on the API as the organization of the run. The runner
makes that call and the call of `serverHolds` on this machine, not on the
device. So the write comes from outside the app. The `see` after it proves that
the write reached the device through the server. A refusal of the tool fails the
journey. `tools/journeys/native.test.ts` runs the runner on a fake device host.

An `offline` step is left out of an iOS flow. The run prints one sentence that
says so, because a simulator shares the network of its host. The app loads
plain HTTP only from `localhost` and its subdomains, as set in
`apps/app/app.json`.

A known limit: a native run records only the result and the time of each try.
It does not measure a layout shift, clicks or axe. The device host also does
not record outcomes yet. So the budgets on this page hold on web only.

`tools/journeys/reach.ts` is the one place that states the reach rule. It
names the platforms that a change reaches:

- Every change reaches web.
- A change reaches native when it touches a native app, a native journey,
  `tools/native/` or a shared runtime package.
- A shared runtime package is a `type:package` package, or a feature that a
  native app depends on.
- A sensitive path alone reaches web only. A sensitive path is a file with the
  tier `one-way-door` in `.clutch/risk.yaml`.

A platform counts only when a native app declares that platform's app ID. The
ID is `expo.ios.bundleIdentifier` for iOS, or `expo.android.package` for
Android, in app.json. The template declares iOS only. A project that ships
Android adds its package.

<!-- kickoff: The end-to-end runner for each selected platform, the command to run the suite and one file, the health route, and the infrastructure failures that CI may retry. -->
