# Secret scanning

Secret scanning finds credentials in commits before they reach a shared remote.

## Why

Rank 91 of the researched practices. About one in five of the leading repositories use it (19%). Agents write and copy configuration fast, so a leaked key is easy to commit. A local scan stops the key before the push, and GitHub push protection stops it at the server.

## Detection

`clutch doctor` reports this capability as present when two rules pass. First, git tracks `.gitleaks.toml`, a file in `.githooks/` mentions gitleaks, or a workflow runs gitleaks. Second, the `secret_scanning` and `push_protection` remote probes pass. Doctor checks the remote probes on GitHub only with `--remote`. Without that flag, they are unknown, so a repository with only the local scan reports as unknown. With `--remote`, a probe that fails makes it partial. See the `secret_scanning` entry in [the registry](./registry.yaml).

## Adopt

1. Pin gitleaks in `mise.toml`.
2. Add `.gitleaks.toml` at the root. Extend the default rules.
3. Run `gitleaks git --staged --redact --no-banner` in the `pre-commit` hook.
4. Run gitleaks in CI on the commits of each pull request.
5. On GitHub, turn on secret scanning and push protection in the security settings of the repository.
6. Set `secret_scanning` to `adopted` in `clutch.yaml`.

## Waive

Set `secret_scanning` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when another scanner covers the repository. Name that scanner in the reason.
