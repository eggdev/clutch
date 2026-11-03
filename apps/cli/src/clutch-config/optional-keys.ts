import { isObject, isStringList, unknownKeys } from '@/clutch-config/checks';
import type { Errors } from '@/clutch-config/checks';

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
  if (!isObject(value)) {
    errors.push({ path: 'journeys', message: 'Expected a map with webApp.' });
    return;
  }
  unknownKeys(value, ['webApp'], 'journeys', errors);
  if (typeof value.webApp !== 'string' || !webAppPattern.test(value.webApp)) {
    errors.push({
      path: 'journeys.webApp',
      message: 'Expected the folder of an app under apps/, such as apps/app.',
    });
    return;
  }
  return { webApp: value.webApp };
}
