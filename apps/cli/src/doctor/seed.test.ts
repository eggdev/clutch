import { expect, test } from 'bun:test';
import path from 'node:path';

import { detect } from '@/doctor/detect';
import { loadRegistry } from '@/doctor/registry';

/**
 * The status of each seed capability on the template itself, from the plan's
 * capability table. Remote rules stay unknown without --remote. When a rule
 * disagrees, fix the rule, not this table.
 */
const expected: Record<string, string> = {
  root_agents_md: 'present',
  nested_agent_rules: 'missing',
  skills_dir: 'present',
  friction_log: 'missing',
  codeowners: 'present',
  pr_template: 'present',
  git_hooks: 'present',
  canonical_check: 'present',
  dev_bootstrap: 'present',
  project_cli: 'present',
  verification_cli: 'present',
  custom_lint_plugin: 'present',
  suppression_discipline: 'present',
  ratchets: 'missing',
  file_size_caps: 'present',
  changed_scope_check: 'partial',
  protected_main: 'unknown',
  secret_scanning: 'missing',
  codeql_sast: 'missing',
  dep_automation: 'missing',
  dep_min_age: 'missing',
  ci_security_lint: 'partial',
  oidc_ci: 'missing',
  worktree_parallel: 'partial',
  cloud_agent_vm: 'partial',
  mcp_config: 'missing',
  ai_review_bot: 'present',
  ai_review_blocking: 'partial',
  ci_failure_explainer: 'missing',
  flaky_quarantine: 'missing',
  flake_hunter: 'missing',
  pr_size_limits: 'missing',
  merge_queue: 'missing',
  risk_tier_automerge: 'missing',
  gardener_bots: 'present',
  factory_observability: 'missing',
};

test('the registry holds the 36 seed capabilities with unique ids', async () => {
  const root = path.resolve(import.meta.dir, '../../../..');
  const registry = await loadRegistry(root);
  expect(registry.errors).toEqual([]);
  expect(registry.capabilities?.map((entry) => entry.id)).toEqual(Object.keys(expected));
});

test('each seed capability has its expected status on the template', async () => {
  const root = path.resolve(import.meta.dir, '../../../..');
  const registry = await loadRegistry(root);
  const found = await detect(root, registry.capabilities ?? []);
  const status: Record<string, string> = Object.fromEntries(
    found.map((item) => [item.id, item.status]),
  );
  expect(status).toEqual(expected);
});
