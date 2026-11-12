import { cn } from '@repo/design-system/ui/cn';
import type { ComponentProps } from 'react';
import { createContext, useContext } from 'react';
import { Text as NativeText } from 'react-native';

type Variant = 'body' | 'label' | 'caption' | 'title' | 'heading';
type Tone = 'default' | 'muted' | 'danger';

const variants: Record<Variant, string> = {
  body: 'text-body',
  label: 'text-label font-medium',
  caption: 'text-caption',
  title: 'text-title font-semibold',
  heading: 'text-heading font-semibold tracking-tight',
};

const tones: Record<Tone, string> = {
  default: 'text-fg',
  muted: 'text-fg-muted',
  danger: 'text-danger',
};

/** The heading level of each variant that is a heading. */
const levels: Partial<Record<Variant, number>> = { heading: 1, title: 2 };

/** Lets a parent, such as a button, set the class of the text inside it. */
export const TextClassContext = createContext<string | undefined>(undefined);

/**
 * The one text component. `variant` picks a type role of the token file, and
 * `tone` picks its color. `heading` is the title of a screen and `title` is
 * the title of a section, so each is a heading for a screen reader.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  className,
  ...props
}: ComponentProps<typeof NativeText> & {
  readonly variant?: Variant;
  readonly tone?: Tone;
}) {
  const inherited = useContext(TextClassContext);
  const level = levels[variant];
  return (
    <NativeText
      role={level ? 'heading' : undefined}
      aria-level={level}
      className={cn('font-sans', variants[variant], tones[tone], inherited, className)}
      {...props}
    />
  );
}
