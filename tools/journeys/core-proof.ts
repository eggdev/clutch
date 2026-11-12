import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  coreJourneys,
  coreWithout,
  fieldOf,
  headerOf,
  requiredOutcomes,
  webDevices,
} from '@tools/journeys/journeys';
import type { Journey } from '@tools/journeys/journeys';
import type { DeviceRun } from '@tools/journeys/measures';

/** Whether a journey's `Core:` line names a core journey. */
export function isCore(root: string, journey: Journey) {
  const name = fieldOf(headerOf(readFileSync(path.join(root, journey.file), 'utf-8')), 'Core');
  return name !== undefined && (coreJourneys as ReadonlyArray<string>).includes(name);
}

/**
 * The core journeys of a passed run that did not record each outcome that the
 * catalog names, `signed-up` first, on each device. The source checks read the
 * code. This reads what held in the browser, so a call that never ran proves
 * nothing. The last try of each device is the one that passed.
 */
export function unprovenCore(
  root: string,
  ran: ReadonlyArray<Journey>,
  runsOf: (journey: Journey) => ReadonlyArray<DeviceRun>,
): Array<string> {
  return ran.flatMap((journey) => {
    const name = fieldOf(headerOf(readFileSync(path.join(root, journey.file), 'utf-8')), 'Core');
    if (name === undefined || !(coreJourneys as ReadonlyArray<string>).includes(name)) {
      return [];
    }
    const runs = runsOf(journey);
    return webDevices.flatMap((device) => {
      const at = `${journey.file} on ${device.name}`;
      const last = runs.find((run) => run.device === device.name)?.attempts.at(-1);
      const seen = (last?.outcomes ?? []).map((outcome) => outcome.name);
      const missing = requiredOutcomes(
        name as (typeof coreJourneys)[number],
        coreWithout(root, name),
      ).filter((outcome) => !seen.includes(outcome));
      const problems: Array<string> = [];
      if (seen[0] !== 'signed-up') {
        problems.push(
          `${at}: the run did not record \`signed-up\` first, so it did not prove a new account. See docs/contributing/journeys/core.md.`,
        );
      }
      if (missing.length > 0) {
        problems.push(
          `${at}: the run passed, but recorded no ${missing.map((item) => `\`${item}\``).join(', ')}. Each catalog outcome must hold in the run. See docs/contributing/journeys/core.md.`,
        );
      }
      return problems;
    });
  });
}
