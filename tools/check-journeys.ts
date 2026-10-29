import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  fieldOf,
  headerOf,
  journeyCommand,
  journeys,
  verificationFile,
} from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';

/**
 * Journeys are the main behavioral tests, so each feature that ships has one.
 * This check rejects:
 *
 * - A feature with a screen that an app ships, but no journey for that app's
 *   platform. The web app is `apps/web`. A native app has the Nx tag
 *   `platform:native`.
 * - A journey with no spec header: the `<id>: <goal>` line, `Contract:`,
 *   `Entry:` and `Isolation and cleanup:`.
 * - A journey that the verify config does not register as a flow, and a flow
 *   that runs a journey that does not exist.
 *
 * See docs/contributing/setup/verification.md#journeys.
 */
const requiredFields = ['Contract', 'Entry', 'Isolation and cleanup'];
const platforms = { web: '.pw.ts', native: '.maestro.yaml' } as const;

type Flow = { platform?: string; commands?: Array<Array<string>> };

function readJson(file: string) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : undefined;
}

/** Each platform that ships a feature: an app that depends on it. */
function shippedOn(root: string, feature: string): Array<keyof typeof platforms> {
  const apps = path.join(root, 'apps');
  if (!existsSync(apps)) {
    return [];
  }
  const found = new Set<keyof typeof platforms>();
  for (const app of readdirSync(apps)) {
    const manifest = readJson(path.join(apps, app, 'package.json'));
    if (!manifest?.dependencies?.[`@features/${feature}`]) {
      continue;
    }
    if (app === 'web') {
      found.add('web');
    }
    if ((manifest.nx?.tags ?? []).includes('platform:native')) {
      found.add('native');
    }
  }
  return [...found];
}

/** Whether the feature has a screen file. A feature with no screen has nothing to drive yet. */
function hasScreen(root: string, feature: string): boolean {
  const screens = path.join(root, 'features', feature, 'screens');
  return existsSync(screens) && readdirSync(screens).some((name) => name !== '.gitkeep');
}

function missingJourneys(root: string, all: ReadonlyArray<Journey>): Array<string> {
  const features = existsSync(path.join(root, 'features'))
    ? readdirSync(path.join(root, 'features'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  return features
    .filter((feature) => hasScreen(root, feature))
    .flatMap((feature) =>
      shippedOn(root, feature)
        .filter(
          (platform) =>
            !all.some((journey) => journey.feature === feature && journey.platform === platform),
        )
        .map(
          (platform) =>
            `features/${feature}: the ${platform} app ships it, but it has no ${platform} journey. Add features/${feature}/journeys/<id>${platforms[platform]} with the spec header from .agents/skills/setup-verification/references/journey-specification.md.`,
        ),
    );
}

function headerProblems(root: string, journey: Journey): Array<string> {
  const header = headerOf(readFileSync(path.join(root, journey.file), 'utf-8'));
  const problems: Array<string> = [];
  if (!header[0]?.startsWith(`${journey.id}: `)) {
    problems.push(
      `${journey.file}: the header starts with \`${journey.id}: <user goal>\`. Write the goal on the first header line.`,
    );
  }
  for (const name of requiredFields.filter((field) => fieldOf(header, field) === undefined)) {
    problems.push(`${journey.file}: the header has no \`${name}:\` line. Add it.`);
  }
  return problems;
}

function registrationProblems(root: string, all: ReadonlyArray<Journey>): Array<string> {
  const flows: Record<string, Flow> = readJson(path.join(root, verificationFile))?.flows ?? {};
  const problems: Array<string> = [];
  for (const journey of all) {
    const flow = flows[journey.id];
    const command = JSON.stringify([journeyCommand(journey.id)]);
    if (flow?.platform !== journey.platform || JSON.stringify(flow.commands) !== command) {
      problems.push(
        `${journey.file}: ${verificationFile} does not register it. Add the flow \`${journey.id}\` with \`"platform": "${journey.platform}"\` and \`"commands": ${command}\`.`,
      );
    }
  }
  const ids = new Set(all.map((journey) => journey.id));
  for (const [name, flow] of Object.entries(flows)) {
    for (const argv of flow.commands ?? []) {
      const at = argv.indexOf('journey');
      const id = argv[at + 1];
      if (at > 0 && argv[at - 1] === 'run' && id !== undefined && !ids.has(id)) {
        problems.push(
          `${verificationFile}: the flow \`${name}\` runs the journey \`${id}\`, which does not exist. Remove the flow, or restore the journey file.`,
        );
      }
    }
  }
  return problems;
}

export function checkJourneys(root: string): Array<string> {
  const all = journeys(root);
  const seen = new Map<string, string>();
  const duplicates = all.flatMap((journey) => {
    const other = seen.get(journey.id);
    seen.set(journey.id, journey.file);
    return other
      ? [`${journey.file}: ${other} has the same ID. Give each journey its own ID.`]
      : [];
  });
  return [
    ...duplicates,
    ...missingJourneys(root, all),
    ...all.flatMap((journey) => headerProblems(root, journey)),
    ...registrationProblems(root, all),
  ].toSorted();
}

if (import.meta.main) {
  const problems = checkJourneys(process.cwd());
  if (problems.length) {
    console.error(
      [
        `Journey check failed (${problems.length}).`,
        'See docs/contributing/setup/verification.md#journeys.',
        '',
        ...problems,
      ].join('\n'),
    );
    process.exitCode = 1;
  } else {
    console.log('Each shipped feature has a journey, and each journey is a registered flow.');
  }
}
