import type { ClutchConfig } from '@/clutch-config/schema';
import type { Detection } from '@/doctor/detect';
import type { CapabilityEntry } from '@/doctor/registry';

const detectedStates = ['present', 'partial', 'missing', 'unknown'] as const;
const declaredStates = ['adopted', 'waived', 'n/a', 'undeclared'] as const;
const icons: Record<string, string> = { present: '✓', partial: '~', missing: '✗', unknown: '?' };

type ReportRow = {
  id: string;
  name: string;
  category: string;
  phase: string;
  level: string;
  detected: Detection['status'];
  declared: (typeof declaredStates)[number];
  reason: string | null;
  issue: string | null;
  until: string | null;
  evidence: Array<string>;
};

/** One row per capability: what the repository shows, and what its clutch.yaml declares. */
export function buildReport(
  entries: Array<CapabilityEntry>,
  detections: Array<Detection>,
  config: ClutchConfig | undefined,
) {
  const byId = new Map(detections.map((item) => [item.id, item]));
  const results: Array<ReportRow> = entries.map((entry) => {
    const found = byId.get(entry.id);
    const declared = config?.capabilities[entry.id];
    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      phase: entry.phase,
      level: entry.level,
      detected: found?.status ?? 'unknown',
      declared: declared?.status ?? 'undeclared',
      reason: declared?.reason ?? null,
      issue: declared?.issue ?? null,
      until: declared?.until ?? null,
      evidence: found?.evidence ?? [],
    };
  });
  const count = <T extends string>(states: ReadonlyArray<T>, key: 'detected' | 'declared') =>
    Object.fromEntries(
      states.map((state) => [state, results.filter((row) => row[key] === state).length]),
    );
  return {
    results,
    summary: {
      detected: count(detectedStates, 'detected'),
      declared: count(declaredStates, 'declared'),
    },
  };
}

/** The report as text: one line per capability, grouped by category, then a summary line. */
export function renderReport(report: ReturnType<typeof buildReport>) {
  const width = Math.max(...report.results.map((row) => row.id.length));
  const categories = [...new Set(report.results.map((row) => row.category))];
  const lines: Array<string> = [];
  for (const category of categories) {
    lines.push(category);
    for (const row of report.results.filter((item) => item.category === category)) {
      const detail = row.reason ?? row.evidence.slice(0, 3).join(', ');
      lines.push(
        `  ${icons[row.detected]} ${row.id.padEnd(width)}  ${row.detected.padEnd(8)}  ${row.declared.padEnd(10)}  ${detail}`.trimEnd(),
      );
    }
  }
  const { detected, declared } = report.summary;
  lines.push(
    `${report.results.length} capabilities: ${detectedStates.map((state) => `${detected[state]} ${state}`).join(', ')}. Declared: ${declaredStates.map((state) => `${declared[state]} ${state}`).join(', ')}.`,
  );
  return lines.join('\n');
}
