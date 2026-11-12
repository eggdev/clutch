// iOS 27 closes an app at launch unless it adopts the scene life cycle. The
// project template of Expo 57 still starts React Native from the app
// delegate, so the app closed before its first screen on an iOS 27 simulator.
// Expo 57 ships the scene delegate, `ExpoAppSceneDelegate`, but its template
// does not use it. This plugin gives the generated project the shape of the
// Expo 58 template: the app delegate provides the React Native factory, a
// scene delegate creates the window and starts React Native in it, and
// Info.plist names that scene delegate.
//
// Delete this file, its test and its line in app.json when the app moves to
// Expo 58. The plugin stops the prebuild with that sentence when it meets a
// template that adopts the scene life cycle itself.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const marker = '// Added by apps/app/scene-lifecycle.cjs.';
const legacyClass = 'class AppDelegate: ExpoAppDelegate {';
const sceneClass = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';
const legacyStart =
  /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n\n/u;
const sceneDelegate = `
${marker}
// The scene delegate creates the window and starts React Native in it.
@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {}
`;

/** The AppDelegate.swift of the Expo 57 template, changed to the scene life cycle. A second call changes nothing. */
function adoptSceneLifecycle(source) {
  if (source.includes(marker)) {
    return source;
  }
  if (source.includes('ExpoReactNativeFactoryProvider')) {
    throw new Error(
      'The Expo template adopts the scene life cycle itself now. Delete apps/app/scene-lifecycle.cjs, its test and its line in apps/app/app.json.',
    );
  }
  if (!source.includes(legacyClass) || !legacyStart.test(source)) {
    throw new Error(
      'apps/app/scene-lifecycle.cjs does not know this AppDelegate.swift. Compare it with ios/HelloWorld/AppDelegate.swift in the template of the installed Expo, then update the plugin.',
    );
  }
  return `${source.replace(legacyClass, sceneClass).replace(legacyStart, '')}${sceneDelegate}`;
}

/** What Info.plist needs for one window scene whose delegate is the SceneDelegate class above. */
const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

function withSceneLifecycle(config) {
  const withDelegate = withAppDelegate(config, (mod) => {
    mod.modResults.contents = adoptSceneLifecycle(mod.modResults.contents);
    return mod;
  });
  return withInfoPlist(withDelegate, (mod) => {
    mod.modResults.UIApplicationSceneManifest = sceneManifest;
    return mod;
  });
}

module.exports = withSceneLifecycle;
module.exports.adoptSceneLifecycle = adoptSceneLifecycle;
