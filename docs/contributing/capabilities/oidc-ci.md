# OIDC / keyless credentials in CI (id-token)

OIDC lets a CI job get short-lived cloud credentials from the GitHub identity token, so the repository settings hold no long-lived secret.

## Why

Rank 38 of the researched practices. More than three quarters of the leading repositories use it (78%). A long-lived secret can leak, and it stays valid until a person rotates it. A credential from OIDC expires quickly and applies to one job.

## Detection

`clutch doctor` reports this capability as present when a workflow file contains `role-to-assume`, `workload_identity_provider` or `azure/login`. These are the inputs of the AWS, Google Cloud and Azure login actions. See the `oidc_ci` entry in [the registry](./registry.yaml).

## Adopt

1. List the secrets that each workflow uses: `rg -n 'secrets\.' .github/workflows`.
2. For each cloud provider, set up a trust between the provider and the GitHub OIDC issuer. Limit it to the repository and the branch.
3. Grant `id-token: write` to the job that signs in.
4. Sign in with the login action of the provider, such as `aws-actions/configure-aws-credentials` with `role-to-assume`.
5. Delete the long-lived secret.
6. Set `oidc_ci` to `adopted` in `clutch.yaml`.

## Waive

Set `oidc_ci` to `waived` in `clutch.yaml` with a reason. This capability is extra, so a gap only warns. A waiver is reasonable when CI deploys to no cloud provider, or the provider has no OIDC support.
