import '@/global.css';
import { AppBar } from '@repo/design-system/ui/app-bar';
import { Button } from '@repo/design-system/ui/button';
import { Notice } from '@repo/design-system/ui/notice';
import { Screen } from '@repo/design-system/ui/screen';
import { Text } from '@repo/design-system/ui/text';
import { SyncProvider } from '@repo/sync/ui/sync-provider';
import { Link, Slot, Stack } from 'one';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

import { retryBoot, useBoot } from '@/lib/boot';
import { bootScript } from '@/lib/boot-script';
import { registerNativeStyles } from '@/lib/native-styles';

registerNativeStyles();

/**
 * The root HTML on the web. One reads `<html>`, `<head>` and `<body>` from
 * what the root layout returns, and only at the top, so the layout calls this
 * function and does not render it as a component. The `+ssg` suffix of this
 * file makes One write this document into each page at build time, so the
 * boot script runs before any module loads. Native has no document.
 */
function rootHtml(children: ReactNode) {
  if (Platform.OS !== 'web') {
    return children;
  }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="color-scheme" content="light dark" />
        {/* The build step writes the sync chunks into this text, so the page and the app differ in it. */}
        <script suppressHydrationWarning>{bootScript}</script>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        {/* kickoff: the name and the description of the product. */}
        <title>Clutch</title>
        <meta name="description" content="A local-first app that works offline and syncs." />
      </head>
      <body className="bg-bg">{children}</body>
    </html>
  );
}

/**
 * The root layout of the web and the native app. Until the app has read the
 * local database, the page shows its background and no route. The first frame
 * of a screen is then its data, with no loading state before it. The web
 * renders the matched route under the bar of the app, and the native app
 * stacks its screens.
 */
export default function Layout() {
  const { loaded: pool, failure, reports } = useBoot();
  if (failure) {
    // A start that failed says why, and gives the person a way to try again.
    return rootHtml(
      <Screen>
        <View className="items-start gap-4 px-4">
          <Text role="alert">{failure}</Text>
          <Button variant="primary" onPress={retryBoot}>
            Try again
          </Button>
        </View>
      </Screen>,
    );
  }
  if (!pool) {
    return rootHtml(null);
  }
  return rootHtml(
    <SyncProvider pool={pool}>
      {/* The pool left out data that does not fit this build. The person can act on that. */}
      {reports.length > 0 ? (
        <Notice>
          This version of the app could not read some data, and left it out. Update the app.
        </Notice>
      ) : null}
      {Platform.OS === 'web' ? (
        <>
          <AppBar>
            {/* kickoff: the name of the product. It is the way home from each page. */}
            <Link
              href="/"
              className="-mx-2 rounded-control px-2 py-3 font-sans text-label font-semibold text-fg outline-none focus-visible:shadow-focus"
            >
              Clutch
            </Link>
          </AppBar>
          <Slot />
        </>
      ) : (
        <Stack screenOptions={{ headerShown: false }} />
      )}
    </SyncProvider>,
  );
}
