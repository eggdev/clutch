# consolidate-review-tooling: bring review tooling into project-template

State: blocked
Owner: current migration session
Destination: verified project-template branch, published for review
Authorization: owner requested moving the review work into project-template,
providing an install/update CLI and deleting the superseded private repository.

## Scope

Preserve the shared runtime and reviewed skill/helper improvements. Add a
lightweight review install command alongside full kickoff installation. Keep
generated verify project-owned. Protect custom files, active work and private
research. No machine service, driver setting, schedule or cloud archive is activated.

The source template checkout contains separate uncommitted workflow work.
This task uses an isolated worktree and leaves those edits intact. Its base
preserves existing local installer/delivery behavior atop current remote main.
Private task history is kept locally and is not an ancestor of the public branch.

## Acceptance

- C1: Shared skills/helpers and the central queue library are maintained here.
  Consumer projects do not get another machine scheduler or the template's verify.
- C2: The CLI installs and updates committed shared tooling, records checksums,
  preserves custom files and project verify, supports read-only preflight and
  converges on repeated/partial installation.
- C3: Focused installer tests, queue/helper journeys and the local validation
  gate pass, including actual CLI propagation from a committed source.
- C4: Original private history is preserved in a verified external bundle.
  Publish only reusable tooling and general documentation to the public template.
  Delete the superseded GitHub repository only after preservation and publication.

## Evidence

The external bundle verified both original branch refs and complete history.
It is private local evidence; its history is not an ancestor of the public migration.
Installer behavior tests cover fresh/repeat/update, conflict-before-write,
legacy retirement, read-only/dirty work, symlink parents, partial convergence,
and exclusion of the source-only executor. Full validate passed all 33 tasks.
The template verify doctor and session-queue, review-tools and installer flows
passed with retained receipts. Actual CLI propagation from e513ffe installed
26 shared files, verified every hash, preserved project verify and target HEAD,
repeated unchanged and rejected customization without writes.

Interrupted installation requires inspecting and committing or stashing the
partial checkout before retry; clean-tree protection remains in force.

## Resume

Push verification exposed inherited Git hook variables leaking into fixtures.
Restored the migration checkout and tracking ref; the original checkout retained
its unrelated edits. Push checks now clear Git-reported repository-local variables
before running Nx, with a regression that resolves the actual fixture checkout.

Implementation, full validation, normal push checks and publication are complete.
PR: https://github.com/eggdev/project-template/pull/2 (not merged).
The private complete-history bundle was verified again before deletion.
GitHub refused deletion of the superseded remote with HTTP 403: the current
credential lacks delete_repo scope. The remote and local source remain intact.
The remaining action requires GitHub reauthentication with that scope, then retry
the already-authorized deletion. No service or driver integration was activated.
