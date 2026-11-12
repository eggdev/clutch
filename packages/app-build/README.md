# app-build

The Vite plugins that build the universal app in `apps/app`.

NativeWind ships its setup for Metro. One bundles with Vite, so these plugins
do that work:

- `runtime/class-names.ts` gives React Native components a `className` prop.
- `runtime/native-styles.ts` compiles the Tailwind entry for the native app.
- `runtime/chunk-modules.ts` lists the source modules of each web chunk, for the first-screen check.

The native compile stops when a class or a token mixes colors. See
[styling](../../docs/contributing/architecture/styling.md).
