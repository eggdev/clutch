# Verification setup

Use the committed [verify skill](../../../.agents/skills/verify/SKILL.md) for
Clutch's real commands, flow selection, evidence and cleanup. Only
[setup-verification](../../../.agents/skills/setup-verification/SKILL.md) creates
or maintains that executor. The [skill index](../../../.agents/skills/README.md)
distinguishes delivery, authoring, execution, audit and recap.

## Reach the actual surface

Clutch has two kinds of surface.

- **The starter app.** `apps/web` and `apps/api` run together through
  `mise exec -- bun run dev`. It reuses running servers and prints the
  portless URLs. Open the web URL in a browser to check a screen or a sync
  flow. See [local development](./local-development.md).
- **The template tooling.** The installer CLI, the session-queue library and
  the review helpers. Their tests use real SQLite and disposable subprocesses.
  They need no app server or browser.

The starter has no sign-in flow. Install the Bun dependencies. The review
helpers also need Python 3.11+, Git, `ps` and `pgrep`.

The local gate is `mise exec -- bun run validate`. It includes Python helper
regressions and skill-discovery contracts as well as runtime tests, lint and types.
A green gate while KICKOFF.md exists does not establish that kickoff has closed.

## Journeys

A journey proves one user goal through the real app. Each one lives in the
feature that it proves:

| File                                         | Platform | Runner     |
| -------------------------------------------- | -------- | ---------- |
| `features/<name>/journeys/<id>.pw.ts`        | Web      | Playwright |
| `features/<name>/journeys/<id>.maestro.yaml` | Native   | Maestro    |

The header of each journey follows the
[journey specification](../../../.agents/skills/setup-verification/references/journey-specification.md).
Its first line is `<id>: <user goal>`. It also has `Contract:`, `Entry:` and
`Isolation and cleanup:` lines. An optional `Budget: <n> s` line sets the time
limit. The default is 60 seconds. An optional `Core: <name>` line names the
[core journey](../journeys/core.md) that the journey proves.

Run one journey, or every web journey:

```sh
mise exec -- bun run journey notes-sync
mise exec -- bun run journey --all
```

The runner uses the dev servers that already run. When a server is down, it
starts the missing ones through `tools/dev.ts`. It stops only the servers that
it started. Each web journey runs on a phone, a tablet and a desktop. A
journey that runs past its budget fails. A failed journey runs once more, and
a pass on the retry files a `flake` friction entry. A layout shift, click
budget or axe failure on any try still fails the run. A `Core:` journey also
fails when its run on a device passed but did not record each outcome. That
is `signed-up` first, then every outcome that its catalog section names. Each journey writes its
[measures](../end-to-end-testing.md#measures) to
`test-results/journeys/measures/`. See [core journeys](../journeys/core.md#outcomes)
and [devices](../end-to-end-testing.md#devices).

Each journey is also a verify flow, so `verify.py` runs it and keeps the
evidence:

```sh
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json run notes-sync
```

`check-journeys` rejects these problems:

- A feature with a screen that an app ships, but no journey for that platform.
  This check counts `apps/web` as the web app, and `journeys.webApp` does not
  change it. A native app has the Nx tag `platform:native`.
- A journey header with no goal line, or no `Contract:`, `Entry:` or
  `Isolation and cleanup:` line.
- A journey that `verification.json` does not register, and a flow that runs a
  journey that does not exist.
- A web journey that does not take `test` from `@repo/journeys/testing/test`.
  This includes one that takes the `test` of `@playwright/test` by name, as its
  default export or through a namespace.
- A journey with a `Core:` line that breaks the
  [core journey rules](../journeys/core.md#rules-for-every-core-journey). It
  names no core journey, or opens a URL other than `/` on web or a link on
  native. It loads a seed fixture or a saved session, or never asserts
  `signed-up`. Or it asserts other than through outcomes.

Each web journey also calls `accessible(page, 'where')` from
`@repo/journeys/testing/a11y` after each step that renders a page. It fails on
any axe violation. See
[accessibility checks](../capabilities/a11y-checks.md).

### Screenshots

A web journey calls `snap(page, 'name')` from `@repo/journeys/testing/visual`
at a stable point, the same way it calls `accessible`. A gallery or component
page is a journey that opens each group and snaps it. `snap` captures the page
on the device of the run, in the light and dark schemes. So each journey keeps
a baseline for each device. The phone gives `mobile`, 390 px wide. The tablet
gives `tablet`, 820 px wide, and the desktop gives `desktop`, 1440 px wide. It changes the `dark` class on
`<html>` in place. Then it puts it back, so the journey's next step sees the
page it left.

Each shot is deterministic. Animations are off, the caret is hidden, fonts are
loaded, and `snap` takes shots until two in a row match. The locale is `en-US`
and the time zone UTC. Pass `mask` for a region that changes on each run, such
as a generated name. Pass `style` with CSS that hides a region whose size
changes on each run. An example is a list that grows with the data of earlier
runs.
The CSS applies only to the shot. A layout shift that the snap makes does not
count toward the budget. A screen that shows the time sets the clock first with
`page.clock.setFixedTime`.

The baselines are committed PNG files:

```text
features/<name>/journeys/__screenshots__/<snap>-<mobile|tablet|desktop>-<light|dark>.png
```

CI is the only renderer. Fonts and anti-aliasing differ between machines, so a
local run compares nothing. It writes every shot to `test-results/visual/` for
you to look at. `snap` compares when `GITHUB_ACTIONS` is `true`, or when you set
`VISUAL_COMPARE=1`, such as on a machine that renders like CI. It does not read
`CI`, which `validate` sets on a laptop too. In CI, `snap` compares each shot with its baseline, allowing
0.1% of the pixels to differ. A missing or changed baseline fails the
`journeys` check. A screenshot that changes on the same code goes in the
[flaky-test quarantine](../testing.md#flaky-tests) by its snap name. It then
warns instead of failing, until its issue fixes it. The job uploads each changed or new shot, at its baseline
path, as the `visual-screenshots` artifact.

To change a screen on purpose:

1. Push the change. The `journeys` check fails on the screenshots that moved.
2. Run `mise exec -- bun run visual pull <pr>`. It downloads the artifact of
   the PR's latest CI run and writes the changed and new shots into the
   baselines.
3. Look at each PNG, commit them, and say in the PR body what changed on screen
   and why.

To seed a baseline from a design, copy its PNG to the baseline path. CI
confirms it, or fails and uploads the real shot.

The `feature` generator writes a draft journey and its flow. Replace the draft
goal with the real one before the feature ships.

### Where journeys run

Journeys need a browser and the dev servers, so `validate` does not run them.
They run in these places:

- The pre-push hook runs the `journeys` target when a push changes code.
- CI runs `bun run journey --all` in the `journeys` job. The job caches
  Chromium for each Playwright version.

A web journey runs against the web app. `journeys.webApp` in `clutch.yaml`
names it, as `apps/app`. Without the key, it is the one app under `apps/` with
an Nx `dev` target, not tagged `platform:server` or `platform:native`. Several
such apps without the key fail the run.

When no web journey exists, `--all` exits 0 and says so: a `No journey ran`
warning in the run, and a line in the step summary. The check passes so a
project before its first journey can merge, but it tests nothing.

`--production <url>` runs only the core journeys, against that URL. `tools/deploy.ts`
calls it after each deploy. With no core journey it fails, since production then
has no proof.

A web journey shares the dev database. It writes records with unique names, so
runs do not collide. Delete `.data/` to reset the dev database.

A native journey runs only through the device host, with
`mise exec -- bun run journey --native <ios|android>`. See
[native journeys](../end-to-end-testing.md#native-journeys). `verify.py`
refuses a native flow.

## Proof and limits

Record criterion, source before/after, expected/observed outcome, actual command
and retained receipt. A changed source identity invalidates success. Native app
build, served bundle and backend identity need their adapter checks independently.

Tests establish session transitions and helper behavior. They do not establish
physical device cleanup, T3 attachment, a driver-enforced lease, a remote archive,
webhook authentication or a running gardening workflow. The fallback refuses
native-labelled execution until that integration exists.

Ordinary review resources are released. A live session needs an explicit request
and bounded lifetime; evidence survives cleanup. Unknown ownership or failed
cleanup is a prerequisite requiring investigation, never permission to kill a
foreign process or report a pass.

## Maintenance

Use setup-verification's maintain operation for drift in the executor or feature
map. A missing proof extends an existing journey before creating another.
Product regressions are findings for delivery; changing the expected result to
make a journey pass is not verification maintenance.
