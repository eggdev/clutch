# App

The client app. One builds it for the web and for iOS, from one set of React
Native components, with Expo underneath. Android is a kickoff choice. A
feature's screen renders here, and each route is a file under `app/`.

## Commands

- `mise exec -- bun run dev` starts the app in a browser at
  `http://app.<project>.localhost:1355`.
- `AGENT_DEVICE=<path> mise exec -- bun run native:build --platform ios --install`
  finds the build of the native fingerprint, makes it on the build machine
  when none exists, and installs it on the opened device. A debug build loads
  its JavaScript from the dev server, so run `dev` first.
- `AGENT_DEVICE=<path> mise exec -- bun run journey --native ios` runs the
  native journeys on the opened device.

An agent first opens a device of the
[device pool](../../docs/contributing/setup/native.md#the-device-pool) with
T3 Code's `device_open`. `<path>` is the command that `device_open` returns.

## Where things live

- `app/`: the routes. `_layout+ssg.tsx` is the root layout and the web
  document, `index.tsx` is the home screen, and `notes.tsx` renders the notes.
- `lib/boot.ts`: the composition root. It loads the object pool from the local
  database, then connects sync after the first paint.
- `lib/packages.ts`: the client half of each package, written by `nx sync`.
- `lib/server.ts` and `lib/server.native.ts`: the server connection on the web
  and on a device.
- `vite.config.ts`: the web build. `global.css` holds the Tailwind entry.
- `app.json` and `app.config.ts`: the native app configuration.
- `scene-lifecycle.cjs`: an Expo config plugin that `app.json` names. iOS 27
  closes an app at launch unless it adopts the scene life cycle, and the
  project template of Expo 57 does not. The plugin makes the generated iOS
  project adopt it. Delete the plugin when the app moves to Expo 58.

<!-- kickoff: the name, the identifiers and the scheme of the app, in app.json and app.config.ts -->
