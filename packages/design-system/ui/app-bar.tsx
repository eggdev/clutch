import { cn } from '@repo/design-system/ui/cn';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

/**
 * The bar at the top of each page on the web. It holds the name of the
 * product, which is the way home, on the line where each title of the screen
 * under it starts. A native app has the navigation of its platform, so the
 * layout of the app renders this bar on the web only.
 */
export function AppBar({ className, children, ...props }: ComponentProps<typeof View>) {
  return (
    <View role="banner" className={cn('border-b border-line bg-surface', className)} {...props}>
      <View className="mx-auto h-14 w-full max-w-xl flex-row items-center px-4 desktop:max-w-4xl">
        <View className="flex-row items-center border-x border-transparent px-4">{children}</View>
      </View>
    </View>
  );
}
