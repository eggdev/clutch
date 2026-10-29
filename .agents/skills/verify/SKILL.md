---
name: verify
description: Execute Clutch's installer, SQLite session-queue, review-tool and web app journeys with real subprocesses, retained transcripts and owned cleanup. Use for verifying changes in this repository; use setup-verification to add or maintain journeys.
---

# Verify Clutch

<!-- generated-by: setup-verification -->

This executor was authored through setup-verification. It is committed with its
configuration and feature map; the runner lives in tools and works without the
authoring skill. The tooling flows need no service, browser or sign-in. Web
journeys need Chromium and the dev servers; no simulator or account sign-in is
needed.

## Select

Read [features](./features/README.md). Changes to the queue use session-queue;
changes to skill helpers use review-tools; installer changes use installer.
Changes to a feature, its packages or the web app use that feature's journeys,
such as notes-sync. Run each affected suite once.
For a missing assertion invoke setup-verification's authoring operation, then
return here. Do not create another verify skill or run an unrelated passing flow.

## Launch and doctor

From the repository root, with dependencies already installed:

```sh
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json doctor
```

Doctor checks Git identity, pinned Bun/SQLite availability and Python. Missing
dependencies are prerequisites; do not install or start a machine service as a
verification side effect. Tests create and dispose their own temporary runtimes.
A journey flow reuses running dev servers. When one is down, the journey runner
starts the missing ones through `tools/dev.ts` and stops only those. Missing
Chromium is a prerequisite: `bunx playwright install chromium`.

## Drive and retain proof

```sh
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json run session-queue
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json run review-tools
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json run installer
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json run notes-sync
mise exec -- bun run validate
```

Run only the selected flows, then the gate for delivery. The flow commands
print compact JSON naming retained command transcripts and receipts outside the
repository. DELIVERY_EVIDENCE_ROOT selects a durable output directory. A passed
flow proves its named assertions; the gate is not native or deployed-app proof.

## Cleanup and limits

The runner checks process identity and cleans its command groups. The tests own
and remove their disposable SQLite files and fixture processes; evidence remains.
Success requires a stable source fingerprint before/after execution. Expected
verification state is excluded; do not exclude product source to hide drift.
Graceful interruption finalizes a failed receipt. After abrupt loss, stop
reconciles persisted command ownership; uncertain cleanup fails closed.

```sh
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json stop
```

No real native flow, broker/T3 driver lease, cloud archive or gardening schedule
is implemented. The fallback refuses native-labelled flows because a per-checkout
lock cannot enforce the required host-wide lease. Logs here are local-only;
remote evidence sharing is not verified. Report these as prerequisites, not passes.
