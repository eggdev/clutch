import { cn } from '@repo/design-system/ui/cn';
import { Text, TextClassContext } from '@repo/design-system/ui/text';
import type { ComponentProps, ReactNode } from 'react';
import { Platform, Pressable } from 'react-native';

type Variant = 'primary' | 'quiet';
type Size = 'default' | 'small';

const base = cn(
  'shrink-0 flex-row items-center justify-center rounded-control active:scale-98',
  Platform.select({
    web: 'select-none outline-none transition-control duration-(--speed-quick) ease-out focus-visible:shadow-focus',
  }),
);

const variants: Record<Variant, string> = {
  primary: cn(
    'bg-accent active:bg-accent-hover',
    Platform.select({ web: 'hover:bg-accent-hover' }),
  ),
  quiet: cn(
    'border border-line bg-surface active:bg-press',
    Platform.select({ web: 'hover:bg-hover' }),
  ),
};

const labels: Record<Variant, string> = { primary: 'text-on-accent', quiet: 'text-fg' };

// Each size is 44 px tall on a touch screen. `small` is 36 px with a mouse,
// and on native it stays 36 px and reaches 44 px through its hit area.
const sizes: Record<Size, string | undefined> = {
  default: 'h-11 px-4',
  small: Platform.select({ web: 'h-9 px-3 pointer-coarse:h-11', default: 'h-9 px-3' }),
};

/** The extra hit area that brings the small size to 44 px on native. */
const smallHitSlop = 4;

/**
 * The one button. A screen has one primary action; the others are quiet. A
 * text child takes the label style of the variant.
 */
export function Button({
  variant = 'quiet',
  size = 'default',
  disabled,
  hitSlop,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Pressable>, 'children'> & {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly children: ReactNode;
}) {
  return (
    <TextClassContext.Provider value={labels[variant]}>
      <Pressable
        role="button"
        aria-disabled={Boolean(disabled)}
        disabled={disabled}
        hitSlop={hitSlop ?? (size === 'small' ? smallHitSlop : undefined)}
        className={cn(base, variants[variant], sizes[size], disabled && 'opacity-50', className)}
        {...props}
      >
        {typeof children === 'string' ? <Text variant="label">{children}</Text> : children}
      </Pressable>
    </TextClassContext.Provider>
  );
}
