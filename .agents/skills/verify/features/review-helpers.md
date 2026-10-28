# Review helpers

Entry: tools/verification/test_verify.py and
.agents/skills/deliver-linear/scripts/test_intake.py through run review-tools.

Actor: agent using disposable repositories, commands, receipts and issue snapshots.
No Linear request, real driver or cloud write is made. Required runtime:
Python 3.11+, Git and POSIX process tools ps/pgrep.

Run successful and failing flows, resist graceful termination in a descendant,
interrupt the runner, and reconcile persisted command ownership after force loss.
Expect no live fixture process after verified cleanup, failed receipts for
interruption/source drift, bounded collected logs and preservation of originals.
Native-labelled fallback commands must be rejected before execution.

Exercise duplicate intake, route validation, repository claims and stale completion
generations. Missing integration bases and noncanonical verification skills must
fail registration. Fixtures prove the local helper contracts; they do not prove
webhook signatures, T3 dispatch or deployed review completion.
