import { plugin } from 'bun';

/**
 * A test renders React Native components through React Native for Web, as the
 * web app does. This preload points each import of `react-native` at it. A
 * file with a `.native` suffix is for a device, and no test loads one. A
 * project with no React Native code has no React Native for Web, and this
 * preload does nothing there.
 */
function webModule(): string | undefined {
  try {
    return import.meta.resolve('react-native-web');
  } catch {
    return undefined;
  }
}

const web = webModule();
if (web !== undefined) {
  // React Native for Web reads this global, which only a bundler defines.
  Reflect.set(globalThis, '__DEV__', false);
  plugin({
    name: 'react-native-web',
    setup(build) {
      build.onLoad({ filter: /\/node_modules\/react-native\/index\.js$/u }, () => ({
        contents: `export * from ${JSON.stringify(web)};`,
        loader: 'js',
      }));
    },
  });
}
