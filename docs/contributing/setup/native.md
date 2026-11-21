# Native builds and devices

A native app runs on a simulator, an emulator or a phone. Agents work on many
tasks at once, so they share one pool of devices. This page describes the
rules that keep them from building or starting devices they do not need.

- An agent opens a device of the shared pool with T3 Code's device tools, and
  closes it when the work ends. It never creates, clones, boots or erases a
  device with `simctl`, `adb` or Xcode.
- An agent gets a native build only through `native:build`. It makes the build
  only when no build of the native fingerprint exists.
- A script in this repository drives the device that its caller opened. It
  never opens or closes one.

The template has one native app, `apps/app`. It runs on the web and on iOS.
Android is a kickoff choice. See [client](../architecture/client.md#profiles).

## The device pool

The owner's machines share one pool of iOS simulators and Android emulators.
A lease gives one session a clean device with no app installed. T3 Code's
device tools take and end the lease:

1. `device_list` lists the device hosts and their devices. The pool is the
   host of kind `simlock`.
2. `device_open` with that host and a device leases the device. It returns the
   path of an `agent-device` command that is bound to that device and session.
3. `device_screenshot` shows the screen.
4. `device_close` with `shutdown: true` ends the lease. Always call it, also
   after a failure.

Each install, launch, tap and screenshot on the device goes through the bound
`agent-device` command. The scripts of this repository take its path in one
environment variable, `AGENT_DEVICE`:

```sh
AGENT_DEVICE=<path from device_open> mise exec -- bun run journey --native ios
```

With no variable, or with the command of a closed device, a script stops at
its first device call and names these steps. A new `device_open` gives a new
path, so pass the path of the device that is open.

The pool gives each lease its own device, so two sessions never drive one
device. No device lock exists.

A session with no T3 Code device tools cannot run a native journey. Mark the
flow as not verified.

## Device host

The device host is the one adapter that drives a device.
[`tools/native/device-host.ts`](../../../tools/native/device-host.ts)
defines it. The template has one host, `pool`. It drives the device that the
caller opened, through the command that `AGENT_DEVICE` names. A host has two
calls:

| Call     | Does                                                 |
| -------- | ---------------------------------------------------- |
| `device` | Runs one command of the bound `agent-device` command |
| `id`     | Names the opened device: the path of its command     |

`install`, `runFlow` and `deviceName` use the `device` call. `install` puts a
built app on the device. `runFlow` runs a flow in the Maestro format with
`agent-device replay --maestro`. `deviceName` reads the model of the device,
such as `iPhone 17`.

A build needs no device, so the device host makes no build. The
[build machine](#the-build-machine) makes it.

To run a Maestro flow on the opened device:

```sh
AGENT_DEVICE=<path> mise exec -- bun tools/native/device-host.ts flow features/<feature>/journeys/<id>.maestro.yaml
```

## The build machine

An iOS build needs Xcode, so a Mac makes it. This machine reaches that Mac
over ssh. The Mac is the build machine.

The setting is the file `~/.config/clutch/build-machine.json`:

```json
{ "ssh": "<host>", "root": "<absolute folder>" }
```

`ssh` is the name that `ssh` uses for the Mac. `root` is the folder on the Mac
that holds the builds. The setting belongs to the machine, so one file serves
all projects on it. The repository holds no machine name. With no file, the
build stops before any ssh call and names the file and its two fields.

The build is of the head commit, never of a working tree. `git archive` sends
the commit to the build machine. A native change that no commit holds stops
the command, and the message gives both fingerprints. Commit the change, then
run the command again.

[`tools/native/ios-simulator-build.sh`](../../../tools/native/ios-simulator-build.sh)
makes the build on the build machine. It does these steps:

1. It takes the build lock. When another build of the project runs, it stops.
2. It unpacks the commit into `work/<revision>/`.
3. It runs `bun install --frozen-lockfile`.
4. It makes the native fingerprint, before the prebuild writes `ios/`.
5. When `artifacts/<fingerprint>/` exists, it has nothing to build.
6. Otherwise it runs `prebuild:native`. Then `xcodebuild` builds the app for
   the simulator, signed to run locally, with no team and no profile.
7. It moves the app to `artifacts/<fingerprint>/`. The folder appears only
   when the app in it is whole.
8. It removes `work/<revision>/` and the lock.

The last line of its output is the fingerprint. The script writes only under
`<root>/<project>/`. `<project>` is the `name` in the root `package.json`,
without its scope.

| Folder                     | Holds                                         |
| -------------------------- | --------------------------------------------- |
| `bin/`                     | The script, as the last command sent it       |
| `work/<revision>/`         | The commit and the build products of one run  |
| `cache/`                   | The package caches of Bun, npm and CocoaPods  |
| `artifacts/<fingerprint>/` | The finished app, and the commit that made it |
| `build.lock/`              | The lock, while a build runs                  |

The script installs no tool. When mise on the build machine lacks the Bun or
Node version of `mise.toml`, the script stops. Ask the owner to install it.

## Native builds

The native fingerprint is a hash of each input that goes into the native
binary: the native folders, the config plugins and the native dependencies.
A JavaScript-only change keeps the same fingerprint. The dev build on the
device loads the JavaScript of the dev server, so it needs no new native
build.

`mise exec -- bun run native:build` is the one way to get a native build. It
has two forms:

```sh
mise exec -- bun run native:build --platform ios
AGENT_DEVICE=<path> mise exec -- bun run native:build --platform ios --install
```

1. It finds the native app: an app in `apps/` that depends on `expo` or
   `react-native`. With more than one, name the app before the flags.
2. With `--install`, it reads `AGENT_DEVICE` first. With no device, it stops
   before any build.
3. It makes the fingerprint of the app with `@expo/fingerprint`.
4. It looks for the build in `tmp/native/<fingerprint>/` of this checkout.
5. With none there, it looks on the build machine.
6. With none there, it makes the build on the build machine.
7. It copies the build to `tmp/native/<fingerprint>/`.
8. When the fingerprint differs from the one in
   `apps/<app>/native-fingerprint.json`, it lists the changed sources and
   writes the new fingerprint. Commit that file with the native change that
   caused the build.
9. With `--install`, it installs the app on the opened device. Then it records
   the fingerprint of the device in `tmp/native/devices/`.

A lease gives a device with no app, so each lease needs `--install`. When a
build of the fingerprint exists, the command makes no new build.

Android builds are not made yet. `--platform android` stops with one sentence.

A repository with no native app has nothing to build. The command prints
`No native app in this repository.` and exits 0.

The app lists `@expo/fingerprint` in its devDependencies, at an exact version.
The command `mise exec -- bun run native:build <app> --record` records the
first fingerprint, with no build.

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
`tools/native/` gets an `owner` finding, and auto-merge leaves it for the
owner.

## CI

No CI job runs a native journey for now. An agent runs one from its session,
on a device of the shared pool. CL-596 adds a native check to local CI. See
[native journeys](../end-to-end-testing.md#native-journeys).
