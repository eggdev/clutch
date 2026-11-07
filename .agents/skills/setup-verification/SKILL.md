---
name: setup-verification
description: Create or maintain the single committed project-local verify skill, or author a missing verification journey. Use when verification tooling is absent, stale, or lacks proof for a requested behavior. To execute existing flows, use the project's verify skill instead.
---

# Set up verification

Produce one `.agents/skills/verify/SKILL.md` with `name: verify` per repository.
It serves every project surface; select platform and flow inside it. Only this
authoring workflow creates that skill. Delivery executes it rather than inventing
another verify-<app> directory.

## Choose the operation

1. Read agent guidance, the requested outcome, existing verification commands and
   feature map. Recover relevant prior decisions; source behavior is evidence,
   not permission to redefine expected results.
2. Existing verify covers the request: hand execution to it. Do not regenerate.
3. Missing behavior: follow [journey authoring](./references/journey-authoring.md).
4. Existing verify is stale: follow [maintenance](./references/maintenance.md).
5. No verify exists: discover the real surface and generate it below. If an older
   project-specific verification skill exists, migrate its working flows into
   verify and update callers together; do not create a second executor.

Inputs are the repository, acceptance criteria and existing controls. Completion
is committed, discoverable tooling with one executed journey and explicit gaps,
or a precise prerequisite. No deployment, paid service or schedule is authorized.

## Discover from the repository

Identify the real entry point: library API, CLI, service, web or native.
Find startup, readiness, version/build identity, fixtures, driver and cleanup.
For a library use its public API and real storage; no app server is needed.
For isolated test runners let them own their stack. Start an interactive stack
only when the selected journey needs it.

Prefer established project commands. Record occupied ports or foreign resources
as conflicts, never silently adopt or kill them. Check native binary, bundle and
API identity independently. A local lock is not a host-wide simulator lease;
native driving needs the enforced shared lease, not merely a preflight check.

## Generate one executor

Write verify with no placeholder commands. Its frontmatter names the project,
surfaces and triggers. Include:

- Select: acceptance criterion → existing flow → smallest sufficient proof.
- Launch/doctor: exact commands and observable readiness; say when no server exists.
- Drive: real commands/selectors, fixture ownership and side effects.
- Evidence: action, expected/observed outcome, source/build identity and durable path.
- Cleanup: release owned resources on success and failure; explicit human holds
  have a lifetime. Preserve evidence and quarantine uncertain cleanup.
- Limits: unrun surfaces and prerequisites; tests and native proof remain distinct.

Commit the executor, configuration, referenced helpers, feature index and journey
pages with the implementation. Create the Claude symlink when the repo uses that
discovery mechanism. Monorepos still have one verify entry point and named flows.

Reuse an existing maintained lifecycle tool. This repository's shared fallback is
[tools/verification/verify.py](../../../tools/verification/verify.py); its
[configuration](./references/configuration.md) defines the executable contract.
Generated verify must remain usable without this authoring skill. If another
repository needs a helper, commit it under its tools directory with its tests;
never reference a private global path or copy another lifecycle daemon.

## Prove and hand off

Follow the generated instructions cold: select, doctor, execute one real mapped
journey, retain action/result proof, clean up, then check evidence survived.
A description or a zero-test selection is not an executed journey. Exercise a
negative control that the check must catch, then restore it and rerun. Keep
destructive controls in disposable fixtures, not the owner's live data.

Report each flow as passed, failed, prerequisite missing or not run. A draft is
not an operational handoff. Source drift, driver gaps and product regressions are
different findings; do not weaken expectations or change product code during
maintenance unless the owner separately authorized that fix.

Design influences and the boundaries we retained are in
[design sources](./references/design-sources.md). Future upkeep uses this skill's
maintain operation; routine reviews use verify. Do not enable recurring work merely
because the skill exists.
