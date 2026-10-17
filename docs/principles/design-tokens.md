# Tokens for every visual value

Each color, size, radius, shadow, font and speed is a token. Components use
the token's role name. A restyle changes one file, and each screen follows.

## Rules

- One token file holds each value. Nothing else in the repository states a
  color, a radius, a shadow or a duration.
- A role names a job: `accent`, `fg-muted`, `radius-control`. It never names a
  look, such as `lavender` or `gray-500`.
- One role has one name. Two names for one value give two places to change.
- A class never holds an arbitrary value, such as `bg-[#fff]`, `p-[13px]` or
  `duration-[300ms]`. Use a role that exists, or add one.
- A component never uses the `dark:` variant. Each role changes its value with
  the scheme, so the component stays the same.
- A project theme sets the value of each role, for each scheme. A component
  never reads the theme or the scheme.
- Docs name roles. A value copied into a doc goes stale at the next restyle.
- Logos and third-party brand marks keep their own colors.

## Example

The theme starts empty, so only the roles exist as classes:

```css
@import 'tailwindcss';

@theme {
  --*: initial;
  --spacing: 4px;
  --color-surface: var(--surface);
  --color-fg: var(--fg);
  --color-accent: var(--accent);
  --color-on-accent: var(--on-accent);
  --radius-control: var(--radius-control);
}
```

```tsx
// Roles
<button className="rounded-control bg-accent text-on-accent">Save</button>

// A raw radius, a raw color and a palette name
<button className="rounded-[6px] bg-[#5e6ad2] text-white">Save</button>
```

## Related

- [Styling](../contributing/architecture/styling.md)
- [Compositor-only motion](./compositor-only-motion.md)
- [Mobile first](./mobile-first.md)
