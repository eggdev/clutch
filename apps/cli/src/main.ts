#!/usr/bin/env bun
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadConfig, saveConfig } from '@apps/cli/src/config';
import { describeEvent } from '@apps/cli/src/describe-event';
import { detectProject } from '@apps/cli/src/detect-project';
import { branch, installTemplate, manifestPath } from '@apps/cli/src/install-template';
import { nextStep } from '@apps/cli/src/next-step';
import type { Stage } from '@apps/cli/src/next-step';
import { notify } from '@apps/cli/src/notify';
import { chooseProvider, findProviders } from '@apps/cli/src/providers';
import type { Provider } from '@apps/cli/src/providers';
import { runStage } from '@apps/cli/src/run-stage';
import * as prompts from '@clack/prompts';

/** The template repo is the clone that this CLI runs from. */
const template = path.resolve(import.meta.dir, '../../..');

function stop(message: string, code = 1): never {
  prompts.cancel(message);
  process.exit(code);
}

function answered<T>(value: T | symbol): T {
  if (prompts.isCancel(value)) {
    stop('Stopped. Run this again to continue where you left off.', 0);
  }
  return value as T;
}

async function pickProvider(flag: string | undefined) {
  const config = await loadConfig(process.env);
  const choice = chooseProvider({
    installed: findProviders(process.env),
    saved: config.agent,
    flag,
  });
  if (choice.kind === 'none') {
    stop(choice.reason);
  }
  if (choice.kind === 'chosen') {
    return choice.provider;
  }
  const id = answered<string>(
    await prompts.select({
      message: 'Which agent runs the kickoff?',
      options: choice.options.map((provider) => ({ value: provider.id, label: provider.label })),
    }),
  );
  await saveConfig(process.env, { ...config, agent: id });
  return choice.options.find((provider) => provider.id === id) as Provider;
}

const unattended: Record<string, { title: string; done: string }> = {
  survey: {
    title: 'Surveying the project and drafting the kickoff docs',
    done: 'The survey is done. The interview is ready.',
  },
  migrate: {
    title: 'Migrating the project until validate passes',
    done: 'The migration is done.',
  },
};

async function runUnattended(provider: Provider, stage: 'survey' | 'migrate', worktree: string) {
  const { title, done } = unattended[stage];
  const started = Date.now();
  const spin = prompts.spinner();
  spin.start(title);
  let last = '';
  const timer = setInterval(() => {
    const minutes = Math.floor((Date.now() - started) / 60_000);
    spin.message(`${title} (${minutes} min)${last ? `: ${last}` : ''}`);
  }, 1000);
  const code = await runStage({
    provider,
    stage,
    worktree,
    env: process.env,
    onEvent: (line) => {
      last = describeEvent(line) ?? last;
    },
  });
  clearInterval(timer);
  if (code !== 0) {
    spin.error(`${provider.label} stopped with exit code ${code}.`);
    await notify(`The ${stage} stopped with an error.`);
    stop(
      `See .git/worktrees/*/template-install-${stage}.log in the project for the agent's output.`,
      code,
    );
  }
  spin.stop(done);
  await notify(done);
}

const { values } = parseArgs({ options: { agent: { type: 'string' } } });

prompts.intro('Project template');

const project = await detectProject(process.cwd());
if (project.kind === 'refused') {
  stop(project.reason);
}

let step = await nextStep(project.root);
if (step.step === 'install') {
  const install = answered<boolean>(
    await prompts.confirm({
      message: `Install the template into the existing project ${project.name}?`,
    }),
  );
  if (!install) {
    stop('Nothing changed.', 0);
  }
  const { worktree, manifest } = await installTemplate({ project, template });
  const count = (action: string) => manifest.files.filter((file) => file.action === action).length;
  prompts.log.success(
    [
      `Installed into ${worktree} on branch ${branch}, from ${project.defaultBranch}.`,
      `Files: ${count('added')} added, ${count('replaced')} replaced, ${count('merged')} merged. Conflicts: ${manifest.conflicts.length}.`,
      `The manifest is ${manifestPath}.`,
    ].join('\n'),
  );
  step = { step: 'survey', worktree };
}

const provider = await pickProvider(values.agent);

while (step.step !== 'install' && step.step !== 'done') {
  const current: Stage = step.step;
  const { worktree } = step;
  if (current === 'interview') {
    prompts.log.step(`Opening ${provider.label} for the interview in ${worktree}.`);
    await runStage({ provider, stage: 'interview', worktree, env: process.env });
  } else {
    if (current === 'migrate') {
      const now = answered<boolean>(
        await prompts.select({
          message: 'The migration runs unattended until validate passes. Run it now?',
          options: [
            { value: true, label: 'Run the migration now' },
            { value: false, label: 'Stop here, and run it later' },
          ],
        }),
      );
      if (!now) {
        stop('Run this again when you want to migrate.', 0);
      }
    }
    await runUnattended(provider, current, worktree);
  }
  step = await nextStep(project.root);
  if (step.step === current) {
    stop(
      `The ${current} stage ended, but the manifest still says "${current}". Run this again to continue it.`,
      0,
    );
  }
}

prompts.outro(`Kickoff is done. Review the branch ${branch}.`);
