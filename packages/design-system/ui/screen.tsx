import { cn } from '@repo/design-system/ui/cn';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

/**
 * The frame of a screen on the web: one centered column that the page
 * scrolls. The native file scrolls inside the safe area of the device.
 */
export function Screen({ className, ...props }: ComponentProps<typeof View>) {
  return (
    <View
      role="main"
      className={cn(
        'mx-auto w-full max-w-xl gap-6 px-4 py-6 desktop:max-w-4xl desktop:py-8',
        className,
      )}
      {...props}
    />
  );
}
