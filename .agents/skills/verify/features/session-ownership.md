# Session ownership

Entry: SessionQueue in packages/runtime/service/session-queue.ts, exercised by
packages/runtime/service/session-queue.test.ts through run session-queue.

Actor: trusted controller. Each test owns disposable SQLite state and processes.
No actual device is allocated. Required runtime: pinned Bun and its SQLite API.

Enqueue two reviews, race independent processes, then complete/cancel/expire
and recover sessions. Expect one FIFO grant, rejection of forged/stale tokens,
and no successor while cleanup is pending or quarantined. Reopen acknowledged
state after an abrupt writer exit and verify persistence without replay.

Negative controls include wrong generations and late cleanup receipts. Command
transcripts show actual assertions, not a mocked database. Tests clean only their
own fixture files/processes. Driver enforcement and physical cleanup are unverified.
