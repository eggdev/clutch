import type { Status } from '@/doctor/detect';
import type { buildReport } from '@/doctor/report';

type Row = ReturnType<typeof buildReport>['results'][number];

export type Finding = { id: string; kind: string; message: string };

const rank: Record<Status, number> = { missing: 0, partial: 1, present: 2, unknown: -1 };

function docOf(id: string, docs: Map<string, string>) {
  return docs.has(id) ? ` See ${docs.get(id)}.` : '';
}

/** The problem with one capability's decision, or nothing when the decision holds. */
function decisionProblem(row: Row, issues: Map<string, string>, today: string) {
  if (row.declared === 'adopted') {
    return row.detected === 'present'
      ? null
      : {
          kind: 'adopted but not present',
          fix: `${row.id} is adopted but ${row.detected}. Restore it, or change its decision in clutch.yaml.`,
        };
  }
  if (row.declared === 'waived') {
    if (row.until && row.until < today) {
      return {
        kind: 'waiver expired',
        fix: `The ${row.id} waiver ended on ${row.until}. Adopt it, or renew the waiver in clutch.yaml.`,
      };
    }
    if (row.issue && issues.get(row.issue) === 'done') {
      return {
        kind: 'waiver ended',
        fix: `${row.issue} is done, so the ${row.id} waiver ended. Set ${row.id}: adopted in clutch.yaml, or renew the waiver.`,
      };
    }
    return null;
  }
  if (row.declared === 'undeclared' && row.detected !== 'present' && row.level === 'core') {
    return {
      kind: 'unwaived gap',
      fix: `${row.id} is ${row.detected}. Adopt it, or add a waiver in clutch.yaml with a reason and an issue.`,
    };
  }
  return null;
}

/**
 * The `clutch doctor --check` result. A failure exits 1. An improvement over
 * the baseline exits 2, because the baseline must rise with it. An unknown
 * detection never fails: only `--remote` evaluates remote rules.
 */
export function gate(
  rows: Array<Row>,
  context: {
    docs: Map<string, string>;
    issues: Map<string, string>;
    today: string;
    baseline?: Record<string, string>;
  },
) {
  const failures: Array<Finding> = [];
  const warnings: Array<Finding> = [];
  const improved: Array<string> = [];
  for (const row of rows) {
    if (row.detected === 'unknown') {
      continue;
    }
    const problem = decisionProblem(row, context.issues, context.today);
    if (problem) {
      failures.push({
        id: row.id,
        kind: problem.kind,
        message: `${problem.kind}: ${problem.fix}${docOf(row.id, context.docs)}`,
      });
    } else if (row.declared === 'undeclared' && row.detected !== 'present') {
      warnings.push({
        id: row.id,
        kind: 'extra gap',
        message: `extra gap: ${row.id} is ${row.detected}.${docOf(row.id, context.docs)}`,
      });
    }
    const before = context.baseline?.[row.id] as Status | undefined;
    if (before && rank[before] > rank[row.detected]) {
      failures.push({
        id: row.id,
        kind: 'regression',
        message: `regression: ${row.id} ${before} -> ${row.detected}. Restore it. Lowering the baseline needs --write-baseline --allow-downgrade and the owner's review.`,
      });
    } else if (before && rank[before] < rank[row.detected]) {
      improved.push(row.id);
    }
  }
  let code = 0;
  if (failures.length > 0) {
    code = 1;
  } else if (improved.length > 0) {
    code = 2;
  }
  return { code, failures, warnings, improved };
}
