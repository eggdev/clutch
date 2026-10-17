import type { Config } from 'stylelint';

/** A time literal such as `150ms` or `.2s`. A custom property name never matches. */
const time = /(?<![\w.-])\d*\.?\d+m?s\b/u;

/** Zero to 350 ms, in `s` or `ms`. */
const atMost350ms = /^(?:0?\.(?:[0-2]\d*|3[0-5]?0*)s|0m?s|(?:\d{1,2}|[12]\d{2}|3[0-4]\d|350)ms)$/u;

/**
 * The CSS lint. Each rule enforces one line of
 * docs/principles/compositor-only-motion.md. See
 * docs/contributing/setup/lint-rules.md#css.
 */
export default {
  plugins: ['stylelint-high-performance-animation'],
  rules: {
    // Animate the compositor properties. The paint properties in this list
    // are allowed for short hover and focus changes. Layout never animates,
    // and `all` counts as layout.
    'plugin/no-low-performance-animation-properties': [
      true,
      { ignoreProperties: ['color', 'background-color', 'border-color', 'fill'] },
    ],
    'declaration-property-value-disallowed-list': {
      // Durations come from the `--speed-*` tokens.
      '/^(?:transition|animation)(?:-duration|-delay)?$/': [time],
    },
    // No token is longer than 350 ms.
    'declaration-property-value-allowed-list': {
      '/^--speed-/': [atMost350ms],
    },
  },
} satisfies Config;
