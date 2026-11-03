import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gitOrThrow } from '@/git';
import { bodyHash, planPin, setPin } from '@/sync/pin';
import { runSync } from '@/sync/run';
import { lineagePath } from '@/sync/source';
import { gitRepo } from '@/testing/git-repo';

/** A mise.toml with the clutch pin at `version`, a tool at `gh`, and an [env] value. */
const mise = (gh: string, env = 'PORT = "1355"', version = '0.1.0') =>
  [
    '[tools]',
    `gh = "${gh}"`,
    `"github:eggdev/clutch" = { version = "${version}", minimum_release_age = "0s" }`,
    '',
    '[env]',
    env,
    '',
  ].join('\n');

const readMise = (root: string) => readFile(path.join(root, 'mise.toml'), 'utf-8');

async function commit(root: string, message: string) {
  await gitOrThrow(root, 'add', '--all');
  await gitOrThrow(root, 'commit', '--quiet', '--message', message);
}

/** A Clutch checkout that ships mise.toml, with the release tag `v0.1.0`. */
function clutch(gh = '2.0.0') {
  return gitRepo({
    'clutch.files.yaml': 'version: 1\nfiles:\n  - path: mise.toml\n    rule: managed\n',
    'mise.toml': mise(gh, undefined, 'latest'),
  });
}

test('setPin moves only the clutch version', () => {
  const text = `[tools]\n# A comment\n"github:eggdev/clutch" = { version = "0.1.0", minimum_release_age = "0s" }\n\n[env]\nPORT = "1355"\n`;
  expect(setPin(text, '0.2.0')).toBe(text.replace('version = "0.1.0"', 'version = "0.2.0"'));
  expect(setPin('[tools]\ngh = "2.0.0"\n', '0.2.0')).toBeNull();
});

test('planPin asks only when the project edited the file and Clutch changed the same file', () => {
  const recorded = bodyHash(mise('2.0.0'));
  const plan = (mine: string | null, answer?: 'keep' | 'take') =>
    planPin({
      mine,
      theirs: mise('2.1.0', undefined, '0.2.0'),
      version: '0.2.0',
      recorded,
      kept: undefined,
      answer,
    });
  // Unedited since the last sync: Clutch's body and the new pin.
  expect(plan(mise('2.0.0'))).toMatchObject({
    content: mise('2.1.0', undefined, '0.2.0'),
    decision: false,
  });
  // Edited: a decision that nothing has answered yet.
  expect(plan(mise('2.0.0', 'PORT = "9"'))).toMatchObject({ content: null, decision: true });
  // Kept: the project's body and the new pin, with the Clutch body recorded as kept.
  expect(plan(mise('2.0.0', 'PORT = "9"'), 'keep')).toMatchObject({
    content: mise('2.0.0', 'PORT = "9"', '0.2.0'),
    decision: false,
    asked: true,
    kept: bodyHash(mise('2.1.0')),
  });
});

test('a release that moves only the pin updates mise.toml and asks nothing', async () => {
  await using template = await clutch();
  await gitOrThrow(template.root, 'tag', 'v0.1.0');
  await using target = await gitRepo({ 'package.json': '{"name":"shop"}' });
  expect(await runSync({ root: target.root, template: template.root })).toMatchObject({
    status: 'synced',
    decisions: [],
  });
  expect(await readMise(target.root)).toBe(mise('2.0.0', undefined, '0.1.0'));
  await commit(target.root, 'Sync');

  await template.write({ 'README.md': 'Clutch\n' });
  await commit(template.root, 'Release');
  await gitOrThrow(template.root, 'tag', 'v0.2.0');
  const planned = await runSync({ root: target.root, template: template.root, check: true });
  expect(planned).toMatchObject({ status: 'planned', decisions: [] });
  expect(planned.changes).toContainEqual({ path: 'mise.toml', action: 'update' });
  await runSync({ root: target.root, template: template.root });
  expect(await readMise(target.root)).toBe(mise('2.0.0', undefined, '0.2.0'));
  await commit(target.root, 'Sync');
  expect(await runSync({ root: target.root, template: template.root, check: true })).toMatchObject({
    status: 'unchanged',
    changes: [],
  });
});

test('an edited mise.toml asks once when Clutch changes its body, then only the pin moves', async () => {
  await using template = await clutch();
  await gitOrThrow(template.root, 'tag', 'v0.1.0');
  await using target = await gitRepo({ 'package.json': '{"name":"shop"}' });
  await runSync({ root: target.root, template: template.root });
  await commit(target.root, 'Sync');
  await target.write({ 'mise.toml': mise('2.0.0', 'PORT = "9"') });
  await commit(target.root, 'Edit the port');

  // A tool version changes in the release, and the project has an edit: a decision, and nothing changes.
  await template.write({ 'mise.toml': mise('2.1.0', undefined, 'latest') });
  await commit(template.root, 'Bump gh');
  await gitOrThrow(template.root, 'tag', 'v0.2.0');
  expect(await runSync({ root: target.root, template: template.root })).toMatchObject({
    status: 'decisions',
    decisions: ['mise.toml'],
  });
  expect(await readMise(target.root)).toBe(mise('2.0.0', 'PORT = "9"'));
  expect(
    await runSync({ root: target.root, template: template.root, keep: ['mise.toml'] }),
  ).toMatchObject({ status: 'synced' });
  expect(await readMise(target.root)).toBe(mise('2.0.0', 'PORT = "9"', '0.2.0'));
  await commit(target.root, 'Keep the port');

  // The next release moves only the pin, so the kept body stays quiet.
  await template.write({ 'README.md': 'Clutch\n' });
  await commit(template.root, 'Release');
  await gitOrThrow(template.root, 'tag', 'v0.3.0');
  expect(await runSync({ root: target.root, template: template.root, check: true })).toMatchObject({
    status: 'planned',
    decisions: [],
  });
});

test('a keep answer for mise.toml that nothing asked for fails before anything is written', async () => {
  await using template = await clutch();
  await gitOrThrow(template.root, 'tag', 'v0.1.0');
  await using target = await gitRepo({ 'package.json': '{"name":"shop"}' });
  await expect(
    runSync({ root: target.root, template: template.root, keep: ['mise.toml'] }),
  ).rejects.toThrow('mise.toml needs no decision');
  expect(await Bun.file(path.join(target.root, lineagePath)).exists()).toBe(false);
});
