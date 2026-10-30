import type { RuleResult } from '@/doctor/rules';
import { git } from '@/git';

/** Runs `gh` with these arguments. Probes only ever pass `api <path>`, which is a GET. */
export type Gh = (args: Array<string>) => Promise<{ ok: boolean; out: string; err: string }>;

type Response =
  | { status: 200; body: unknown }
  | { status: 403 | 404; reason: string }
  | { status: 0; reason: string };

const pass = (evidence: string): RuleResult => ({ outcome: 'pass', evidence: [evidence] });
const fail: RuleResult = { outcome: 'fail', evidence: [] };
const unknown = (reason: string): RuleResult => ({ outcome: 'unknown', evidence: [reason] });

/** The owner/name of the origin remote, or nothing. */
async function originRepo(root: string) {
  const url = await git(root, 'remote', 'get-url', 'origin');
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/u.exec(url.out)?.[1];
}

type Rule = { type: string; parameters?: { required_status_checks?: Array<{ context: string }> } };

/** The status checks that the branch rules require. */
function requiredChecks(rules: Array<Rule>) {
  return rules.flatMap(
    (rule) => rule.parameters?.required_status_checks?.map((check) => check.context) ?? [],
  );
}

/** One GET through `gh api`. A 403 or 404 keeps its code. Any other failure is status 0. */
async function fetchRoute(gh: Gh, route: string): Promise<Response> {
  const result = await gh(['api', route]);
  if (result.ok) {
    return { status: 200, body: JSON.parse(result.out || 'null') };
  }
  const code = /HTTP (403|404)/u.exec(result.err)?.[1];
  return code
    ? { status: Number(code) as 403 | 404, reason: result.err.trim() }
    : { status: 0, reason: result.err.trim() || 'gh failed' };
}

/**
 * Probes for `remote:` rules. Each reads GitHub with `gh api` GET requests,
 * cached for the run. A setting that the token cannot read is unknown, never
 * missing. No probe writes anything.
 */
export function remoteProber(options: { root: string; repo?: string; gh: Gh }) {
  const cache = new Map<string, Promise<Response>>();
  const get = (route: string) => {
    let response = cache.get(route);
    if (!response) {
      response = fetchRoute(options.gh, route);
      cache.set(route, response);
    }
    return response;
  };
  let repoName: Promise<string | undefined> | undefined;
  const repo = () => {
    repoName ??= options.repo ? Promise.resolve(options.repo) : originRepo(options.root);
    return repoName;
  };
  const settings = async () => {
    const name = await repo();
    return name
      ? get(`repos/${name}`)
      : ({ status: 0, reason: 'no GitHub origin remote' } as Response);
  };
  /** The active rules on the default branch, or a reason they are unknown. */
  const branchRules = async (): Promise<Array<Rule> | string> => {
    const repoResponse = await settings();
    if (repoResponse.status !== 200) {
      return repoResponse.reason;
    }
    const branch = (repoResponse.body as { default_branch: string }).default_branch;
    const rules = await get(`repos/${await repo()}/rules/branches/${branch}`);
    return rules.status === 200 ? (rules.body as Array<Rule>) : rules.reason;
  };
  /**
   * The older branch protection, which the rules endpoint does not report.
   * GitHub answers 404 for a branch with no protection.
   */
  const classic = async () => {
    const repoResponse = await settings();
    if (repoResponse.status !== 200) {
      return repoResponse.reason;
    }
    const branch = (repoResponse.body as { default_branch: string }).default_branch;
    const response = await get(`repos/${await repo()}/branches/${branch}/protection`);
    if (response.status === 404) {
      return { reviews: false, checks: [] as Array<string> };
    }
    if (response.status !== 200) {
      return response.reason;
    }
    const body = response.body as {
      required_pull_request_reviews?: object;
      required_status_checks?: { contexts?: Array<string> };
    };
    return {
      reviews: body.required_pull_request_reviews !== undefined,
      checks: body.required_status_checks?.contexts ?? [],
    };
  };
  const securitySetting = async (key: 'secret_scanning' | 'secret_scanning_push_protection') => {
    const response = await settings();
    if (response.status !== 200) {
      return unknown(response.reason);
    }
    const status = (response.body as { security_and_analysis?: Record<string, { status: string }> })
      .security_and_analysis?.[key]?.status;
    if (status === undefined) {
      return unknown(`${key} is not visible to this token`);
    }
    return status === 'enabled' ? pass(`GitHub ${key} enabled`) : fail;
  };

  const probes: Record<string, (argument?: string) => Promise<RuleResult>> = {
    protected_main: async () => {
      const rules = await branchRules();
      if (typeof rules === 'string') {
        return unknown(rules);
      }
      if (
        rules.some((rule) => rule.type === 'pull_request') &&
        requiredChecks(rules).includes('validate')
      ) {
        return pass('GitHub ruleset: pull requests and the validate check');
      }
      const older = await classic();
      if (typeof older === 'string') {
        return unknown(older);
      }
      return older.reviews && older.checks.includes('validate')
        ? pass('GitHub branch protection: pull requests and the validate check')
        : fail;
    },
    secret_scanning: () => securitySetting('secret_scanning'),
    push_protection: () => securitySetting('secret_scanning_push_protection'),
    merge_queue: async () => {
      const rules = await branchRules();
      if (typeof rules === 'string') {
        return unknown(rules);
      }
      return rules.some((rule) => rule.type === 'merge_queue') ? pass('GitHub merge queue') : fail;
    },
    allow_auto_merge: async () => {
      const response = await settings();
      if (response.status !== 200) {
        return unknown(response.reason);
      }
      const allowed = (response.body as { allow_auto_merge?: boolean }).allow_auto_merge;
      if (allowed === undefined) {
        return unknown('allow_auto_merge is not visible to this token');
      }
      return allowed ? pass('GitHub auto-merge allowed') : fail;
    },
    code_scanning_default_setup: async () => {
      const response = await get(`repos/${await repo()}/code-scanning/default-setup`);
      if (response.status !== 200) {
        return unknown(response.reason);
      }
      return (response.body as { state?: string }).state === 'configured'
        ? pass('GitHub CodeQL default setup')
        : fail;
    },
    required_check: async (name) => {
      const rules = await branchRules();
      if (typeof rules === 'string') {
        return unknown(rules);
      }
      if (requiredChecks(rules).includes(name ?? '')) {
        return pass(`GitHub required check ${name}`);
      }
      const older = await classic();
      if (typeof older === 'string') {
        return unknown(older);
      }
      return older.checks.includes(name ?? '') ? pass(`GitHub required check ${name}`) : fail;
    },
  };

  return (probe: string): Promise<RuleResult> => {
    const [name, argument] = probe.split(':');
    const run = probes[name];
    return run ? run(argument) : Promise.resolve(unknown(`no probe named ${name}`));
  };
}
