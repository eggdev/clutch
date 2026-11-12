import { cn } from '@repo/design-system/ui/cn';
import { FieldLabel } from '@repo/design-system/ui/field-label';
import type { ComponentProps, RefAttributes } from 'react';
import { useId, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';

type Variant = 'boxed' | 'inline';

type InputProps = Omit<ComponentProps<typeof TextInput>, 'aria-label' | 'id'> &
  RefAttributes<TextInput>;

// The text of a field is 16 px, so iOS Safari does not zoom when it takes the
// focus. The field draws its own focus state: native has no `:focus`.
const text = cn(
  'font-sans text-body text-fg placeholder:text-fg-muted',
  Platform.select({ web: 'outline-none transition-field duration-(--speed-quick) ease-out' }),
);

const shapes: Record<Variant, string> = {
  boxed: 'h-11 rounded-control border border-line-strong bg-surface px-3',
  inline: 'h-11 w-full rounded-control',
};

const focusedShapes: Record<Variant, string | undefined> = {
  boxed: cn('border-focus', Platform.select({ web: 'shadow-focus' })),
  inline: Platform.select({ web: 'shadow-focus' }),
};

/**
 * A single-line text input. `boxed` shows its label above a bordered field.
 * `inline` edits text in place, such as a title in a list row: the field has no
 * border, and the label is its accessible name only.
 */
export function TextField({
  label,
  variant = 'boxed',
  className,
  onFocus,
  onBlur,
  ...props
}: InputProps & {
  readonly label: string;
  readonly variant?: Variant;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const input = (
    <TextInput
      id={id}
      aria-label={label}
      className={cn(
        text,
        shapes[variant],
        focused && focusedShapes[variant],
        variant === 'inline' && className,
      )}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...props}
    />
  );
  if (variant === 'inline') {
    return input;
  }
  return (
    <View className={cn('gap-1.5', className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {input}
    </View>
  );
}
