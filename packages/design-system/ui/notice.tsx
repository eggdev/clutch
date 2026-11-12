import { cn } from '@repo/design-system/ui/cn';
import { Text } from '@repo/design-system/ui/text';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

/**
 * A line across the top of the app that tells the person something they must
 * know and can act on, such as saved data that this version of the app left
 * out. It is an alert, so a screen reader says it when it appears. It starts
 * on the line of the titles under it, below the status bar of a device.
 */
export function Notice({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof View>, 'children'> & { readonly children: string }) {
  return (
    <View
      role="alert"
      className={cn('border-b border-line bg-surface pt-safe', className)}
      {...props}
    >
      <View className="mx-auto w-full max-w-xl px-4 py-3 desktop:max-w-4xl">
        <Text variant="label" tone="danger" className="border-x border-transparent px-4">
          {children}
        </Text>
      </View>
    </View>
  );
}
