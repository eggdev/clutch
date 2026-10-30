import type { ClutchConfig } from '@/clutch-config/schema';
import type { RuleResult } from '@/doctor/rules';

type SastPath = {
  /** `sast` in clutch.yaml. */
  choice: NonNullable<ClutchConfig['sast']>;
  /** The engine that sast.yml runs here, or null when doctor cannot tell without `--remote`. */
  engine: 'codeql' | 'semgrep' | null;
  evidence: string;
  /** Why sast.yml fails here with this choice. */
  problem: string | null;
};

/**
 * The SAST engine that `.github/workflows/sast.yml` runs, from `sast` in
 * clutch.yaml and, with `--remote`, whether code scanning takes results. It
 * follows the workflow's own rules. See docs/contributing/capabilities/codeql-sast.md.
 */
export async function sastPath(
  config: ClutchConfig | undefined,
  probe?: (name: string) => Promise<RuleResult>,
): Promise<SastPath> {
  const choice = config?.sast ?? 'auto';
  if (choice === 'semgrep') {
    return { choice, engine: 'semgrep', evidence: 'chosen in clutch.yaml', problem: null };
  }
  const scanning = probe ? await probe('code_scanning') : undefined;
  const evidence = scanning?.evidence.join(', ') || 'code scanning not checked without --remote';
  if (!scanning || scanning.outcome === 'unknown') {
    return { choice, engine: null, evidence, problem: null };
  }
  if (scanning.outcome === 'pass') {
    return { choice, engine: 'codeql', evidence, problem: null };
  }
  return choice === 'auto'
    ? { choice, engine: 'semgrep', evidence, problem: null }
    : {
        choice,
        engine: null,
        evidence,
        problem: `sast is codeql, but this is a ${evidence}, so code scanning takes no results and sast.yml fails. Turn on Code Security, or set sast to auto or semgrep in clutch.yaml.`,
      };
}

/** One report line, such as `SAST: auto -> codeql (public repository)`. */
export function renderSast(path: SastPath) {
  return `SAST: ${path.choice} -> ${path.engine ?? (path.problem ? 'fails' : '?')} (${path.evidence})`;
}
