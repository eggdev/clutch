import { getRandomValues, randomUUID } from 'expo-crypto';

/**
 * Hermes, the native JavaScript engine, lacks the ES2023 array methods that
 * return a copy, which the lint asks for and the web and Bun have. Each one
 * is defined only where it is missing, as the specification describes it.
 */
type Compare = (a: unknown, b: unknown) => number;
type Predicate = (value: unknown, index: number, array: Array<unknown>) => unknown;

const methods: Record<string, (this: Array<unknown>, ...args: Array<never>) => unknown> = {
  toSorted(this: Array<unknown>, compare?: Compare) {
    return [...this].sort(compare);
  },
  toReversed(this: Array<unknown>) {
    const copy: Array<unknown> = [];
    for (let index = this.length - 1; index >= 0; index--) {
      copy.push(this[index]);
    }
    return copy;
  },
  toSpliced(this: Array<unknown>, start: number, deleteCount?: number, ...items: Array<unknown>) {
    const copy = [...this];
    copy.splice(start, deleteCount ?? copy.length - start, ...items);
    return copy;
  },
  with(this: Array<unknown>, index: number, value: unknown) {
    const copy = [...this];
    copy[index < 0 ? copy.length + index : index] = value;
    return copy;
  },
  findLast(this: Array<unknown>, predicate: Predicate) {
    let found: unknown;
    for (let index = this.length - 1; index >= 0; index--) {
      if (predicate(this[index], index, this)) {
        found = this[index];
        break;
      }
    }
    return found;
  },
  findLastIndex(this: Array<unknown>, predicate: Predicate) {
    for (let index = this.length - 1; index >= 0; index--) {
      if (predicate(this[index], index, this)) {
        return index;
      }
    }
    return -1;
  },
};

/**
 * Hermes also has no global `crypto`. The app and the sync engine call
 * `crypto.randomUUID()` and `crypto.getRandomValues()`, as the web does, so
 * Hermes gets those two from Expo's native random source. `crypto.subtle` stays
 * missing: native sealing uses expo-crypto directly.
 */
function fillCrypto(): void {
  if (!('crypto' in globalThis)) {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues, randomUUID },
      configurable: true,
    });
  }
}

/** Adds each missing method and the global `crypto`. native-setup.ts calls it before the app loads. */
export function fillHermesGaps(): void {
  fillCrypto();
  for (const [name, method] of Object.entries(methods)) {
    if (!(name in Array.prototype)) {
      Object.defineProperty(Array.prototype, name, {
        value: method,
        writable: true,
        configurable: true,
      });
    }
  }
}
