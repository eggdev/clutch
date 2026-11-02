/**
 * The keys whose value moves the wrong way from `old` to `next`. A baseline
 * that may only move one way, such as the doctor baseline that only rises or a
 * ratchet count that only falls, refuses these moves unless the owner allows
 * them. Both baselines share this rule, so neither keeps its own copy.
 */
export function backwardMoves<T>(
  old: Record<string, T>,
  next: Record<string, T>,
  isBackward: (before: T, after: T) => boolean,
) {
  return Object.keys(next)
    .filter((key) => key in old && isBackward(old[key], next[key]))
    .map((key) => ({ key, before: old[key], after: next[key] }));
}

/** Throws `message` for the backward moves unless `allow` is set. */
export function refuseBackward<T>(
  moves: Array<{ key: string; before: T; after: T }>,
  allow: boolean,
  message: (list: string) => string,
) {
  if (moves.length > 0 && !allow) {
    throw new Error(
      message(moves.map((move) => `${move.key} ${move.before} -> ${move.after}`).join(', ')),
    );
  }
}
