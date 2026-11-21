#!/usr/bin/env bash
# Builds the iOS app of a project for the simulator on the build machine, and
# keeps it by its native fingerprint. `native:build` copies this script to the
# build machine and runs it over ssh.
#
#   git archive REVISION | bash ios-simulator-build.sh ROOT APP REVISION
#
# ROOT is the folder of this project on the build machine. The script writes
# only under it:
#
#   work/<revision>/         the snapshot and the build products, removed at the end
#   cache/                   the package caches of Bun, npm and CocoaPods
#   artifacts/<fingerprint>/ the finished app, and the revision that made it
#   build.lock/              held while a build runs
#
# It reads a clean snapshot of REVISION as a tar archive on stdin, so it never
# builds from a working tree. A fingerprint that has an artifact builds
# nothing. The last line of the output is the fingerprint. See
# docs/contributing/setup/native.md#the-build-machine.
set -euo pipefail

# An ssh session has no locale, and CocoaPods fails without UTF-8.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

root="${1:-}"
app="${2:-}"
revision="${3:-}"
if [ -z "$root" ] || [ "${root#/}" = "$root" ] || ! printf '%s' "$app" | grep -Eq '^[a-z0-9][a-z0-9-]*$' ||
  ! printf '%s' "$revision" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Usage: git archive REVISION | bash ios-simulator-build.sh ROOT APP REVISION, with an absolute ROOT and the full commit hash." >&2
  exit 2
fi

work="$root/work/$revision"
cache="$root/cache"
artifacts="$root/artifacts"
lock="$root/build.lock"
mkdir -p "$root/work" "$cache" "$artifacts"

# One build of a project at a time: a second Xcode build would fill the disk and slow both.
if ! mkdir "$lock" 2>/dev/null; then
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    echo "Another build of this project runs on the build machine (process $holder). Wait for it, then run the command again." >&2
    exit 75
  fi
  # The build that held the lock has ended without removing it.
  rm -rf "$lock"
  mkdir "$lock"
fi
echo "$$" > "$lock/pid"
# The snapshot and the build products take several GB.
trap 'rm -rf "$work" "$lock"' EXIT

rm -rf "$work"
mkdir -p "$work"
tar -xf - -C "$work"
cd "$work"

# mise reads the tool versions of the snapshot. The variable trusts this one
# folder for this run, and mise installs nothing: a missing tool stops the build.
export MISE_TRUSTED_CONFIG_PATHS="$work" MISE_EXEC_AUTO_INSTALL=false MISE_NOT_FOUND_AUTO_INSTALL=false
if ! mise exec -- bun --version >/dev/null 2>&1 || ! mise exec -- node --version >/dev/null 2>&1; then
  echo "The build machine lacks the Bun or Node version that mise.toml names. Ask the owner to install it: this script installs no tool." >&2
  exit 1
fi

# The package caches stay under the root, not in the home folder.
export BUN_INSTALL_CACHE_DIR="$cache/bun" npm_config_cache="$cache/npm"
export CP_HOME_DIR="$cache/cocoapods" CP_CACHE_DIR="$cache/cocoapods-cache"
export EXPO_NO_TYPESCRIPT_SETUP=1 EXPO_NO_TELEMETRY=1 CI=1

started="$(date +%s)"
mise exec -- bun install --frozen-lockfile
cd "apps/$app"

# The fingerprint is taken before the prebuild writes ios/.
fingerprint="$(mise exec -- bun -e 'const tool = await import(Bun.resolveSync("@expo/fingerprint", process.cwd())); console.log((await tool.createFingerprintAsync(process.cwd(), { platforms: ["ios"] })).hash)')"
if ! printf '%s' "$fingerprint" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "The fingerprint tool gave \"$fingerprint\", not a fingerprint." >&2
  exit 1
fi
target="$artifacts/$fingerprint"

if [ -d "$target" ]; then
  echo "The build of fingerprint $fingerprint exists: $target"
else
  mise exec -- bun run prebuild:native --platform ios
  workspace="$(find ios -maxdepth 1 -name '*.xcworkspace' | head -n 1)"
  if [ -z "$workspace" ]; then
    echo "The prebuild of apps/$app wrote no iOS workspace, so there is nothing to build." >&2
    exit 1
  fi
  # Sign to Run Locally: an ad hoc signature with no team and no profile. The
  # build links the simulated entitlements into the binary, so the keychain
  # works. An unsigned app has none.
  mise exec -- xcodebuild -workspace "$workspace" -scheme "$(basename "$workspace" .xcworkspace)" \
    -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$work/tmp/derived" \
    CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= build -quiet
  built="$(find "$work/tmp/derived/Build/Products/Debug-iphonesimulator" -maxdepth 1 -name '*.app' | head -n 1)"
  if [ -z "$built" ]; then
    echo "xcodebuild wrote no .app." >&2
    exit 1
  fi
  # The artifact folder appears only when the app in it is whole.
  rm -rf "$target.partial"
  mkdir -p "$target.partial"
  ditto "$built" "$target.partial/$(basename "$built")"
  printf '%s\n' "$revision" > "$target.partial/revision"
  mv "$target.partial" "$target"
  echo "Built fingerprint $fingerprint from $revision in $(($(date +%s) - started)) s: $target"
fi
echo "$fingerprint"
