# Styling

How a screen gets its look: the tokens, the theme, the components and the
checks. The rules behind this page are [mobile first](../../principles/mobile-first.md),
[tokens for every visual value](../../principles/design-tokens.md) and
[compositor-only motion](../../principles/compositor-only-motion.md).
Tailwind is the only styling tool.

## Where each decision lives

| Decision                                       | Owner                                        |
| ---------------------------------------------- | -------------------------------------------- |
| The role names and the theme axes              | The template. This page lists them           |
| The value of each role                         | The project theme, in the token file         |
| The look of a component beyond its role values | The component source, which the project owns |
| Layout of a screen                             | The screen, from components and roles        |

## Platforms

| Platform   | Framework                      | Styling                             |
| ---------- | ------------------------------ | ----------------------------------- |
| Web only   | Vite, or Next for public pages | Tailwind v4, configured in CSS      |
| Native too | One or Expo, with React Native | A Tailwind binding for React Native |

<!-- kickoff: The platform, the framework, and for native the Tailwind binding with its version. Link the decision record for the platform. -->

## Roles

These names are the same in every project. A project sets their values. It
adds a role only when no role fits, and adds it here in the same change.

| Group   | Roles                                                                                | Class                      |
| ------- | ------------------------------------------------------------------------------------ | -------------------------- |
| Surface | `bg`, `surface`, `surface-raised`, `overlay`, `hover`, `press`, `selected`           | `bg-surface`               |
| Text    | `fg`, `fg-muted`, `fg-subtle`, `on-accent`                                           | `text-fg-muted`            |
| Line    | `line`, `line-subtle`, `line-strong`, `focus`                                        | `border-line`              |
| Intent  | `accent`, `accent-hover`, `danger`, `success`, `warning`, and `-subtle` fills        | `text-danger`              |
| Type    | `font-sans`, `font-mono`, `text-caption`, `text-body`, `text-title`, `text-heading`  | `text-body`                |
| Shape   | `radius-control`, `radius-surface`, `radius-pill`, `shadow-raised`, `shadow-overlay` | `rounded-control`          |
| Space   | `spacing`: one 4 px step                                                             | `p-4`                      |
| Layout  | `breakpoint-desktop`, and the container sizes `sm` to `xl`                           | `@md:flex-row`             |
| Speed   | `speed-instant`, `speed-quick`, `speed-fade-out`, `speed-regular`, `speed-slow`      | `duration-(--speed-quick)` |

A status color goes on the value or the label. Its `-subtle` fill carries soft
emphasis. A status color never fills a large area.

## Theme

| Axis   | Values                    | Owner                               |
| ------ | ------------------------- | ----------------------------------- |
| Scheme | `light`, `dark`, system   | The template: each project has both |
| Other  | Such as density or accent | The project                         |

The inline boot script in the HTML `<head>` reads the scheme from device
storage and sets the `dark` class on `<html>` before the first paint. See
[fast first load](../../principles/fast-first-load.md). The token file sets
each role under `:root` and again under `.dark`.

<!-- kickoff: The theme: the value of each role in each scheme, the font files, the shadow policy, the scheme for a first visit, and any axis beyond the scheme. -->

## Rules

- App and domain code import UI only from the design system. They never import
  the upstream component kit. See [import boundaries](../import-boundaries.md).
- One component goes in one file. Variants cover legitimate variation, so the
  design system has one `Button` and one `Card`.
- A pattern that appears in a third screen moves into the design system.
- Each screen has one primary action. Secondary and tertiary actions look
  quieter.
- Each interactive element shows a focus ring in the `focus` role.
- Contrast meets WCAG AA in both schemes.

## Checks

| Rule                                                | Check                                                           |
| --------------------------------------------------- | --------------------------------------------------------------- |
| No layout property animates                         | `lint`: `no-low-performance-animation-properties`               |
| No duration literal in CSS                          | `lint`: `declaration-property-value-disallowed-list`            |
| No speed token longer than 350 ms                   | `lint`: `declaration-property-value-allowed-list`               |
| No default Tailwind color, font or radius           | The theme starts with `--*: initial`, so the class has no style |
| No arbitrary value in a class                       | `lint`: `repo-classes/no-arbitrary-values`                      |
| No duration or delay class outside the speed tokens | `lint`: `repo-classes/speed-tokens-only`                        |
| No `transition-all`                                 | `lint`: `repo-classes/no-transition-all`                        |
| No `dark:` variant                                  | `lint`: `repo-classes/no-dark-variant`                          |

The [CSS lint](../setup/lint-rules.md#css) and the
[Tailwind class lint](../setup/lint-rules.md#tailwind-classes) run the lint
rules.

## Add a role

1. Check the roles above. Use one that fits, even if its name is not perfect.
2. Add the role to this page.
3. Set its value for each scheme in the token file, and map it in `@theme`.

## Add a component

1. Look for a component that covers it with a new variant.
2. Write the component in the design system. Style it with roles only.
3. Size it from its container. See [mobile first](../../principles/mobile-first.md).
4. Take screenshots at the three widths, in both schemes.

## What to read when changing it

<!-- kickoff: The token file, the theme file, the Tailwind entry CSS and the design-system folder. -->

- [Client performance](./client-performance.md)
- [Lint and format rules](../setup/lint-rules.md)
