/** A source of numbers from 0 up to 1, as `Math.random` gives them. */
export type Random = () => number;

/**
 * A seeded generator (mulberry32). The same seed gives the same numbers, so a
 * test that fails on one seed runs the same steps again on that seed.
 */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A generator seeded by `seed` and a name, so each name gets its own numbers from one seed. */
export function seededFor(seed: number, name: string): Random {
  let hash = 0x81_1c_9d_c5;
  for (const char of name) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
  }
  return seeded(seed ^ hash);
}

/** One item of a list that is not empty, chosen by the generator. */
export function pick<Item>(random: Random, items: ReadonlyArray<Item>): Item {
  return items[Math.floor(random() * items.length)];
}

/** A whole number from `low` to `high`, both included. */
export function between(random: Random, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}
