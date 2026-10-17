# Mobile first

Build each screen for the smallest phone first. Add layout as space grows. A
component fits the space that its parent gives it, so one component works in
a sidebar, a sheet and a full page.

## Rules

- A class with no breakpoint prefix styles the smallest screen. A prefix such
  as `@md:` adds to it at larger sizes. Never style for desktop first and undo
  it for phones.
- A component responds to its container with `@container` and container
  variants. It never reads the viewport width.
- Only the app shell uses viewport breakpoints. It switches between the phone
  layout and the desktop layout at one width, from the breakpoint tokens.
- Each workflow works on a phone. A phone layout can move an action into a
  menu or a sheet. It never removes the action.
- Each action has a touch path. Hover can show an action sooner, but hover is
  never the only way to find it.
- A touch target is at least 44 by 44 px on a touch screen.
- Text wraps or truncates on purpose. Row metadata and trailing actions stay
  inside their parent.
- Forms stay usable with the on-screen keyboard open. Fixed bars and sheets
  stay clear of the safe-area edges.

## Three widths

Each change to a screen has a screenshot at each width, in light and in dark.
The end-to-end suite runs its visual tests at the same viewports.

| Width   | Viewport   | What it proves                                       |
| ------- | ---------- | ---------------------------------------------------- |
| Phone   | 390 × 844  | The smallest layout, touch targets and the keyboard  |
| Tablet  | 820 × 1180 | Container layouts between the two app shell layouts  |
| Desktop | 1440 × 900 | The full shell, side panels and keyboard-first flows |

## Example

The card stacks on a phone. It puts the date beside the title when its
container is wide enough, wherever the card sits:

```tsx
export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="@container rounded-surface bg-surface p-4">
      <div className="flex flex-col gap-2 @md:flex-row @md:items-center">
        <h3 className="text-title text-fg">{project.name}</h3>
        <p className="text-body text-fg-muted @md:ml-auto">{project.updatedAt}</p>
      </div>
    </article>
  );
}
```

A card that uses `lg:flex-row` breaks in a narrow sidebar on a wide screen. A
card with `w-[1200px]` breaks on every phone.

## Related

- [Tokens for every visual value](./design-tokens.md)
- [Keyboard first](./keyboard-first.md)
- [Styling](../contributing/architecture/styling.md)
