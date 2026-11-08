import { isObject, isStringList, unknownKeys } from '@/clutch-config/checks';
import type { Errors } from '@/clutch-config/checks';
import { readIntake } from '@/clutch-config/intake';

/** Readers for the newest optional top-level keys of `clutch.yaml`, which schema.ts calls. */

export function readAutoRevert(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'autoRevert', message: 'Expected a map with watch.' });
    return;
  }
  unknownKeys(value, ['watch'], 'autoRevert', errors);
  const { watch = [] } = value;
  if (!isStringList(watch) || watch.some((name) => !name.trim())) {
    errors.push({
      path: 'autoRevert.watch',
      message: 'Expected a list of check or job names, such as production.',
    });
    return;
  }
  return { watch: watch.map((name) => name.trim()) };
}

/** `journeys.webApp` is the folder of an app under apps/, such as apps/app. */
const webAppPattern = /^apps\/[\w.-]+$/u;

export function readJourneys(value: unknown, errors: Errors) {
  if (!isObject(value) || (value.webApp === undefined && value.inbox === undefined)) {
    errors.push({ path: 'journeys', message: 'Expected a map with webApp or inbox.' });
    return;
  }
  unknownKeys(value, ['webApp', 'inbox'], 'journeys', errors);
  const before = errors.length;
  const { webApp, inbox } = value;
  if (webApp !== undefined && (typeof webApp !== 'string' || !webAppPattern.test(webApp))) {
    errors.push({
      path: 'journeys.webApp',
      message: 'Expected the folder of an app under apps/, such as apps/app.',
    });
  }
  const isCommand =
    Array.isArray(inbox) &&
    inbox.length > 0 &&
    inbox.every((part) => typeof part === 'string' && part.trim() !== '');
  if (inbox !== undefined && !isCommand) {
    errors.push({
      path: 'journeys.inbox',
      message: 'Expected a command as a list of strings, such as [bun, tools/inbox.ts].',
    });
  }
  if (errors.length > before) {
    return;
  }
  return {
    ...(webApp === undefined ? {} : { webApp: webApp as string }),
    ...(inbox === undefined ? {} : { inbox: inbox as Array<string> }),
  };
}

/**
 * `factory.root` is the folder of the factory tree, from the project root.
 * It stays inside the project, so `.` is allowed and `..` is not.
 * `factory.intake` names the work that is ready for the factory.
 */
export function readFactory(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'factory', message: 'Expected a map with root or intake.' });
    return;
  }
  unknownKeys(value, ['root', 'intake'], 'factory', errors);
  const before = errors.length;
  const { root } = value;
  if (
    root !== undefined &&
    (typeof root !== 'string' ||
      !root.trim() ||
      root.startsWith('/') ||
      root.split(/[\\/]/u).includes('..'))
  ) {
    errors.push({
      path: 'factory.root',
      message: 'Expected a folder inside the project, such as factory or .',
    });
  }
  const intake = value.intake === undefined ? undefined : readIntake(value.intake, errors);
  if (errors.length > before) {
    return;
  }
  return {
    ...(root === undefined ? {} : { root: root as string }),
    ...(intake === undefined ? {} : { intake }),
  };
}
