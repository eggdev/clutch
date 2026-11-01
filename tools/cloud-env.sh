#!/usr/bin/env bash
# Builds the repository's environment on a fresh Linux machine: a dev
# container or a cloud agent's VM. It installs one pinned mise, the tools
# that mise.toml pins, and the packages. It is safe to run again.
# .devcontainer/devcontainer.json and .cursor/environment.json run it. See
# docs/contributing/capabilities/cloud-agent-vm.md.
set -euo pipefail

# Older than 3 days, like every other dependency. The installer checks the
# release's checksum.
MISE_VERSION="v2026.10.21"
export PATH="$HOME/.local/bin:$PATH"

if ! command -v mise >/dev/null || [ "$(mise --version | cut -d' ' -f1)" != "${MISE_VERSION#v}" ]; then
  curl -fsSL https://mise.run | MISE_VERSION="$MISE_VERSION" MISE_QUIET=1 sh
fi

# Later shells, such as an agent's terminal, find mise and the pinned tools.
if ! grep -qs 'mise activate bash' "$HOME/.bashrc"; then
  echo "eval \"\$(\"\$HOME/.local/bin/mise\" activate bash)\"" >> "$HOME/.bashrc"
fi

# The skill tests run Python, which mise.toml does not pin. A bare Debian
# image has none.
if ! command -v python3 >/dev/null && command -v apt-get >/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq python3 >/dev/null
fi

cd "$(dirname "$0")/.."
# A GITHUB_TOKEN or MISE_GITHUB_TOKEN in the environment lifts GitHub's rate
# limit for the tools that mise downloads from GitHub releases, such as the
# clutch binary.
mise trust --yes
mise install --yes
mise exec -- bun install --frozen-lockfile
