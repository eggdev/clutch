import { detectProject } from '@/detect-project';
import { installTemplate } from '@/install-template';
import type { InstallAnswers } from '@/install-template';

export const copyList = `
version: 1
files:
  - path: AGENTS.md
    rule: seed
  - path: tools/
    rule: managed
`;

export async function existing(root: string) {
  const detection = await detectProject(root);
  if (detection.kind !== 'existing') {
    throw new Error(detection.reason);
  }
  return detection;
}

/** Installs, and fails the test unless every file was settled. */
export async function install(
  projectRoot: string,
  templateRoot: string,
  answers?: Partial<InstallAnswers>,
) {
  const result = await installTemplate({
    project: await existing(projectRoot),
    template: templateRoot,
    answers,
  });
  if (result.status !== 'installed') {
    throw new Error(`Install waits on decisions: ${JSON.stringify(result.decisions)}`);
  }
  return result;
}
