/**
 * GitHub Actions workflows in .github/workflows/. GitHub resolves a
 * `steps.<id>` or `needs.<id>` reference that names no step or job to an empty
 * string, so the run does not fail. This check rejects those references, a
 * workflow without a top-level `permissions` block, and the
 * `pull_request_target` trigger. See docs/contributing/setup/checks.md#ci.
 */
const folder = '.github/workflows';

type Step = { id?: unknown };
type Job = { needs?: unknown; steps?: Step[] };
type Workflow = { on?: unknown; permissions?: unknown; jobs?: Record<string, Job> };

/** The expressions in a parsed YAML value: each `${{ … }}`, and each `if:` value, which may omit the braces. */
function expressions(value: unknown, key = ''): string[] {
  if (typeof value === 'string')
    return key === 'if' && !value.includes('${{')
      ? [value]
      : [...value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((match) => match[1]);
  if (Array.isArray(value)) return value.flatMap((item) => expressions(item));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([name, item]) => expressions(item, name));
  return [];
}

/** Each distinct `<context>.<id>` at the start of a property path, as [reference, id]. */
const references = (texts: string[], context: string) => [
  ...new Map(
    texts.flatMap((text) =>
      [...text.matchAll(new RegExp(`(?<![\\w.-])${context}\\.([A-Za-z_][\\w-]*)`, 'g'))].map(
        (match) => [match[0], match[1]] as const,
      ),
    ),
  ),
];

const names = (value: unknown) =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.map(String) : [];

const triggers = (on: unknown) =>
  typeof on === 'string' ? [on] : Array.isArray(on) ? on : on ? Object.keys(on) : [];

export function findWorkflowErrors(file: string, source: string): string[] {
  const errors: string[] = [];
  let workflow: Workflow;
  try {
    workflow = Bun.YAML.parse(source) as Workflow;
  } catch (error) {
    return [`${file}: the YAML does not parse. ${(error as Error).message}`];
  }
  if (workflow.permissions === undefined)
    errors.push(
      `${file}: add a top-level \`permissions\` block. Start from \`contents: read\` and grant more per job.`,
    );
  if (triggers(workflow.on).includes('pull_request_target'))
    errors.push(
      `${file}: \`pull_request_target\` runs fork code with the base repository's secrets. Use \`pull_request\`.`,
    );
  const jobs = workflow.jobs ?? {};
  for (const [job, definition] of Object.entries(jobs)) {
    const steps = new Set((definition.steps ?? []).map((step) => step.id).filter(Boolean));
    const needs = new Set(names(definition.needs));
    for (const need of needs)
      if (!Object.hasOwn(jobs, need))
        errors.push(`${file}: job \`${job}\` needs \`${need}\`, which is not a job.`);
    const texts = expressions(definition);
    for (const [reference, id] of references(texts, 'steps'))
      if (!steps.has(id))
        errors.push(
          `${file}: job \`${job}\` reads \`${reference}\`. Give a step in this job \`id: ${id}\`, or fix the name.`,
        );
    for (const [reference, id] of references(texts, 'needs'))
      if (!needs.has(id))
        errors.push(
          `${file}: job \`${job}\` reads \`${reference}\`. Add \`${id}\` to the job's \`needs\`, or fix the name.`,
        );
  }
  const { jobs: _, ...workflowLevel } = workflow;
  for (const [reference, id] of references(expressions(workflowLevel), 'jobs'))
    if (!Object.hasOwn(jobs, id))
      errors.push(`${file}: \`${reference}\` names no job. Fix the name.`);
  return errors;
}

export async function checkWorkflows(root: string): Promise<string[]> {
  const errors: string[] = [];
  const files = await Array.fromAsync(
    new Bun.Glob('*.{yml,yaml}').scan({ cwd: `${root}/${folder}` }),
  ).catch(() => []);
  for (const file of files.sort())
    errors.push(
      ...findWorkflowErrors(
        `${folder}/${file}`,
        await Bun.file(`${root}/${folder}/${file}`).text(),
      ),
    );
  return errors;
}

if (import.meta.main) {
  const errors = await checkWorkflows(process.cwd());
  if (errors.length) {
    console.error(
      [
        `Workflow check failed (${errors.length}).`,
        'Fix each reference, trigger or permissions block below. See docs/contributing/setup/checks.md#ci.',
        '',
        ...errors,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else
    console.log(
      'Workflows name real steps and jobs, set permissions and avoid pull_request_target.',
    );
}
