# Native builds and devices

A native app runs on a simulator, an emulator or a phone. Agents work on many
tasks at once, so they share one pool of devices. This page describes the
rules that keep them from building or starting devices they do not need.

- An agent opens a device of the shared pool with T3 Code's device tools, and
  closes it when the work ends. It never creates, clones, boots or erases a
  device with `simctl`, `adb` or Xcode.
- An agent makes a native build only when the native fingerprint changed.
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

The device host is the one adapter that drives a device or makes a native
build. [`tools/native/device-host.ts`](../../../tools/native/device-host.ts)
defines it. The template has one host, `pool`. It drives the device that the
caller opened, through the command that `AGENT_DEVICE` names. A host has two
calls:

| Call     | Does                                                 |
| -------- | ---------------------------------------------------- |
| `device` | Runs one command of the bound `agent-device` command |
| `build`  | Builds the native app for one platform               |

`install`, `runFlow` and `deviceName` use the `device` call. `install` puts a
built app on the device. `runFlow` runs a flow in the Maestro format with
`agent-device replay --maestro`. `deviceName` reads the model of the device,
such as `iPhone 17`.

The `pool` host makes no build yet. CL-499 adds the build on the build
machine.

To run a Maestro flow on the opened device:

```sh
AGENT_DEVICE=<path> mise exec -- bun tools/native/device-host.ts flow features/<feature>/journeys/<id>.maestro.yaml
```

## Native builds

The native fingerprint is a hash of each input that goes into the native
binary: the native folders, the config plugins and the native dependencies.
A JavaScript-only change keeps the same fingerprint. The dev build on the
device loads the JavaScript of the dev server, so it needs no native
build.

`mise exec -- bun run native:build` is the one way to make a native build:

```sh
mise exec -- bun run native:build --platform ios
```

1. It finds the native app: an app in `apps/` that depends on `expo` or
   `react-native`. With more than one, name the app before the flags.
2. It makes the fingerprint of the app with `@expo/fingerprint`.
3. It compares the fingerprint with the one in
   `apps/<app>/native-fingerprint.json`, the fingerprint of the last build.
4. When the two are the same, it refuses. The change is JavaScript only, so
   ship it with an update.
5. When they differ, it lists the changed sources. Then it builds through the
   device host. The `pool` host refuses until CL-499.
6. After a build passes, it writes the fingerprint of the build. Commit
   `native-fingerprint.json` with the native change that caused the build.

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
