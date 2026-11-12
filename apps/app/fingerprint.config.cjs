// The native fingerprint is the runtime version for over-the-air updates, and
// `native:build` builds only when it changes.
//
// package.json scripts change no native code, so they stay out of it. Otherwise
// a script edit would cut the installed builds off from every later update.
//
// The `ios` and `android` folders stay out of it too. The prebuild writes them
// from app.json and the native dependencies, which the fingerprint holds
// already, and git ignores them. With them in, a machine that has built gets
// another fingerprint than a clean checkout of the same sources.
module.exports = {
  sourceSkips: ['PackageJsonScriptsAll'],
  ignorePaths: ['ios/**/*', 'android/**/*'],
};
