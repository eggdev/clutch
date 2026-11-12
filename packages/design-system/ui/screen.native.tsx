import { cn } from '@repo/design-system/ui/cn';
import type { ComponentProps } from 'react';
import { ScrollView } from 'react-native';
import type { View } from 'react-native';
import { useCssElement } from 'react-native-css';
import type { StyledConfiguration, StyledProps } from 'react-native-css';
import { SafeAreaView as NativeSafeAreaView } from 'react-native-safe-area-context';
import type { SafeAreaViewProps } from 'react-native-safe-area-context';

/**
 * react-native-css gives `className` to the components of React Native only.
 * Without a style, the safe area view has no height, and the screen is blank.
 * This wraps it the way that package wraps its own components.
 */
const mapping = {
  className: 'style',
} satisfies StyledConfiguration<typeof NativeSafeAreaView>;

function SafeAreaView(props: StyledProps<SafeAreaViewProps, typeof mapping>) {
  return useCssElement(NativeSafeAreaView, props, mapping);
}

/**
 * The frame of a screen on a device: one column that scrolls inside the safe
 * area. A tap outside a field closes the keyboard, a tap on a button still
 * lands, and the focused field stays above the keyboard.
 */
export function Screen({ className, children }: ComponentProps<typeof View>) {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerClassName={cn('gap-6 px-4 py-6', className)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
