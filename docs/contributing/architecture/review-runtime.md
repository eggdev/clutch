# Review tooling and runtime

Clutch is the maintained source of shared review tooling. Repositories
receive skills and helpers through `clutch sync --only review`, then setup-verification
authors their own committed verify skill and journey map. The template's own
verify is excluded from distribution because it proves the template, not its consumer.

## Ownership

- deliver owns an authorized task through its destination.
- setup-verification authors or maintains the project's single verify executor.
- verify calls actual project commands, fixtures and assertions.
- `clutch sync` records shared-file hashes and detects customization before updates.
- The central review runtime owns machine-wide resource admission and cleanup.

The durable queue library lives in packages/runtime. It is not in either
installer's exported paths: consumers do not receive independent schedulers.
Its SQLite tests prove FIFO transactions, leases and cleanup quarantine. An
installed machine service, CLI session driving, owned-resource cleanup and common
T3/Appium/Maestro enforcement are still integration work. No advisory local lock
is claimed to enforce those driver boundaries.

The Python fallback under tools/verification runs existing project commands,
retains receipts, bounds collection and cleans proven owned command groups.
It refuses native-labelled execution until a managed driver path exists. It is
not a sandbox or a resident machine supervisor. Source/build/fixture identity
and visible product assertions remain project responsibilities.

## Installation and updates

From a clean committed target checkout:

```sh
bun <clutch clone>/apps/cli/src/main.ts sync --only review --check --json
bun <clutch clone>/apps/cli/src/main.ts sync --only review
```

Check is read-only. Exit 2 means changes or decisions are pending, exit 1 means
an error, and exit 0 means up to date. A real sync writes shared tooling in the
current branch without switching or committing it. Run setup-verification next,
inspect the diff and commit the project-specific result. Later updates use the
same command.

`clutch.files.yaml` lists the files and tags the review tooling `group: review`.
Its `known` hashes let unchanged older copies migrate without fetching old
history. `.clutch/lineage.json` records the synced generation and hashes. A
changed shared file needs the owner's keep-or-take decision, and nothing is
written until each one has an answer. Individual file writes are atomic. An
interrupted sync can leave uncommitted files: inspect and commit or stash that
partial state before retrying. Already matching files are accepted on retry. A
sync requires clean shared-tooling paths. Other uncommitted work can stay in the
checkout, and sync does not touch it.

The full template installer includes the shared tooling and hands off to kickoff.
A review-only sync preserves product docs, package manager, scripts and the
existing project verify. The owner-selected archival or gardening workflow is
not enabled by copying a skill.
