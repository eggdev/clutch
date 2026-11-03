import type { ConfigError } from '@/clutch-config/schema';

export type Errors = Array<ConfigError>;
export type Data = Record<string, unknown>;

export function isObject(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringList(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Adds an error for each key of `data` that `allowed` does not name. */
export function unknownKeys(data: Data, allowed: Array<string>, at: string, errors: Errors) {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      errors.push({ path: at ? `${at}.${key}` : key, message: 'Unknown key.' });
    }
  }
}
