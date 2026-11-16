import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { check } from '@tools/contract-snapshot';
import type { Finding } from '@tools/findings';

/**
 * The rule of the contract check in tools/check-contract.ts that each package
 * with a contract proves its claims. A test file of the package must call
 * `proveClaims` from `packages/sync/testing/claims.ts`. See
 * docs/contributing/architecture/contract.md.
 */

/** The module that holds the proof of the claims of a contract, and its function. */
const claimsModule = '@repo/sync/testing/claims';
const claimsCall = 'proveClaims(';

/** The test files of one package, at any depth, but none in `node_modules`. */
function testFiles(folder: string): Array<string> {
  return readdirSync(folder, { recursive: true, encoding: 'utf-8' })
    .filter((file) => /\.test\.tsx?$/u.test(file) && !file.split(path.sep).includes('node_modules'))
    .map((file) => path.join(folder, file));
}

/**
 * Whether a test file of the package calls the proof of its claims. It reads
 * the files on disk and runs no test: a file that imports the proof and calls
 * it counts.
 */
function provesClaims(root: string, name: string): boolean {
  return testFiles(path.join(root, 'packages', name)).some((file) => {
    const source = readFileSync(file, 'utf-8');
    return source.includes(claimsModule) && source.includes(claimsCall);
  });
}

/** A package folder name in camel case, as the generator names its exports: `demo-pad` is `demoPad`. */
const camelCase = (name: string) =>
  name.replaceAll(/[-_]+(.)/gu, (_, letter: string) => letter.toUpperCase());

/**
 * The call of the proof that a package should make. A package with a client
 * half passes it, as the client holds the contract and its local changes. A
 * package with no client has no local change.
 */
function proofCall(root: string, name: string, contractName: string | undefined): string {
  if (existsSync(path.join(root, 'packages', name, 'runtime/client.ts'))) {
    return `proveClaims(${camelCase(name)}Client)`;
  }
  // A default export has no name to import by, so the call names it as the generator would.
  const contract =
    contractName && contractName !== 'default' ? contractName : `${camelCase(name)}Contract`;
  return `proveClaims({ contract: ${contract}, localChanges: [] })`;
}

/**
 * The finding for a package with a contract whose tests never call the proof,
 * or none. `contractName` is the export name of its contract.
 */
export function claimsFindings(
  root: string,
  name: string,
  contractName: string | undefined,
): Array<Finding> {
  if (provesClaims(root, name)) {
    return [];
  }
  return [
    {
      id: `${check}/claims-not-proven`,
      file: `packages/${name}/`,
      problem: 'has a contract, and no test calls `proveClaims` on it.',
      fix: `Add \`runtime/contract-claims.test.ts\` that calls \`${proofCall(root, name, contractName)}\` from \`${claimsModule}\`.`,
    },
  ];
}
