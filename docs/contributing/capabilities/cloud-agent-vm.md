# Cloud-agent VM / sandbox setup in repo

Cloud-agent setup files tell a hosted agent or a dev container how to build the environment of the repository.

## Why

Rank 79 of the researched practices. More than one third of the leading repositories use it (37%). A cloud agent starts from a bare machine. A setup file in the repository gets it to a passing check without manual steps.

## Detection

`clutch doctor` reports this capability as present when git tracks `.cursor/environment.json` or `.devcontainer/devcontainer.json`. It is partial when neither file exists but git tracks `mise.toml`, because pinned tools cover part of the setup. See the `cloud_agent_vm` entry in [the registry](./registry.yaml).

## Adopt

1. Add `.devcontainer/devcontainer.json` on a Debian base image.
2. In its `postCreateCommand`, install mise. Then run `mise install && mise exec -- bun install`.
3. For Cursor background agents, add `.cursor/environment.json`. Its install step installs mise and the packages. Its start step runs nothing long-lived.
4. Confirm that the canonical check command passes inside the environment.
5. Set `cloud_agent_vm` to `adopted` in `clutch.yaml`.

## Waive

Set `cloud_agent_vm` to `waived` in `clutch.yaml` with a reason. A waiver is reasonable when agents run only on machines that a person sets up.
