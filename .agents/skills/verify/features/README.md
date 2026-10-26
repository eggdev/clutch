# Verification journeys

- [Session ownership](./session-ownership.md): FIFO admission, stale-lease rejection,
  quarantine and recovery through the public SQLite API. Run session-queue once.
- [Review helpers](./review-helpers.md): command cleanup, receipts, source drift,
  resource bounds and validated Linear intake. Run review-tools once.

- [Tooling installation](./tooling-installation.md): committed-source propagation,
  safe updates, custom-file conflicts and project verify preservation. Run installer once.

The features deliberately share suites instead of repeating the same expensive
setup for each assertion. No browser/native journey is currently runnable here.
