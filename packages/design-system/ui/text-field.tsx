import type { InputHTMLAttributes } from 'react';

/** A single-line text input with a visible label. */
export function TextField({
  label,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { readonly label: string }) {
  return (
    <label className={`flex flex-col gap-1 text-caption text-fg-muted ${className}`}>
      {label}
      <input
        className="rounded-control border border-line bg-surface px-3 py-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-focus"
        {...props}
      />
    </label>
  );
}
