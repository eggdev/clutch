import { expect, test } from 'bun:test';

import { gate } from '@/doctor/gate';
import type { buildReport } from '@/doctor/report';

type Row = ReturnType<typeof buildReport>['results'][number];

const row = (id: string, fields: Partial<Row>): Row => ({
  id,
  name: id,
  category: 'Trust',
  phase: 'P1',
  level: 'core',
  detected: 'present',
  declared: 'undeclared',
  reason: null,
  issue: null,
  until: null,
  evidence: [],
  ...fields,
});

const context = {
  docs: new Map([['codeql_sast', 'docs/contributing/capabilities/codeql-sast.md']]),
  issues: new Map([
    ['CL-102', 'todo'],
    ['CL-101', 'done'],
  ]),
  today: '2026-10-29',
};

const kinds = (rows: Array<Row>, baseline?: Record<string, string>) =>
  gate(rows, { ...context, baseline }).failures.map((finding) => [finding.id, finding.kind]);

test('an adopted capability must be present', () => {
  expect(kinds([row('codeowners', { declared: 'adopted' })])).toEqual([]);
  expect(kinds([row('codeowners', { declared: 'adopted', detected: 'partial' })])).toEqual([
    ['codeowners', 'adopted but not present'],
  ]);
});

test('a core gap needs a waiver or n/a, and an extra gap is a warning', () => {
  const result = gate(
    [
      row('codeql_sast', { detected: 'missing' }),
      row('oidc_ci', { detected: 'missing', level: 'extra' }),
      row('mcp_config', { detected: 'missing', declared: 'n/a', reason: 'No MCP.' }),
    ],
    context,
  );
  expect(result.failures).toEqual([
    {
      id: 'codeql_sast',
      kind: 'unwaived gap',
      message:
        'unwaived gap: codeql_sast is missing. Adopt it, or add a waiver in clutch.yaml with a reason and an issue. See docs/contributing/capabilities/codeql-sast.md.',
    },
  ]);
  expect(result.warnings.map((finding) => finding.id)).toEqual(['oidc_ci']);
  expect(result.code).toBe(1);
});

test('a waiver holds until its date passes or its issue is done', () => {
  const waived = { detected: 'missing', declared: 'waived', reason: 'Later.' } as const;
  expect(kinds([row('codeql_sast', { ...waived, issue: 'CL-102', until: '2027-01-31' })])).toEqual(
    [],
  );
  expect(kinds([row('codeql_sast', { ...waived, until: '2026-10-01' })])).toEqual([
    ['codeql_sast', 'waiver expired'],
  ]);
  expect(kinds([row('secret_scanning', { ...waived, issue: 'CL-101' })])).toEqual([
    ['secret_scanning', 'waiver ended'],
  ]);
});

test('an unknown detection never fails without --remote', () => {
  expect(kinds([row('protected_main', { detected: 'unknown', declared: 'adopted' })])).toEqual([]);
});

test('a drop below the baseline fails, and a rise asks for a new baseline', () => {
  const result = gate([row('codeowners', { detected: 'missing', declared: 'n/a', reason: 'x' })], {
    ...context,
    baseline: { codeowners: 'present' },
  });
  expect(result.failures.map((finding) => finding.message)).toEqual([
    "regression: codeowners present -> missing. Restore it. Lowering the baseline needs --write-baseline --allow-downgrade and the owner's review.",
  ]);
  const better = gate([row('changed_scope_check', { declared: 'adopted' })], {
    ...context,
    baseline: { changed_scope_check: 'partial' },
  });
  expect([better.code, better.improved]).toEqual([2, ['changed_scope_check']]);
});
