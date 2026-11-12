import { cn } from '@repo/design-system/ui/cn';
import { Text } from '@repo/design-system/ui/text';
import type { ComponentProps } from 'react';
import { Platform, View } from 'react-native';

type ViewProps = ComponentProps<typeof View>;

/**
 * A group of rows on one surface, with a line between each two rows. Each
 * child is a `ListItem`. The name of the list comes from `aria-label`.
 */
export function List({ className, children, ...props }: ViewProps) {
  return (
    <View
      className={cn(
        'overflow-hidden rounded-surface border border-line bg-surface',
        Platform.select({ web: 'shadow-raised' }),
        className,
      )}
    >
      {/* Each row has a line above it. This lifts the first line out of view. */}
      <View role="list" className="-mt-px" {...props}>
        {children}
      </View>
    </View>
  );
}

/**
 * The row above a `List`: its title, and one action or a count at the far end.
 * Its inset is the inset of a row plus the line around the list, so the title
 * and the text of each row start on one line.
 */
export function ListHeader({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn(
        'min-h-11 flex-row items-center justify-between gap-2 border-x border-transparent px-4',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A line of text above or under a `List`, such as the line of an empty list
 * or an error. It starts on the line of the rows, as the header does.
 */
export function ListNote({ className, ...props }: ComponentProps<typeof Text>) {
  return (
    <Text
      variant="label"
      tone="muted"
      className={cn('border-x border-transparent px-4 font-normal', className)}
      {...props}
    />
  );
}

/** One row of a `List`: at least 44 px tall, with its parts in a line. */
export function ListItem({ className, ...props }: ViewProps) {
  return (
    <View
      role="listitem"
      className={cn('min-h-14 flex-row items-center gap-3 border-t border-line px-4', className)}
      {...props}
    />
  );
}
