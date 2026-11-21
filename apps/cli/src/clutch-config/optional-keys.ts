import { isObject, isStringList, unknownKeys } from '@/clutch-config/checks';
import type { Errors } from '@/clutch-config/checks';
import { readIntake } from '@/clutch-config/intake';

/** Readers for the newest optional top-level keys of `clutch.yaml`, which schema.ts calls. */

export function readDeploy(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'deploy', message: 'Expected a map with command and url.' });
    return;
  }
  unknownKeys(value, ['command', 'url'], 'deploy', errors);
  const { command, url } = value;
  const before = errors.length;
  if (!isStringList(command) || command.length === 0) {
    errors.push({ path: 'deploy.command', message: 'Expected the command as a list of words.' });
  }
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    errors.push({ path: 'deploy.url', message: 'Expected an https URL.' });
  }
  return errors.length === before
    ? { command: command as Array<string>, url: url as string }
    : undefined;
}

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

/** What `bun run pr open` does with a change that has a missing verify flow. */
export const verificationGates = ['off', 'observe', 'enforce'] as const;

export function readVerification(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'verification', message: 'Expected a map with gate.' });
    return;
  }
  unknownKeys(value, ['gate'], 'verification', errors);
  const { gate } = value;
  if (!verificationGates.some((mode) => mode === gate)) {
    errors.push({
      path: 'verification.gate',
      message: `Expected ${verificationGates.join(', ')}.`,
    });
    return;
  }
  return { gate: gate as (typeof verificationGates)[number] };
}

/** `tickets.prefix`: the part of a ticket id before the number, such as `CL`. */
export function readTickets(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'tickets', message: 'Expected a map with prefix.' });
    return;
  }
  unknownKeys(value, ['prefix'], 'tickets', errors);
  if (typeof value.prefix !== 'string' || !/^[A-Z][A-Z0-9]*$/u.test(value.prefix)) {
    errors.push({ path: 'tickets.prefix', message: 'Expected capital letters, such as CL.' });
    return;
  }
  return { prefix: value.prefix };
}

export function readPr(value: unknown, errors: Errors) {
  if (!isObject(value)) {
    errors.push({ path: 'pr', message: 'Expected a map with branchPrefix.' });
    return;
  }
  unknownKeys(value, ['branchPrefix'], 'pr', errors);
  if (typeof value.branchPrefix !== 'string' || !/^[\w./-]+$/u.test(value.branchPrefix)) {
    errors.push({
      path: 'pr.branchPrefix',
      message: 'Expected a branch prefix, such as clutch/cl-.',
    });
    return;
  }
  return { branchPrefix: value.branchPrefix };
}
