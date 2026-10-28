import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'quiet';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  quiet: 'bg-surface text-fg border border-line hover:bg-hover',
};

/** The one button. A screen has one primary action; the others are quiet. */
export function Button({
  variant = 'quiet',
  type = 'button',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: Variant }) {
  return (
    <button
      type={type}
      className={`rounded-control px-4 py-2 text-body transition-colors duration-(--speed-quick) focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
