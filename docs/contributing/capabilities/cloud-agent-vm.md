# Cloud-agent VM / sandbox setup in repo

Cloud-agent setup files tell a hosted agent or a dev container how to build the environment of the repository.

## Why

Rank 79 of the researched practices. More than one third of the leading repositories use it (37%). A cloud agent starts from a bare machine. A setup file in the repository gets it to a passing check without manual steps.

## Detection

`clutch doctor` reports this capability as present when git tracks `.cursor/environment.json` or `.devcontainer/devcontainer.json`. It is partial when neither file exists but git tracks `mise.toml`, because pinned tools cover part of the setup. See the `cloud_agent_vm` entry in [the registry](./registry.yaml).

## Adopt

Clutch ships both files, and sync manages them. Each one runs [`tools/cloud-env.sh`](../../../tools/cloud-env.sh). The script installs one pinned mise, the tools that `mise.toml` pins, Python when it is missing, and the packages. It adds mise to `~/.bashrc`, and it is safe to run again.

1. `.devcontainer/devcontainer.json` uses the Debian `devcontainers/base` image, pinned by digest, and runs the script as its `postCreateCommand`. It passes your `GITHUB_TOKEN` into the container as `MISE_GITHUB_TOKEN`, which only mise reads. An unset variable then stays harmless: tools such as zizmor refuse an empty `GITHUB_TOKEN`.
2. `.cursor/environment.json` runs the script as its `install` step, for Cursor background agents. Its `start` step runs nothing long-lived.
3. Set a `GITHUB_TOKEN` secret in the cloud agent's settings. For the dev container, set it in your shell. mise downloads several tools from GitHub releases, such as the clutch binary. An anonymous download can hit GitHub's rate limit.
4. Confirm that the canonical check command passes inside the environment:

   ```sh
   npx --yes @devcontainers/cli up --workspace-folder .
   npx --yes @devcontainers/cli exec --workspace-folder . mise exec -- bun run validate
   ```

   Run it in a full clone. A git worktree's `.git` file points outside the folder that the container mounts, so git does not work inside.

5. Set `cloud_agent_vm` to `adopted` in `clutch.yaml`.

## Waive

Set `cloud_agent_vm` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when agents run only on machines that a person sets up.
