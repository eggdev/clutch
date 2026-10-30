# Verification runner contract

This repository's runner is tools/verification/verify.py, with processes.py and
evidence.py beside it. Python 3.11+, Git and POSIX ps/pgrep are prerequisites.
The generated verify skill invokes it from the repository root:

```sh
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json doctor
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json run FLOW
python3 tools/verification/verify.py --config .agents/skills/verify/verification.json stop
```

Configuration names the project slug, stateDir, doctor argv arrays and flows.
Each flow names platform, role, commands, timeoutSeconds and whether its existing
test runner owns the fixture stack. All commands are argv, never interpolated shell.
Use {evidence} in argv for the fresh durable output directory.

The committed configuration has schemaVersion 1 and generatedBy setup-verification.
Use one verify skill for all surfaces. A flow name is not another skill name.

## Readiness and ownership

Doctor commands are read-only and must fail for the wrong build, backend or
fixture identity. requireOwnedStack additionally checks a saved process identity.
It does not replace project-native compatibility checks.

For ownsStack flows the test runner owns fixture setup and cleanup; otherwise
doctor must pass before execution. Native/iOS/Android-labelled flows are refused
by this fallback until an actual driver-enforced shared lease path exists.
Changing a label does not make arbitrary argv safe: this is trusted repository
automation, not a sandbox or a device authorization boundary.

Explicit start uses the configured managed-start argv and readiness deadline;
stop releases only proven owned processes. Do not invoke start for a library.
Persistent stacks require the host lifecycle supervisor for unattended lifetime
and continuing server-log bounds. This fallback caps startup logs only while it
is waiting for readiness; it does not supervise a held server after start exits.

## Receipts and interruption

Default evidence root is ~/.local/share/delivery/evidence, outside the repository.
DELIVERY_EVIDENCE_ROOT selects another durable local store. Each receipt names
action, flow, platform, role, actual commands/results, source before/after,
cleanup result and media digests. A local path is not a remote attachment.

Source changes invalidate a pass. stateDir and configured artifactPaths are
excluded from source fingerprinting as generated output. Keep those paths narrow;
never exclude product source. Unversioned fixtures are labelled versioned false
and cannot establish a Git revision.

SIGTERM/SIGINT trigger command-group cleanup and a failed final receipt. Commands
persist their owner identity and known group members. A command starts only
after its owner record is saved: it waits on a gate pipe first, and exits 125
without running if the runner dies before the record exists. A command that
cannot be found exits 127, and its log names it. After abrupt runner loss,
the next invocation reconciles the interrupted command; run/start stop before
replaying it. Use stop or doctor to inspect recovery before a fresh attempt.
Unknown or changed group ownership retains the journal and fails closed.
There is no always-running reaper: immediate cleanup after SIGKILL still needs
the future host supervisor. Opening another checkout does not grant a host lease.

## Bounded collection

limits.logBytes caps each captured flow/doctor log as it is read; the default is
8 MiB. limits.artifactBytes caps copied artifacts and checks total receipt size;
the default is 64 MiB. Generated projects should set explicit limits for their
real flows. Overflow fails loudly, preserves originals and cleans owned commands;
no expiry or archival deletion is introduced.

Artifact snapshots hash in a stream and copy only new/changed bytes. Unchanged
old media, metadata-only touches and symlinks do not count as current captures.
requireMedia fails when no current screenshot or recording exists. Direct driver
writes into the receipt directory are checked afterward, not filesystem-quota
enforced; native archives need the shared evidence runtime and upload proof.
Never collect folders containing credentials or personal data.
