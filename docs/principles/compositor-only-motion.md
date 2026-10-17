# Compositor-only motion

Animate `transform` and `opacity` only. The browser runs these on the
compositor, apart from the main thread, so motion stays smooth while the app
works.

## Property costs

| Kind    | Properties                                                     | Rule                               |
| ------- | -------------------------------------------------------------- | ---------------------------------- |
| Compose | `transform`, `opacity`                                         | Animate                            |
| Paint   | `color`, `background-color`, `border-color`, `fill`            | Short hover and focus changes only |
| Layout  | `width`, `height`, `top`, `left`, `margin`, `padding`, `inset` | Never animate                      |

`transition: all` animates layout properties by accident. Name each property.

## Timing

- Use the duration tokens. Do not write a duration in a component.
- Motion for a frequent interaction takes 150 ms or less. Durations up to
  350 ms are for rare, large changes, such as a dialog that opens.
- Time it asymmetrically. A thing the user calls appears at once. A thing the
  user dismisses fades out over 150 ms.
- Under `prefers-reduced-motion: reduce`, every duration is zero.

## Example

```css
:root {
  --speed-instant: 0s;
  --speed-quick: 0.1s;
  --speed-fade-out: 0.15s;
  --speed-regular: 0.25s;
  --speed-slow: 0.35s;
}

.row:hover {
  background-color: var(--bg-hover);
  transition: background-color var(--speed-quick);
}

.row .arrow {
  transform: translateX(0);
  transition: transform var(--speed-fade-out);
}
```

A Tailwind class reads the same token:

```tsx
<li className="transition-colors duration-(--speed-quick) hover:bg-hover">{name}</li>
```

A hover that sets `margin-left` lays out every row below it. Move the row with
`transform: translateX(2px)` instead.

## Related

- [Client performance](../contributing/architecture/client-performance.md)
