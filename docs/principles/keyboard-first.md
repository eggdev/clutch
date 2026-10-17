# Keyboard first

Each common action has a shortcut, and the interface shows it. A frequent user
works without the pointer. Each shortcut has a pointer path and a screen
reader path too.

## Rules

- One shortcut registry holds every action. The command palette, the help
  screen, menus and tooltips read it. No other file defines a key.
- A single key acts on the focused record. A sequence of two keys navigates. A
  key with a modifier acts globally.
- `Mod+K` opens the command palette. It searches actions, records and
  navigation in the local store. It sends no request. See
  [local first](./local-first.md).
- Each menu item and tooltip shows its shortcut.
- A single-key shortcut never fires while focus is in a text field.

## Example

```ts
export const shortcuts = defineShortcuts({
  'issue.assign-to-me': { keys: 'I', scope: 'focused-record', label: 'Assign to me' },
  'go.inbox': { keys: 'G I', scope: 'global', label: 'Go to inbox' },
  'palette.open': { keys: 'Mod+K', scope: 'global', label: 'Open command palette' },
});
```

## Related

- [One door for each decision](./one-door-for-each-decision.md)
