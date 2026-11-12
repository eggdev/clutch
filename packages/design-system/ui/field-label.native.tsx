import { Text } from '@repo/design-system/ui/text';
import type { ReactNode } from 'react';

/**
 * The visible label of a field on a device. The field carries the same text
 * as its accessible name, so a screen reader skips this copy.
 */
export function FieldLabel({
  children,
}: {
  readonly htmlFor: string;
  readonly children: ReactNode;
}) {
  return (
    <Text variant="label" tone="muted" aria-hidden>
      {children}
    </Text>
  );
}
