import type { InputHTMLAttributes } from 'react';

type Variant = 'boxed' | 'inline';

const focus = 'focus-visible:outline-2 focus-visible:outline-focus';

/**
 * A single-line text input. `boxed` shows its label above a bordered field.
 * `inline` edits text in place, such as a title in a list row: the field has no
 * border, and the label is its accessible name only.
 */
export function TextField({
  label,
  variant = 'boxed',
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string;
  readonly variant?: Variant;
}) {
  if (variant === 'inline') {
    return (
      <input
        aria-label={label}
        className={`w-full bg-surface text-body text-fg ${focus} ${className}`}
        {...props}
      />
    );
  }
  return (
    <label className={`flex flex-col gap-1 text-caption text-fg-muted ${className}`}>
      {label}
      <input
        className={`rounded-control border border-line bg-surface px-3 py-2 text-body text-fg ${focus}`}
        {...props}
      />
    </label>
  );
}
