/**
 * The one way into the notes feature. The object pool loads from the local
 * database before the first paint, so the notes are ready when the screen
 * renders. A need such as a permission settles here, before the navigation.
 * See docs/principles/one-gate-per-feature.md.
 */
export function openNotes(navigate: (href: string) => void) {
  navigate('/notes');
}
