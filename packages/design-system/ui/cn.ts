import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The scales of ui/theme.css that Tailwind does not ship. Without them, a text
// size such as `text-label` would count as a text color, and a later color
// would remove it.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['caption', 'label', 'body', 'title', 'heading'],
      radius: ['control', 'surface', 'pill'],
      shadow: ['raised', 'focus'],
    },
  },
});

/** Joins class names. A later Tailwind class replaces an earlier one that conflicts. */
export function cn(...inputs: Array<ClassValue>) {
  return merge(clsx(inputs));
}
