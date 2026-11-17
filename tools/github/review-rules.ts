/**
 * Selects the rules of docs/contributing/review.md that a diff triggers:
 *
 *   bun tools/github/review-rules.ts <diff file> [review page]
 *
 * It prints the parts of the page that define the finding levels, then each
 * rule whose `Trigger:` line matches the diff. A trigger that it cannot read
 * applies always, so a parse problem never hides a rule. The grammar is in the
 * "Add or remove a rule" section of the page. The agent-review job runs the
 * default branch's copy of this file, so a PR cannot change which rules review
 * it. So the file imports nothing from the repository and runs with no install.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const reviewPage = 'docs/contributing/review.md';

type Group =
  | { kind: 'files' | 'except'; globs: Array<string>; lines?: Array<string> }
  | { kind: 'listed'; file: string; lines?: Array<string> }
  | { kind: 'lines'; lines: Array<string> };

export type Trigger =
  | { kind: 'always' }
  | { kind: 'unreadable' }
  | { kind: 'groups'; groups: Array<Group> };

type Rule = {
  name: string;
  section: string;
  text: string;
  trigger: Trigger;
  hasTrigger: boolean;
  hasBecause: boolean;
};

export type Page = {
  /** The sections before the first rule: the finding levels and owner findings. */
  preamble: string;
  /** The prose of each rule section before its first rule. */
  intros: Map<string, string>;
  rules: Array<Rule>;
};

export type Diff = { files: Array<string>; lines: Array<{ file: string; text: string }> };

const ruleStart = /^- \*\*(.+?)\*\*/u;

/** The backtick items of a comma list, or undefined when the text is not one. */
function itemsOf(text: string): Array<string> | undefined {
  const match = /^`[^`]+`(?:,\s*`[^`]+`)*$/u.exec(text.trim());
  return match ? [...text.matchAll(/`([^`]+)`/gu)].map((item) => item[1] ?? '') : undefined;
}

function groupOf(text: string): Group | undefined {
  const [paths = '', lineText, extra] = text.split(/\s+with lines\s+/u);
  if (extra !== undefined) {
    return undefined;
  }
  const lines = lineText === undefined ? undefined : itemsOf(lineText);
  if (lineText !== undefined && !lines) {
    return undefined;
  }
  const parts = /^(files listed in|files except|files|lines)\s+(.+)$/u.exec(paths.trim());
  const items = parts ? itemsOf(parts[2] ?? '') : undefined;
  if (!parts || !items) {
    return undefined;
  }
  if (parts[1] === 'lines') {
    return lines ? undefined : { kind: 'lines', lines: items };
  }
  if (parts[1] === 'files listed in') {
    return items.length === 1 ? { kind: 'listed', file: items[0] ?? '', lines } : undefined;
  }
  return { kind: parts[1] === 'files' ? 'files' : 'except', globs: items, lines };
}

/** Reads the text after `Trigger:`. The machine part ends at the first `.` outside backticks. */
export function parseTrigger(text: string): Trigger {
  const trimmed = text.trim();
  if (/^each pull request\./iu.test(trimmed)) {
    return { kind: 'always' };
  }
  const end = /^(?:[^`.]|`[^`]*`)*\./u.exec(trimmed);
  if (!end) {
    return { kind: 'unreadable' };
  }
  const groups = end[0].slice(0, -1).split(/;\s*/u).map(groupOf);
  return groups.every((group): group is Group => group !== undefined)
    ? { kind: 'groups', groups }
    : { kind: 'unreadable' };
}

/** The paragraph that starts with `label` in a rule body, joined to one line. */
function paragraph(body: Array<string>, label: string): string | undefined {
  const start = body.findIndex((line) => line.trim().startsWith(label));
  if (start === -1) {
    return undefined;
  }
  const lines: Array<string> = [];
  for (const line of body.slice(start)) {
    if (!line.trim()) {
      break;
    }
    lines.push(line.trim());
  }
  return lines.join(' ').slice(label.length);
}

export function parsePage(content: string): Page {
  const rules: Array<Rule> = [];
  const intros = new Map<string, string>();
  const lines = content.split('\n');
  let section = '';
  let preambleEnd = -1;
  let current: { name: string; section: string; body: Array<string> } | undefined;
  const close = () => {
    if (!current) {
      return;
    }
    const { body } = current;
    while (body.length && !body.at(-1)?.trim()) {
      body.pop();
    }
    const trigger = paragraph(body, 'Trigger:');
    rules.push({
      name: current.name,
      section: current.section,
      text: body.join('\n'),
      trigger: trigger === undefined ? { kind: 'unreadable' } : parseTrigger(trigger),
      hasTrigger: trigger !== undefined,
      hasBecause: paragraph(body, 'Because:') !== undefined,
    });
    current = undefined;
  };
  for (const [index, line] of lines.entries()) {
    const heading = /^## (.+)$/u.exec(line);
    const start = ruleStart.exec(line);
    if (heading) {
      close();
      section = heading[1] ?? '';
    } else if (start) {
      close();
      if (preambleEnd === -1) {
        preambleEnd = lines.findLastIndex((other, at) => at < index && other.startsWith('## '));
      }
      current = { name: (start[1] ?? '').replace(/\.$/u, ''), section, body: [line] };
    } else if (current && (line === '' || /^\s/u.test(line))) {
      current.body.push(line);
    } else {
      close();
      const open = section;
      if (open && !rules.some((rule) => rule.section === open) && line.trim()) {
        intros.set(open, [intros.get(open), line].filter(Boolean).join('\n'));
      }
    }
  }
  close();
  const first = lines.findIndex((line) => line.startsWith('## '));
  const preamble =
    first === -1 ? '' : lines.slice(first, Math.max(first, preambleEnd)).join('\n').trim();
  return { preamble, intros, rules };
}

/** The changed paths, old and new, and the added and removed lines of a unified diff. */
export function parseDiff(diff: string): Diff {
  const files = new Set<string>();
  const lines: Diff['lines'] = [];
  let file = '';
  let inHunk = false;
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
    if (header) {
      inHunk = false;
      file = header[2] ?? '';
      files.add(header[1] ?? '').add(file);
      continue;
    }
    const side = /^(?:---|\+\+\+) (?:[ab]\/)?(.+)$/u.exec(line);
    if (!inHunk && side) {
      if (side[1] !== '/dev/null') {
        files.add(side[1] ?? '');
        file = line.startsWith('---') && file ? file : (side[1] ?? file);
      }
      continue;
    }
    const rename = /^rename (?:from|to) (.+)$/u.exec(line);
    if (!inHunk && rename) {
      files.add(rename[1] ?? '');
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      lines.push({ file, text: line.slice(1) });
    }
  }
  files.delete('');
  return { files: [...files], lines };
}

function lineMatch(patterns: Array<string>, text: string): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'iu').test(text);
    } catch {
      return text.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}

export type ReadFile = (file: string) => string;

const globMatch = (globs: Array<string>, file: string) =>
  globs.some((glob) => new Bun.Glob(glob).match(file));

function listedGlobs(read: ReadFile, file: string): Array<string> | undefined {
  try {
    const { patterns } = JSON.parse(read(file)) as { patterns?: unknown };
    const strings = Array.isArray(patterns) && patterns.every((item) => typeof item === 'string');
    return strings ? patterns : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a rule applies. A group that cannot be checked applies, like an unreadable trigger. */
export function applies(trigger: Trigger, diff: Diff, read: ReadFile): boolean {
  if (trigger.kind !== 'groups') {
    return true;
  }
  return trigger.groups.some((group) => {
    if (group.kind === 'lines') {
      return diff.lines.some((line) => lineMatch(group.lines, line.text));
    }
    const globs = group.kind === 'listed' ? listedGlobs(read, group.file) : group.globs;
    if (!globs) {
      return true;
    }
    const inFile = (file: string) => globMatch(globs, file) !== (group.kind === 'except');
    const { lines } = group;
    return lines
      ? diff.lines.some((line) => inFile(line.file) && lineMatch(lines, line.text))
      : diff.files.some(inFile);
  });
}

/** The text that the reviewer reads: the levels, then each matched rule under its section. */
export function selectRules(content: string, diff: Diff, read: ReadFile): string {
  const page = parsePage(content);
  const matched = page.rules.filter((rule) => applies(rule.trigger, diff, read));
  const skipped = page.rules.filter((rule) => !matched.includes(rule));
  const out = [
    '# Review rules for this diff',
    '',
    `${matched.length} of the ${page.rules.length} rules of ${reviewPage} match this diff. Apply these rules only.`,
    '',
    page.preamble,
  ];
  let section = '';
  for (const rule of matched) {
    if (rule.section !== section) {
      ({ section } = rule);
      out.push('', `## ${section}`);
      const intro = page.intros.get(section);
      if (intro) {
        out.push('', intro);
      }
    }
    out.push('', rule.text);
  }
  if (skipped.length) {
    out.push('', `Not triggered by this diff: ${skipped.map((rule) => rule.name).join('; ')}.`);
  }
  return `${out.join('\n')}\n`;
}

if (import.meta.main) {
  const [diffFile, pageFile = reviewPage] = process.argv.slice(2);
  if (!diffFile) {
    console.error('Usage: bun tools/github/review-rules.ts <diff file> [review page]');
    process.exit(2);
  }
  const root = process.cwd();
  const read: ReadFile = (file) => readFileSync(path.resolve(root, file), 'utf-8');
  process.stdout.write(
    selectRules(read(pageFile), parseDiff(readFileSync(diffFile, 'utf-8')), read),
  );
}
