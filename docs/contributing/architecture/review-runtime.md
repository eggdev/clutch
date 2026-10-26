# Review tooling and runtime

Project-template is the maintained source of shared review tooling. Repositories
receive skills and helpers through the install CLI, then setup-verification
authors their own committed verify skill and journey map. The template's own
verify is excluded from distribution because it proves the template, not its consumer.

## Ownership

- deliver owns an authorized task through its destination.
- setup-verification authors or maintains the project's single verify executor.
- verify calls actual project commands, fixtures and assertions.
- The install CLI records shared-file hashes and detects customization before updates.
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
bun ~/dev/project-template/apps/cli/src/main.ts review install --check --json
bun ~/dev/project-template/apps/cli/src/main.ts review install
```

Check is read-only; exit 2 means changes are available, exit 1 means a conflict
or prerequisite, and exit 0 means up to date. Actual install writes shared
tooling in the current branch without switching or committing it. Run
setup-verification next, inspect the diff and commit the project-specific result.
Future updates use the same install command.

The committed source list is review.files.yaml. The known legacy checksums in
review-baseline.json allow unchanged prior template tooling to migrate without
fetching old history. .review/tooling.json records the installed generation and
hashes. Changed custom files stop the entire preflight; no force overwrite or
automatic stash is provided. Individual file writes are atomic. An interrupted
install can leave uncommitted files: inspect and commit or stash that partial
state before retrying the same source. Already matching files are accepted on
retry. This is not a filesystem transaction against a concurrent writer.
Installation requires clean review-tooling paths. Other uncommitted work can
stay in the checkout, and the installer does not touch it.

The full template installer includes the shared tooling and hands off to kickoff.
Review-only install preserves product docs, package manager, scripts and the
existing project verify. The owner-selected archival or gardening workflow is
not enabled by copying a skill.
