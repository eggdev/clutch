import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

function checkVerifyConfiguration(folder: string): Array<string> {
  const config = path.join(folder, 'verification.json');
  if (!existsSync(config)) {
    return ['verify: missing committed verification.json'];
  }
  try {
    const value = JSON.parse(readFileSync(config, 'utf-8'));
    if (
      value?.schemaVersion !== 1 ||
      value?.generatedBy !== 'setup-verification' ||
      !Object.keys(value?.flows ?? {}).length
    ) {
      return ['verify: configuration must identify setup-verification and executable flows'];
    }
  } catch {
    return ['verify: invalid verification.json'];
  }
  return [];
}

export function checkSkills(root: string): Array<string> {
  const directory = path.join(root, '.agents/skills');
  const errors: Array<string> = [];
  if (!existsSync(directory)) {
    return errors;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const folder = path.join(directory, entry.name);
    const filename = path.join(folder, 'SKILL.md');
    if (!existsSync(filename)) {
      errors.push(`${entry.name}: missing SKILL.md`);
      continue;
    }
    const source = readFileSync(filename, 'utf-8');
    const header = /^---\n([\s\S]*?)\n---/u.exec(source);
    let metadata: { name?: string; description?: string } = {};
    try {
      const parsed: unknown = header ? Bun.YAML.parse(header[1]) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as typeof metadata;
      }
    } catch {
      errors.push(`${entry.name}: invalid skill frontmatter`);
    }
    if (
      metadata.name !== entry.name ||
      typeof metadata.description !== 'string' ||
      !metadata.description.trim()
    ) {
      errors.push(`${entry.name}: frontmatter must name its directory and describe its trigger`);
    }
    if (entry.name.startsWith('verify-')) {
      errors.push(
        `${entry.name}: use the single project-local verify executor from setup-verification`,
      );
    }
    const discovery = path.join(root, '.claude/skills', entry.name);
    if (
      existsSync(path.dirname(discovery)) &&
      (!existsSync(discovery) || realpathSync(discovery) !== realpathSync(folder))
    ) {
      errors.push(`${entry.name}: Claude discovery must resolve to this local skill`);
    }
    if (entry.name === 'verify') {
      errors.push(...checkVerifyConfiguration(folder));
    }
  }
  return errors;
}

if (import.meta.main) {
  const errors = checkSkills(process.cwd());
  if (errors.length) {
    console.error(['Skill contract check failed:', ...errors].join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Skill names, discovery and the generated verify contract are consistent.');
  }
}
