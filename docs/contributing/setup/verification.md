# Verification setup

Use the committed [verify skill](../../../.agents/skills/verify/SKILL.md) for
Project Template's real commands, flow selection, evidence and cleanup. Only
[setup-verification](../../../.agents/skills/setup-verification/SKILL.md) creates
or maintains that executor. The [skill index](../../../.agents/skills/README.md)
distinguishes delivery, authoring, execution, audit and recap.

## Reach the actual surface

Project Template exposes the template installer CLI, a session-queue library and review helpers.
The mapped tests use real SQLite and disposable subprocesses. There is no app
server, authentication flow or browser preview to launch for those assertions.
Bun dependencies must be installed; Python 3.11+, Git, ps and pgrep are required.

The local gate is `mise exec -- bun run validate`. It includes Python helper
regressions and skill-discovery contracts as well as runtime tests, lint and types.
A green gate while KICKOFF.md exists does not establish that kickoff has closed.

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
