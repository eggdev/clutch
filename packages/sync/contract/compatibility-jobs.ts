import type { ManifestChange } from '@repo/sync/contract/change-doors';
import {
  canBeMissing,
  oneWay,
  same,
  split,
  twoWay,
  widens,
} from '@repo/sync/contract/change-doors';
import type { ManifestJob, ManifestKind, ManifestRoute } from '@repo/sync/contract/manifest';

/**
 * The changes of the jobs and the HTTP routes between two manifests. A job
 * payload and a route body take the field rule of a command input, with the
 * ids of their own prefix. See compatibility.ts for the rest.
 */

/**
 * The changes of the fields of a payload or a body. A queued job holds its
 * old payload, so an added required field, a removed field and a narrowed
 * field are one-way. An added optional field and a widened field are two-way.
 */
function fieldChanges(
  prefix: 'job-payload' | 'route-body',
  name: string,
  before: Readonly<Record<string, ManifestKind>>,
  after: Readonly<Record<string, ManifestKind>>,
): Array<ManifestChange> {
  const changes: Array<ManifestChange> = [];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const field of fields) {
    const old = before[field];
    const next = after[field];
    const id = `${name}.${field}`;
    if (old === undefined && next !== undefined) {
      changes.push(
        canBeMissing(next)
          ? twoWay(
              `${prefix}-added:${id}`,
              `${name} takes the optional ${field}, which a caller may leave out.`,
            )
          : oneWay(
              `${prefix}-added:${id}`,
              `${name} needs ${field}. A queued payload or a request that an installed build sends without it is refused.`,
            ),
      );
    } else if (old !== undefined && next === undefined) {
      changes.push(
        oneWay(
          `${prefix}-removed:${id}`,
          `${name} stops taking ${field}. A queued payload that still holds it reads with the old shape.`,
        ),
      );
    } else if (old !== undefined && next !== undefined && !same(old, next)) {
      changes.push(
        widens(old, next)
          ? twoWay(
              `${prefix}-widened:${id}`,
              `${name}.${field} takes each value that it took before, and more.`,
            )
          : oneWay(
              `${prefix}-changed:${id}`,
              `${name}.${field} takes fewer values. A queued payload or a request with another value is refused.`,
            ),
      );
    }
  }
  return changes;
}

/** The changes between two job lists. A job that goes is one-way, because a queued job of its name can no longer run. */
export function jobChanges(
  before: ReadonlyArray<ManifestJob>,
  after: ReadonlyArray<ManifestJob>,
): Array<ManifestChange> {
  const jobs = split(before, after);
  return [
    ...jobs.removed.map(({ name }) =>
      oneWay(
        `job-removed:${name}`,
        `${name} is gone. A queued job of that name can no longer run.`,
      ),
    ),
    ...jobs.added.map(({ name }) => twoWay(`job-added:${name}`, `${name} is a job of its own.`)),
    ...jobs.kept.flatMap(([old, next]) =>
      fieldChanges('job-payload', next.name, old.payload, next.payload),
    ),
  ];
}

/** The change of a route body as a whole: `'none'` to fields is one-way, and fields to `'none'` is two-way. */
function bodyChanges(
  name: string,
  before: ManifestRoute['body'],
  after: ManifestRoute['body'],
): Array<ManifestChange> {
  if (same(before, after)) {
    return [];
  }
  if (before === 'none' && after !== 'none') {
    return [
      oneWay(
        `route-body-changed:${name}`,
        `${name} reads a body now. A caller that sends no body fails.`,
      ),
    ];
  }
  if (before !== 'none' && after === 'none') {
    return [
      twoWay(
        `route-body-changed:${name}`,
        `${name} reads no body now, so a body that a caller sends is ignored.`,
      ),
    ];
  }
  if (before === 'none' || after === 'none') {
    return [];
  }
  return fieldChanges('route-body', name, before, after);
}

/** The changes of a route that stays: its method and path, its body, and what it says. */
function keptRoute(old: ManifestRoute, next: ManifestRoute): Array<ManifestChange> {
  const { name } = next;
  const changes: Array<ManifestChange> = [];
  if (old.method !== next.method || old.path !== next.path) {
    changes.push(
      oneWay(
        `route-moved:${name}`,
        `${name} answers ${next.method} ${next.path}. A caller of the old method or path fails.`,
      ),
    );
  }
  changes.push(...bodyChanges(name, old.body, next.body));
  if (old.says !== next.says) {
    changes.push(
      twoWay(`route-described:${name}`, `${name} changes who calls it and why, in its words.`),
    );
  }
  return changes;
}

/** The changes between two route lists. A route that goes is one-way, because an outside system still calls it. */
export function routeChanges(
  before: ReadonlyArray<ManifestRoute>,
  after: ReadonlyArray<ManifestRoute>,
): Array<ManifestChange> {
  const routes = split(before, after);
  return [
    ...routes.removed.map(({ name }) =>
      oneWay(`route-removed:${name}`, `${name} is gone. An outside system that calls it fails.`),
    ),
    ...routes.added.map(({ name }) =>
      twoWay(`route-added:${name}`, `${name} is a route of its own.`),
    ),
    ...routes.kept.flatMap(([old, next]) => keptRoute(old, next)),
  ];
}
