import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * kickoff: a project sets its own name, slug, scheme and identifiers here,
 * and in app.json, when it starts. The values below are placeholders.
 *
 * app.json lets the iOS app load plain HTTP from `localhost` and its
 * subdomains only. The dev servers have names such as
 * `api.<project>.localhost`, which a device resolves to itself, so the
 * exception reaches no other host.
 *
 * The template ships iOS only. A project that ships Android adds `android.package` here and in app.json, and the Android lane of CI starts with it.
 */
export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const development = process.env.APP_VARIANT === 'development';

  return {
    ...config,
    name: development ? 'Clutch Dev' : 'Clutch',
    slug: 'clutch',
    ...(development ? { scheme: 'clutch-dev' } : {}),
    ios: {
      ...config.ios,
      bundleIdentifier: development ? 'dev.clutch.app.dev' : 'dev.clutch.app',
    },
  };
}
