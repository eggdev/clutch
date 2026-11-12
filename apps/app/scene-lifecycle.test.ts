import { expect, test } from 'bun:test';

import { adoptSceneLifecycle } from '@/scene-lifecycle.cjs';

/** The AppDelegate.swift of the Expo 57 template, as the prebuild reads it. */
const expo57AppDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

/** The Expo 58 template, which already adopts the scene life cycle. */
const expo58AppDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // The window is created and React Native is started by \`SceneDelegate\` under the
    // scene-based life cycle (required by the iOS 27 SDK).
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

test('the Expo 57 template becomes the scene form', () => {
  const result = adoptSceneLifecycle(expo57AppDelegate);
  expect(result).toContain('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
  expect(result).toContain('class SceneDelegate: ExpoAppSceneDelegate {}');
  expect(result).not.toContain('UIWindow(frame:');
  expect(result).not.toContain('factory.startReactNative(');
  expect(result).toContain('RCTLinkingManager.application(app, open: url, options: options)');
});

test('a second call on the result changes nothing', () => {
  const once = adoptSceneLifecycle(expo57AppDelegate);
  expect(adoptSceneLifecycle(once)).toBe(once);
});

test('a template that adopts the scene life cycle itself stops the prebuild with the delete sentence', () => {
  expect(() => adoptSceneLifecycle(expo58AppDelegate)).toThrow(
    'Delete apps/app/scene-lifecycle.cjs',
  );
});

test('an unknown AppDelegate stops the prebuild with the update sentence', () => {
  expect(() => adoptSceneLifecycle('class AppDelegate: NSObject {}')).toThrow(
    'does not know this AppDelegate.swift',
  );
});
