import { parseArgs } from 'node:util';

import * as prompts from '@clack/prompts';

import { loadConfig, saveConfig } from '@/config';
import { describeEvent } from '@/describe-event';
import { detectProject } from '@/detect-project';
import { cliRoot } from '@/format';
import { gitOrThrow } from '@/git';
import { branch, installTemplate, manifestPath } from '@/install-template';
import type { InstallAnswers } from '@/install-template';
import { nextStep } from '@/next-step';
import type { Stage } from '@/next-step';
import { notify } from '@/notify';
import { chooseProvider, findProviders } from '@/providers';
import type { Provider } from '@/providers';
import { runStage } from '@/run-stage';
import { askDecisions } from '@/sync/ask';

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

async function runUnattended(provider: Provider, stage: 'survey' | 'migrate', root: string) {
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
    root,
    env: process.env,
    onEvent: (line) => {
      last = describeEvent(line) ?? last;
    },
  });
  clearInterval(timer);
  if (code !== 0) {
    spin.error(`${provider.label} stopped with exit code ${code}.`);
    await notify(`The ${stage} stopped with an error.`);
    stop(`See .git/template-install-${stage}.log in the project for the agent's output.`, code);
  }
  spin.stop(done);
  await notify(done);
}

/**
 * Installs Clutch, and settles each file the project already has with other
 * content. A person answers in a terminal. Otherwise the install stops before
 * it changes anything, and lists the files for the owner to decide.
 */
async function installWithDecisions(
  project: Extract<Awaited<ReturnType<typeof detectProject>>, { kind: 'existing' }>,
  answers: InstallAnswers,
) {
  let result = await installTemplate({ project, template: cliRoot, answers });
  if (result.status === 'decisions' && process.stdin.isTTY && process.stdout.isTTY) {
    const more = await askDecisions({
      root: project.root,
      template: cliRoot,
      commit: await gitOrThrow(cliRoot, 'rev-parse', 'HEAD'),
      files: result.decisions.map((item) => item.path),
      mergeable: new Set(
        result.decisions.filter((item) => item.rule === 'seed').map((item) => item.path),
      ),
    });
    if (!more) {
      stop('Nothing changed.', 0);
    }
    result = await installTemplate({
      project,
      template: cliRoot,
      answers: {
        keep: [...answers.keep, ...more.keep],
        take: [...answers.take, ...more.take],
        merge: [...answers.merge, ...more.merge],
      },
    });
  }
  if (result.status === 'decisions') {
    stop(
      [
        'The project already has these files with other content. Nothing changed:',
        ...result.decisions.map((item) => `  ${item.path} (${item.rule})`),
        'Ask the owner about each one, then run install again with --keep <file>, --take <file>, or --merge <file> for a seed file.',
      ].join('\n'),
      2,
    );
  }
  return result.manifest;
}

/** Installs Clutch into the project at `cwd`, then runs or hands off the kickoff stages. */
export async function installCommand(args: Array<string>, cwd: string): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      agent: { type: 'string' },
      yes: { type: 'boolean', default: false },
      keep: { type: 'string', multiple: true },
      take: { type: 'string', multiple: true },
      merge: { type: 'string', multiple: true },
    },
  });

  prompts.intro('Clutch');

  const project = await detectProject(cwd);
  if (project.kind === 'refused') {
    stop(project.reason);
  }

  let step = await nextStep(project.root);
  if (step.step === 'install') {
    const install =
      values.yes ||
      answered<boolean>(
        await prompts.confirm({
          message: `Install the template into the existing project ${project.name}?`,
        }),
      );
    if (!install) {
      stop('Nothing changed.', 0);
    }
    const manifest = await installWithDecisions(project, {
      keep: values.keep ?? [],
      take: values.take ?? [],
      merge: values.merge ?? [],
    });
    const count = (action: string) =>
      manifest.files.filter((file) => file.action === action).length;
    prompts.log.success(
      [
        `Installed on the new branch ${branch}, from ${project.defaultBranch}. The checkout is on that branch now.`,
        `Files: ${count('added')} added, ${count('replaced')} replaced, ${count('merged')} merged. Conflicts: ${manifest.conflicts.length}.`,
        `The manifest is ${manifestPath}.`,
        ...('markers' in manifest
          ? [`Resolve the conflict markers in: ${(manifest.markers as Array<string>).join(', ')}.`]
          : []),
      ].join('\n'),
    );
    step = { step: 'survey' };
  }

  if (step.step === 'done') {
    prompts.outro(`Kickoff is done. Review the branch ${branch}.`);
    return 0;
  }

  if (!values.agent) {
    prompts.outro(
      [
        `Open ${project.root} in your agent and run the kickoff skill to resume the ${step.step} stage.`,
        'Use $kickoff, /kickoff, or ask the agent to read and follow .agents/skills/kickoff/SKILL.md.',
        'No agent CLI is required. The skill continues from .template-install/manifest.json.',
      ].join('\n'),
    );
    return 0;
  }

  const provider = await pickProvider(values.agent);

  while (step.step !== 'install' && step.step !== 'done') {
    const current: Stage = step.step;
    if (current === 'interview') {
      prompts.log.step(`Opening ${provider.label} for the interview.`);
      await runStage({ provider, stage: 'interview', root: project.root, env: process.env });
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
      await runUnattended(provider, current, project.root);
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
  return 0;
}
