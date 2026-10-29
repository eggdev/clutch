# Verification journeys

- [Session ownership](./session-ownership.md): FIFO admission, stale-lease rejection,
  quarantine and recovery through the public SQLite API. Run session-queue once.
- [Review helpers](./review-helpers.md): command cleanup, receipts, source drift,
  resource bounds and validated Linear intake. Run review-tools once.

- [Tooling installation](./tooling-installation.md): committed-source propagation,
  safe updates, custom-file conflicts and project verify preservation. Run installer once.

- [Notes sync](../../../../features/notes/journeys/notes-sync.pw.ts): a note
  that one device adds, renames, and renames offline reaches a second device
  with no reload. Run notes-sync once.

The features deliberately share suites instead of repeating the same expensive
setup for each assertion. Each web journey is a flow; its header is its feature
page. No native journey is runnable here; native flows need the device host.
