import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkSkills } from '@tools/check-skills';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'skill-contract-'));
  return {
    root,
    [Symbol.dispose]() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function skill(root: string, directory: string, name = directory) {
  const target = path.join(root, '.agents/skills', directory);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    path.join(target, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Execute a fixture flow.\n---\n`,
  );
  return target;
}

test('one generated verify remains discoverable without its authoring skill installed', () => {
  using files = fixture();
  const target = skill(files.root, 'verify');
  writeFileSync(
    path.join(target, 'verification.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedBy: 'setup-verification',
      flows: { fixture: { commands: [['true']] } },
    }),
  );
  mkdirSync(path.join(files.root, '.claude/skills'), { recursive: true });
  symlinkSync('../../.agents/skills/verify', path.join(files.root, '.claude/skills/verify'));
  expect(checkSkills(files.root)).toEqual([]);
});

test('ambiguous names and missing executor provenance fail the skill contract', () => {
  using files = fixture();
  skill(files.root, 'verify-app', 'verify');
  const target = skill(files.root, 'verify');
  writeFileSync(path.join(target, 'verification.json'), '{}');
  const problems = checkSkills(files.root);
  expect(problems).toContain(
    'verify-app: frontmatter must name its directory and describe its trigger',
  );
  expect(problems).toContain(
    'verify-app: use the single project-local verify executor from setup-verification',
  );
  expect(problems).toContain(
    'verify: configuration must identify setup-verification and executable flows',
  );
});

test('a discovery link to another skill cannot silently shadow the local executor', () => {
  using files = fixture();
  skill(files.root, 'deliver');
  skill(files.root, 'audit-codebase');
  mkdirSync(path.join(files.root, '.claude/skills'), { recursive: true });
  symlinkSync(
    '../../.agents/skills/audit-codebase',
    path.join(files.root, '.claude/skills/deliver'),
  );
  symlinkSync(
    '../../.agents/skills/audit-codebase',
    path.join(files.root, '.claude/skills/audit-codebase'),
  );
  expect(checkSkills(files.root)).toContain(
    'deliver: Claude discovery must resolve to this local skill',
  );
});

test('kickoff exposes unresolved items while its manifest is still pending', () => {
  using files = fixture();
  writeFileSync(path.join(files.root, 'KICKOFF.md'), '# Kickoff');
  writeFileSync(path.join(files.root, 'AGENTS.md'), '<!-- kickoff: Need one owner decision -->');
  const command = path.join(import.meta.dir, 'check-kickoff-slots.ts');
  const result = Bun.spawnSync([process.execPath, command, '--json'], { cwd: files.root });
  expect(result.exitCode).toBe(0);
  const output = JSON.parse(result.stdout.toString());
  expect(output.pending).toBe(true);
  expect(output.slots).toContainEqual({
    file: 'AGENTS.md',
    line: 1,
    text: 'Need one owner decision',
  });
});

test('the run-lanes skill keeps its contract and covers each part of a lane launch', () => {
  const root = path.resolve(import.meta.dir, '..');
  expect(checkSkills(root).filter((error) => error.startsWith('run-lanes'))).toEqual([]);
  const text = readFileSync(path.join(root, '.agents/skills/run-lanes/SKILL.md'), 'utf-8');
  for (const heading of [
    '## 1. Split the work by file ownership',
    '## 2. Reserve issue ids',
    '## 3. Write each brief',
    '## 4. Delegate the merge',
    '## 5. Merge in a train',
    '## 6. Steer the lanes',
    "## 7. Relay the owner's questions",
  ]) {
    expect(text).toContain(heading);
  }
  expect(text).toContain('clutch issues new --phase P1');
  expect(text).toContain('T3 Code threads are one way');
});
