# Configure a repository and Linear webhook

Register one route per repository with `intake.py route --file ROUTE.json`.
Keep its Linear team and state UUIDs from the connected workspace; display
names are not stable identifiers. A route has:

```json
{
  "id": "myapp",
  "repository": "/absolute/path/to/myapp",
  "hostProjectId": "host-project-id",
  "integrationRef": "origin/main",
  "teamId": "linear-team-uuid",
  "projectId": null,
  "states": {
    "todo": "state-uuid",
    "active": "state-uuid",
    "review": "state-uuid",
    "blocked": "state-uuid",
    "done": "state-uuid"
  },
  "destination": "pr",
  "verificationSkill": ".agents/skills/verify/SKILL.md",
  "requiredReview": "bugbot"
}
```

Set `projectId` when a team serves several repositories. Only one team-wide
route is allowed for a team; it cannot coexist with project-specific routes.
The first implementation accepts `destination: pr` only. Future merge/release
support must add its gates before changing that contract.

Registration and dispatch both validate this execution contract. A persisted
route without integrationRef or with an older verification skill is not ready
for dispatch. Inspect and reconcile its pending work before registering the
corrected route; this skill does not rewrite existing routes automatically.

Use `--store PATH` before the subcommand for isolated tests. The default is
`~/.local/share/delivery/linear.sqlite3`. Route files contain no credentials.

## Normalized live snapshot

Fetch the actual Linear issue, including its UUID, team, state, project and
blocking relations. Write a local JSON file with `id` (UUID, not N-123),
`teamId`, `projectId`, `stateId`, `archivedAt`, and `blockedBy` (UUIDs of unmet
blocking issues only). Resolve each blocking issue's current completed state.
Do not omit blocker resolution to force dispatch. The script compares this
snapshot with the event; it never calls Linear with a hidden token.

Commands:

```sh
python3 .agents/skills/deliver-linear/scripts/intake.py enqueue --event event.json --issue issue.json --delivery DELIVERY_UUID
python3 .agents/skills/deliver-linear/scripts/intake.py next ROUTE_ID
python3 .agents/skills/deliver-linear/scripts/intake.py reserve RUN_ID --issue issue.json
python3 .agents/skills/deliver-linear/scripts/intake.py resume RUN_ID --issue issue.json
python3 .agents/skills/deliver-linear/scripts/intake.py record RUN_ID --generation GENERATION --thread THREAD_ID --task TASK_ID
python3 .agents/skills/deliver-linear/scripts/intake.py finish RUN_ID review --generation GENERATION --pr PR_URL --head SHA --evidence EVIDENCE_PATH
python3 .agents/skills/deliver-linear/scripts/intake.py show RUN_ID
```

`enqueue` also supports a `create` event directly into Todo. Updates must carry
a changed `updatedFrom.stateId`. Replayed delivery IDs and repeated transitions
are ignored. Repository slots serialize work while fixed ports, simulators and
shared caches make parallel verification unsafe. Claims survive restarts.
Signature and timestamp checks happen at the host's HTTP receipt, before agent
queueing. The helper does not reapply a one-minute wall-clock window after an
agent startup delay; it rechecks the current issue state and replay receipts.

For a completed worker with review findings, `resume` validates the live issue,
archives prior receipts and reacquires the repository slot. Use the returned
generation in `clientRequestId`, such as `linear-RUN_ID-GENERATION`, so a new
fix round is distinct from retrying the same dispatch. If busy, the run remains
queued for `next` and `reserve`; its resume flag preserves the allowed review
state. Never use resume to replace a still-working child.
Every `record` and `finish` carries that generation. Stale worker completions
cannot overwrite new receipts or release a resumed worker's repository slot.

## T3 webhook

Create a **disabled** webhook task in the route's T3 project. The task prompt
names the repository-local `deliver-linear` skill, the configured route and
`{{headers.linear-delivery}}` plus `{{body}}` as untrusted data. Scope filters
to Issue update/create, team UUID and Todo status UUID. Set the replay key to
`{{headers.linear-delivery}}`; do not coalesce state transitions, since the
latest event can otherwise erase an earlier Todo transition.

If no public `webhookUrl` is returned, enable T3 Connect remote access first.
Never give Linear an internal path or claim a local endpoint is publicly reachable.

Register the public URL in Linear for **Issue** events on the configured team.
Linear's webhook details expose its signing secret. Use T3's `request_secret`
private card, then save the one-use `secretRef` in the webhook signature:
header `linear-signature`, HMAC-SHA256, hex encoding, empty prefix. Set delivery
freshness to one minute and keep the task disabled until the signature is set.
Never accept unsigned production delivery or put the secret in code or chat.

Enable after checking route, status filters and signature configuration. Test
with a dedicated issue: enter Todo, confirm one execution, replay delivery and
confirm no duplicate, cancel before dispatch and confirm no worker. Status
changes written by the worker must not re-trigger delivery.

The coordinator executes in the route's project. With T3, use isolated delegated
tasks there; a webhook for another project starts its run in that project.
Retain task IDs and PR watcher state. Do not add an independent polling daemon.

Linear signing and event documentation:
https://linear.app/developers/webhooks
