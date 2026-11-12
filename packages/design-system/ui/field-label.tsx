import type { ReactNode } from 'react';

/**
 * The visible label of a field on the web: a `label` element, so a click on
 * it moves the focus to its field. The native file draws the same text.
 */
export function FieldLabel({
  htmlFor,
  children,
}: {
  readonly htmlFor: string;
  readonly children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="font-sans text-label font-medium text-fg-muted">
      {children}
    </label>
  );
}
