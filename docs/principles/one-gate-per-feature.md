# One gate into each feature

A feature that needs something before it can show its first screen has one
gate. The gate is one function. It settles every need, then it navigates. A
need can be sign-in, a device permission, a loaded object pool or the record
that the feature edits.

Without a gate, each screen of the feature checks its needs as it renders. The
person then sees a loading screen, a permission screen or a half-drawn form
before the screen that they asked for. Each new way in copies the checks and
skips one.

## Rules

1. **One function opens the feature.** Every button, tab, menu item, shortcut
   and link calls it. No caller builds the feature's address.
2. **The gate settles needs before the first render.** It asks the system for a
   permission at the tap, and it waits for the object pool or record to load. Then it
   navigates once.
3. **The feature renders once.** Its first screen shows what the person asked
   for. It does not show a loading state, a permission prompt or an empty save
   status in front of it.
4. **A refusal still opens the feature where it can.** A refused permission
   shows its explanation in the part that needs it. The rest of the feature
   works.
5. **A cold deep link is the only other way in.** A link from outside the app,
   such as a notification or a test, can open the route directly. The route
   handles it with one plain fallback. Code in the app never uses that path.
6. **A second gate is a lint error.** The lint registry names each gated
   route, its gate and its route folder. Navigation to a gated route from any
   other file fails the check.

## Example

Each way in calls the gate. It does not build the address:

```tsx
// Slow and duplicated: each caller navigates, and the screen checks as it renders.
router.push(`/feature/${newId()}?project=${projectId}`);

// One gate: needs settle first, then one navigation.
const openFeature = useOpenFeature((href) => router.push(href));
void openFeature({ project: projectId });
```

The gate settles the needs together:

```ts
// features/<name>/gate.ts
export function useOpenFeature(navigate: (href: string) => void) {
  return async (options: FeatureOptions) => {
    await devicePermission();
    navigate(featureHref(newId(), options));
  };
}
```

The object pool loads from the local database before the first paint, so the
records are ready when the gate navigates. `features/notes/gate.ts` is the
template's gate.

## Related

- [One door for each decision](./one-door-for-each-decision.md)
- [Stay at 60 FPS](./stay-at-60-fps.md)
- [Local first](./local-first.md)
- [Lint rules: feature gates](../contributing/setup/lint-rules.md#feature-gates)
