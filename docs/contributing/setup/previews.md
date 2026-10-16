# Previews

Each PR gets its own preview deploy. A merge to `main` deploys production. There
is no staging step.

<!-- kickoff: The hosting for previews, the preview URL pattern, the workflow that deploys it, and what each preview gets of its own (database, storage, mail). Delete this page when the hosting cannot run previews, and say so in local-development.md. -->

## A healthy preview proves nothing about a flow

A green health check shows that the preview started. It does not show that a
journey works. For a change that a user can see, sign in to the preview as a
seed user and walk each flow that the change touches. The PR names those flows.
See the [PR template](../../../.github/pull_request_template.md).

## Destructive automation checks the name first

Each script or workflow that deletes a cloud resource checks the resource name
before the call. The check accepts only the names that the script may delete,
such as the preview prefix. It throws on any other name. This stops a cleanup
script that reads the wrong variable from deleting production.

- Put the guard in the same function as the delete call.
- Cleanup runs again safely. A resource that is already gone is a success.
- A cleanup run reports one failure for all resources that it could not delete.
  It never stops at the first one.

<!-- kickoff: The name guard function and the check that rejects a delete call without it. Until the check exists, Bugbot flags an unguarded delete. -->
