import { must } from '@tools/github/auto-merge-enable';
import type { Run } from '@tools/github/stack';
import ts from 'typescript';
import { parse } from 'yaml';

/**
 * The deterministic check that replaces a model's "weaker check" call. It
 * compares each changed journey and `budgets:` of `clutch.yaml` with the merge
 * base of the PR. A journey is weaker when it loses an outcome, changes what an
 * outcome expects, or has fewer assertions. A budget is weaker when it rises or
 * goes. A renamed button or a moved field changes none of these, so it passes.
 * See docs/principles/proof-gates-code.md.
 */

const journeyFile = /^features\/[^/]+\/journeys\/.+\.(?:pw\.ts|maestro\.yaml)$/u;

type Shape = { outcomes: Map<string, string>; assertions: number };

function webShape(body: string): Shape {
  const outcomes = new Map<string, string>();
  let assertions = 0;
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      const [name, expected] = node.arguments;
      if (callee === 'outcome' && name && ts.isStringLiteralLike(name)) {
        outcomes.set(
          name.text,
          (expected?.getText() ?? '').replaceAll(/\s+/gu, '').replaceAll(/,(?=[}\]])/gu, ''),
        );
        assertions += 1;
      } else if (callee === 'expect' || callee.startsWith('expect.')) {
        assertions += 1;
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(ts.createSourceFile('journey.ts', body, ts.ScriptTarget.Latest, true));
  return { outcomes, assertions };
}

function nativeShape(body: string): Shape {
  const names = [...body.matchAll(/label:\s*outcome\s+([a-z0-9-]+)/gu)].map((m) => m[1] ?? '');
  return {
    outcomes: new Map(names.map((name) => [name, ''])),
    assertions: body.match(/^\s*-\s*assert/gmu)?.length ?? 0,
  };
}

const shapeOf = (file: string, body: string) =>
  file.endsWith('.pw.ts') ? webShape(body) : nativeShape(body);

/** Why the head copy of a journey is weaker than the base copy. */
export function weakerJourney(file: string, base: string, head: string) {
  const before = shapeOf(file, base);
  const after = shapeOf(file, head);
  const reasons: Array<string> = [];
  for (const [name, expected] of before.outcomes) {
    if (!after.outcomes.has(name)) {
      reasons.push(`${file}: it no longer proves the outcome \`${name}\`.`);
    } else if (after.outcomes.get(name) !== expected) {
      reasons.push(`${file}: it changes what the outcome \`${name}\` expects.`);
    }
  }
  if (after.assertions < before.assertions) {
    reasons.push(`${file}: its assertions fall from ${before.assertions} to ${after.assertions}.`);
  }
  return reasons;
}

/** Every number in `value`, by its path. */
function numbers(value: unknown, at = 'budgets'): Array<[string, number]> {
  if (typeof value === 'number') {
    return [[at, value]];
  }
  return value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, item]) => numbers(item, `${at}.${key}`))
    : [];
}

const budgetsIn = (text: string) => (parse(text) as { budgets?: unknown } | null)?.budgets;

/** Why `budgets:` of the head `clutch.yaml` is weaker than the base. Each budget is a limit. */
export function weakerBudgets(base: string, head: string) {
  const after = new Map(numbers(budgetsIn(head)));
  return numbers(budgetsIn(base)).flatMap(([at, limit]) => {
    const now = after.get(at);
    if (now === undefined) {
      return [`clutch.yaml: the budget \`${at}\` is gone.`];
    }
    return now > limit ? [`clutch.yaml: the budget \`${at}\` rises from ${limit} to ${now}.`] : [];
  });
}

/** Why the PR at `sha` weakens a journey or a budget. None means it does not. */
export async function weakerJourneys(run: Run, defaultBranch: string, sha: string) {
  const base = await must(run, ['git', 'merge-base', `origin/${defaultBranch}`, sha]);
  const listed = await must(run, ['git', 'diff', '--name-status', '-M', base, sha]);
  const show = (ref: string, file: string) => must(run, ['git', 'show', `${ref}:${file}`]);
  const reasons: Array<string> = [];
  for (const line of listed.split('\n').filter(Boolean)) {
    const [status = '', before = '', after = before] = line.split('\t');
    if (status === 'D' && journeyFile.test(before)) {
      reasons.push(`${before}: the PR deletes this journey.`);
    } else if (status !== 'A' && status !== 'D' && journeyFile.test(before)) {
      reasons.push(...weakerJourney(after, await show(base, before), await show(sha, after)));
    } else if (status === 'M' && before === 'clutch.yaml') {
      reasons.push(...weakerBudgets(await show(base, before), await show(sha, before)));
    }
  }
  return reasons;
}
