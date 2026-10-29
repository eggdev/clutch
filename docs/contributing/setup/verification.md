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
limit. The default is 60 seconds.

Run one journey, or every web journey:

```sh
mise exec -- bun run journey notes-sync
mise exec -- bun run journey --all
```

The runner uses the dev servers that already run. When a server is down, it
starts the missing ones through `tools/dev.ts`. It stops only the servers that
it started. A journey that runs past its budget fails.

Each journey is also a verify flow, so `verify.py` runs it and keeps the
evidence:

```sh
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json run notes-sync
```

`check-journeys` rejects these problems:

- A feature with a screen that an app ships, but no journey for that platform.
  The web app is `apps/web`. A native app has the Nx tag `platform:native`.
- A journey header with no goal line, or no `Contract:`, `Entry:` or
  `Isolation and cleanup:` line.
- A journey that `verification.json` does not register, and a flow that runs a
  journey that does not exist.

The `feature` generator writes a draft journey and its flow. Replace the draft
goal with the real one before the feature ships.

### Where journeys run

Journeys need a browser and the dev servers, so `validate` does not run them.
They run in these places:

- The pre-push hook runs the `journeys` target when a push changes code.
- CI runs `bun run journey --all` in the `journeys` job. The job caches
  Chromium for each Playwright version.

A web journey shares the dev database. It writes records with unique names, so
runs do not collide. Delete `.data/` to reset the dev database.

A native journey runs only through the device host. The runner refuses a
`.maestro.yaml` file, and `verify.py` refuses a native flow.

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
