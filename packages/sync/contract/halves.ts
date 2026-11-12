import { unmatched } from '@repo/sync/contract/define';

/**
 * Checks a list of halves against the declarations of a contract: each job or
 * route that the contract declares needs a half, and each half needs a
 * declaration. A mismatch throws when the list loads, with the fix in the
 * message. `noun` is the singular, such as `job` or `route`.
 */
export function checkHalves(
  contractName: string,
  noun: string,
  declared: ReadonlyArray<string>,
  halves: ReadonlyArray<string>,
): void {
  const { missing, extra } = unmatched(declared, halves);
  if (missing.length || extra.length) {
    throw new Error(
      [
        `The ${noun}s of the contract ${contractName} do not match its declarations.`,
        ...missing.map((name) => `${name} is declared and has no ${noun} in the list. Add it.`),
        ...extra.map((name) => `${name} is not a ${noun} of this contract. Remove it.`),
      ].join(' '),
    );
  }
}
