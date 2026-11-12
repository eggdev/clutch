import { expect, test } from 'bun:test';

import { gitProgramOf } from '@/git';
import type { GitLookup } from '@/git';

const xcode = '/Applications/Xcode.app/Contents/Developer';
const tools = '/Library/Developer/CommandLineTools';

function lookup(
  options: Partial<GitLookup> & { readonly present?: ReadonlyArray<string> },
): GitLookup {
  const present = options.present ?? [];
  return {
    platform: 'darwin',
    which: () => '/usr/bin/git',
    developerDir: undefined,
    readLink: () => null,
    exists: (file) => present.includes(file),
    ...options,
  };
}

test('on a Mac whose only git is the shim, the real git of the selected developer folder runs', () => {
  const present = [`${xcode}/usr/bin/git`, `${tools}/usr/bin/git`];
  expect(gitProgramOf(lookup({ present, readLink: () => xcode }))).toBe(`${xcode}/usr/bin/git`);
  // With no selected folder on record, the command line tools hold it.
  expect(gitProgramOf(lookup({ present }))).toBe(`${tools}/usr/bin/git`);
  // DEVELOPER_DIR wins over the selected folder, as it does for the shim.
  expect(
    gitProgramOf(lookup({ present: ['/custom/usr/bin/git', ...present], developerDir: '/custom' })),
  ).toBe('/custom/usr/bin/git');
});

test('any other machine, another git first on the path, or a failed lookup runs plain git', () => {
  expect(gitProgramOf(lookup({ platform: 'linux', present: [`${tools}/usr/bin/git`] }))).toBe(
    'git',
  );
  expect(gitProgramOf(lookup({ which: () => '/opt/homebrew/bin/git' }))).toBe('git');
  expect(gitProgramOf(lookup({ readLink: () => xcode }))).toBe('git');
});
