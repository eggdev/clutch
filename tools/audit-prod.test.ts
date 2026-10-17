import { expect, test } from 'bun:test';

import { auditProblems } from '@tools/audit-prod';

const advisory = (id: string, severity: string) => ({
  url: `https://github.com/advisories/${id}`,
  title: 'A flaw',
  severity,
  vulnerable_versions: '<=1.0.0',
});

test('an accepted advisory passes, and an unaccepted one fails with the fix', () => {
  const report = {
    forge: [advisory('GHSA-aaaa-bbbb-cccc', 'high')],
    other: [advisory('GHSA-dddd-eeee-ffff', 'critical'), advisory('GHSA-gggg-hhhh-iiii', 'low')],
  };
  const accepted = [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'forge', reason: 'r', revisit: 'v' }];
  expect(auditProblems(report, accepted)).toEqual([
    'other <=1.0.0: critical: A flaw (GHSA-dddd-eeee-ffff). Run `mise exec -- bun audit fix`, or upgrade the direct dependency that pulls it in.',
  ]);
});

test('a stale or incomplete entry fails', () => {
  const accepted = [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'forge', reason: ' ' }];
  expect(auditProblems({}, accepted)).toEqual([
    'tools/accepted-advisories.yaml[0]: add `reason`.',
    'tools/accepted-advisories.yaml[0]: add `revisit`.',
    'tools/accepted-advisories.yaml: the audit no longer reports GHSA-aaaa-bbbb-cccc (forge). Delete its entry.',
  ]);
});
