# End-to-end testing

End-to-end tests drive the real app through its user-facing entry point:
browser, native app or CLI. A journey is one end-to-end test. See
[journeys](./setup/verification.md#journeys) for the files, the runner and the
check. The locator guidance below applies to browser journeys. Native journeys
use Maestro.

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

## Server health and retries

- Before each test, probe the server health route. When the server is dead,
  fail at once with a named error. Do not spend retries on a refused
  connection.
- The runner runs a failed journey once more. A journey that passes on the
  retry passes the check. The runner then files a `flake` friction entry that
  names the journey and the platform, and CI shows a warning.
- The retry covers a crash, a timeout or an assertion that throws. It does not
  cover a measured budget. A layout shift, a click budget or an axe failure on
  any try fails the check, also when the retry passes.
- Fix a flaky journey. Do not make it wait longer, and do not add retries.

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

A failure of one of these budgets on any try fails the run. The retry does not
cover it. The measures file names the kind of each failure.

The runner does not check `timeToValue` yet. Each outcome records its time
from the start of the test, so a later tool can check it.

A larger budget is the owner's decision. See
[proof gates code](../principles/proof-gates-code.md#the-owner-decides).

## Measures

Each journey writes one JSON file, which the council review reads:

- `test-results/journeys/measures/<id>.json` for a web journey
- `test-results/journeys/measures/<id>.<ios|android>.json` for a native journey

The file has a run for each device. Each run has its result, `passed`,
`failed` or `flaky`, and each try. A web try has these measures:

| Field                   | What it holds                                          |
| ----------------------- | ------------------------------------------------------ |
| `layoutShift`           | The largest window, its page and the elements it moved |
| `shifts`                | Each layout shift with no recent input                 |
| `clicks`, `keys`        | Each activation, and each key press                    |
| `steps`                 | What a click budget counts                             |
| `clickBudget`           | The budget, the steps it counted, and where it starts  |
| `outcomes`              | Each outcome, its `elapsedMs`, and the clicks and keys |
| `axe`                   | Each axe run, with each violation and its impact       |
| `failure`               | The kind and the message of what failed the try        |
| `durationMs`, `budgets` | The time of the try, and the budgets that it used      |

The `failure` kind is `layout-shift`, `click-budget` or `axe` for a measured
budget. It is `timeout`, `assertion` or `crash` for a failure that the retry
covers. A device run that failed a measured budget also has `budgetFailure`,
with the try that failed it.

A native try has only its result and its time. CI keeps the files as the
`journey-measures-web`, `journey-measures-ios` and `journey-measures-android`
artifacts.

## Native journeys

Each native journey runs with Maestro on the booted device of the device host:

```sh
mise exec -- bun run journey --native ios
```

CI runs it on an iPhone 16 simulator on a `macos-15` runner. It also runs it
on a Pixel 7 emulator with API 35, on an `ubuntu` runner with KVM. Each job has a limit of
25 minutes. `DEVICE_HOST=ci` finds the device that the job booted. A native
run with no native journey fails, because CI starts a native job only when the
repository has a native app.

A known limit: a native lane records only the result and the time of each try.
It does not measure a layout shift, clicks or axe. The device host also does
not record outcomes yet. So the budgets on this page hold on web only.

The native jobs run on a PR that reaches native, and on each push to `main`.
`tools/journeys/reach.ts` is the one place that states the reach rule:

- Every change reaches web.
- A change reaches native when it touches a native app, a native journey,
  `tools/native/`, a shared runtime package or a sensitive path.
- A shared runtime package is a `type:package` package, or a feature that a
  native app depends on.
- A sensitive path is a file with the tier `one-way-door` in
  `.clutch/risk.yaml`.

A repository with no native app runs no native job. A project with a native
app fills the build step of each native job in `.github/workflows/ci.yml`.
Until it does, that step fails.

<!-- kickoff: The build step of the native-ios and native-android jobs: how CI builds the app for the simulator and the emulator, and installs it. -->

<!-- kickoff: The end-to-end runner for each selected platform, the command to run the suite and one file, the health route, and the infrastructure failures that CI may retry. -->
