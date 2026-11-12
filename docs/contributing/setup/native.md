# Native builds and devices

A native app runs on a simulator, an emulator or a phone. Agents work on many
tasks at once, so they share the devices of one machine. This page describes
the rules that keep them from building or starting devices they do not need.

- An agent reuses the booted device. It never creates, clones, boots or
  erases one.
- An agent makes a native build only when the native fingerprint changed.
- One session at a time drives a device or makes a native build.

The template has one native app, `apps/app`. It runs on the web and on iOS.
Android is a kickoff choice. See [client](../architecture/client.md#profiles).

## Device host

The device host is the one adapter that drives a device or makes a native
build. [`tools/native/device-host.ts`](../../../tools/native/device-host.ts)
defines it. A host has four calls:

| Call           | Does                                              |
| -------------- | ------------------------------------------------- |
| `bootedDevice` | Finds the booted device of a platform, or nothing |
| `install`      | Installs a built app on the booted device         |
| `runFlow`      | Runs a Maestro flow on the booted device          |
| `build`        | Builds the native app for one platform            |

A host has no call that creates, clones, boots or erases a device. When no
device is booted, the host stops and tells the agent to ask the owner.

The `DEVICE_HOST` environment variable names the host. A machine sets it, and
the native jobs of `.github/workflows/ci.yml` set it. The template ships three
hosts:

- `none` refuses each call and points to this page. It is the host when
  `DEVICE_HOST` is not set.
- `ci` drives the one device that a CI job booted on its own runner. It runs
  Maestro on it, and it builds nothing. See
  [native journeys](../end-to-end-testing.md#native-journeys).
- `local` drives the booted device of the machine that runs the command. It
  also builds. It runs the `prebuild:native` script of the app, then compiles a
  debug build for any simulator. A build needs no booted device.

<!-- kickoff: The device host of this project: the machine that runs the simulators, how an agent session reaches it, and the DEVICE_HOST name. Add the adapter to `hosts` in tools/native/device-host.ts, with tests that use a fake. -->

To run a Maestro flow on the booted device:

```sh
mise exec -- bun tools/native/device-host.ts flow ios features/<feature>/journeys/<id>.maestro.yaml
```

## The device lock

One lock file lets one session at a time drive a device or make a native
build. It is `~/.cache/agent-devices/device.lock`. `DEVICE_LOCK` moves it,
for tests.

The lock is in the home folder, not in the repository. Each clone, worktree
and project on a machine shares the same simulators. A lock in the
repository would give each worktree its own lock.

When a live process holds the lock, the next session stops at once. The
message names the process and its folder. Wait for that session to finish. Do
not delete the lock file. A lock from a process that has ended is taken over.

A host that drives a device on another machine holds its lock on that
machine.

## Native builds

The native fingerprint is a hash of each input that goes into the native
binary: the native folders, the config plugins and the native dependencies.
A JavaScript-only change keeps the same fingerprint. The dev build on the
device loads the JavaScript of the dev server, so it needs no native
build.

`mise exec -- bun run native:build` is the one way to make a native build:

```sh
mise exec -- bun run native:build --platform ios
mise exec -- bun run native:build --platform ios --install
```

1. It finds the native app: an app in `apps/` that depends on `expo` or
   `react-native`. With more than one, name the app before the flags.
2. It makes the fingerprint of the app with `@expo/fingerprint`.
3. It compares the fingerprint with the one in
   `apps/<app>/native-fingerprint.json`, the fingerprint of the last build.
4. When the two are the same, it refuses. The change is JavaScript only, so
   ship it with an update.
5. When they differ, it lists the changed sources. Then it builds through the
   device host, while it holds the device lock.
6. After a build passes, it writes the fingerprint of the build. Commit
   `native-fingerprint.json` with the native change that caused the build.

A repository with no native app has nothing to build. The command prints
`No native app in this repository.` and exits 0.

The app lists `@expo/fingerprint` in its devDependencies, at an exact version.
The command `mise exec -- bun run native:build <app> --record` records the
first fingerprint, with no build.

`--install` puts the last build on the booted device, with no build. A build
needs no device, so it can finish before the owner boots one. When no device
is booted, the command says so and exits 1. The owner boots the device, then
runs the `--install` command.

`--fresh` builds without the fingerprint comparison, and it writes no record.
A CI runner has no earlier build to compare with. The command refuses unless
the environment variable `GITHUB_ACTIONS` is `true`, which GitHub sets on its
runners. `CI` does not name a runner, because an agent sets it on its own
machine too.

A review flags a change to `native-fingerprint.json` that has no native change
with it.

## Commands that agents do not run

The `guard-dev-servers` hook refuses each command below and names the fix. It
reads each command of a shell line after its runner, such as `npx`, `bunx`,
`pnpm dlx`, `yarn` or `mise exec --`.

| Command                                                      | Does                      | Fix                                 |
| ------------------------------------------------------------ | ------------------------- | ----------------------------------- |
| `xcrun simctl create`, `clone`, `boot` or `erase`            | Makes or starts a device  | Reuse the booted device             |
| `open -a Simulator`                                          | Starts a simulator        | Reuse the booted device             |
| `emulator -avd`, `emulator @<name>`, `adb emu`, `avdmanager` | Starts or makes a device  | Reuse the booted device             |
| `eas simulator`                                              | Starts a cloud simulator  | Reuse the booted device             |
| `eas build`, `eas build:dev`, `eas build:run`                | Makes a native build      | `mise exec -- bun run native:build` |
| `expo run:ios`, `expo run:android`, `expo prebuild`          | Makes a native build      | `mise exec -- bun run native:build` |
| `one run:ios`, `one run:android`, `one prebuild`             | Makes a native build      | `mise exec -- bun run native:build` |
| `react-native run-ios` and the other run and build commands  | Makes a native build      | `mise exec -- bun run native:build` |
| `xcodebuild`, except `-list` and the other read flags        | Makes a native build      | `mise exec -- bun run native:build` |
| `gradlew` with an `assemble`, `bundle` or `install` task     | Makes or installs a build | `mise exec -- bun run native:build` |

Commands that only read stay allowed. Examples are `xcrun simctl list`,
`xcodebuild -list`, `eas build:list` and `eas update`.

The Claude desktop app has iOS Simulator tools. `.claude/settings.json` sends
them to the same hook:

- A `build` call of `mcp__Claude_Code_iOS_Simulator__build` is refused. Use
  `mise exec -- bun run native:build`. A `build_status` call stays allowed.
- A call of `mcp__Claude_Code_iOS_Simulator__control` with `device` or `udid`
  is refused. Without them, the tool reuses the attached or booted simulator.

`check-agent-hooks` fails when the hook matcher misses one of these tools.
Codex has no such tools.

A shell script that runs one of these commands does not trigger the hook.
Agent review is the control that holds. A change that weakens the gate in
`tools/native/` gets an `owner` finding, and the weekly digest lists it for the
owner.

## CI

The `native-ios` and `native-android` jobs in `.github/workflows/ci.yml` run
each native journey on a simulator and an emulator. `native-ios` runs when a
native app declares an iOS app ID in its app.json. `native-android` runs when a
native app declares an Android package. The `native-ios` job starts the dev
servers, then runs `native:build --fresh`. The `native-android` job still has a
placeholder build line, which fails until a project fills it at kickoff. A CI
job never calls `eas build` directly. See
[native journeys](../end-to-end-testing.md#native-journeys).
