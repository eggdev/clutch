# App

The client app. One builds it for the web and for iOS, from one set of React
Native components, with Expo underneath. Android is a kickoff choice. A
feature's screen renders here, and each route is a file under `app/`.

## Commands

- `mise exec -- bun run dev` starts the app in a browser at
  `http://app.<project>.localhost:1355`.
- `mise exec -- bun run native:build --platform ios` builds the native app for
  the iOS simulator. The build needs no booted simulator.
- `mise exec -- bun run native:build --platform ios --install` installs the last
  build on the booted simulator. A debug build loads its JavaScript from the
  dev server, so run `dev` first.
- `mise exec -- bun run journey --native ios` runs the native journeys on the
  booted simulator.

An iOS run needs a simulator that the owner booted. No command boots one.

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
