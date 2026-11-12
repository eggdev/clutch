import type { ManifestChange } from '@repo/sync/contract/change-doors';
import {
  canBeMissing,
  oneWay,
  same,
  split,
  twoWay,
  widens,
} from '@repo/sync/contract/change-doors';
import { jobChanges, routeChanges } from '@repo/sync/contract/compatibility-jobs';
import type {
  Manifest,
  ManifestCommand,
  ManifestLoad,
  ManifestRecord,
} from '@repo/sync/contract/manifest';

/**
 * The changes of one record. An installed build reads each record with its
 * own fields, so only a field that may be left out is safe to add. Each other
 * change makes the record read as missing on one side.
 */
function recordChanges(before: ManifestRecord, after: ManifestRecord): Array<ManifestChange> {
  const { name } = after;
  const changes: Array<ManifestChange> = [];
  const fields = new Set([...Object.keys(before.fields), ...Object.keys(after.fields)]);
  for (const field of fields) {
    const old = before.fields[field];
    const next = after.fields[field];
    const id = `${name}.${field}`;
    if (old === undefined && next !== undefined) {
      changes.push(
        canBeMissing(next)
          ? twoWay(`record-field-added:${id}`, `${name} gains the optional field ${field}.`)
          : oneWay(
              `record-field-added:${id}`,
              `${name} gains the required field ${field}. A record that a device saved without it reads as missing.`,
            ),
      );
    } else if (old !== undefined && next === undefined) {
      changes.push(
        oneWay(
          `record-field-removed:${id}`,
          `${name} loses the field ${field}. An installed build that reads it sees the record as missing.`,
        ),
      );
    } else if (!same(old, next)) {
      changes.push(
        oneWay(
          `record-field-changed:${id}`,
          `${name}.${field} changes its kind. An installed build reads a value of the other kind as a missing record.`,
        ),
      );
    }
  }
  if (!same(before.groups, after.groups)) {
    changes.push(
      oneWay(
        `record-groups-changed:${name}`,
        `${name} moves from the groups ${before.groups.join(', ')} to ${after.groups.join(', ')}, so other clients get it.`,
      ),
    );
  }
  return changes;
}

function inputChanges(before: ManifestCommand, after: ManifestCommand): Array<ManifestChange> {
  const { name } = after;
  const changes: Array<ManifestChange> = [];
  const fields = new Set([...Object.keys(before.input), ...Object.keys(after.input)]);
  for (const field of fields) {
    const old = before.input[field];
    const next = after.input[field];
    const id = `${name}.${field}`;
    if (old === undefined && next !== undefined) {
      changes.push(
        canBeMissing(next)
          ? twoWay(`command-input-added:${id}`, `${name} takes the optional input ${field}.`)
          : oneWay(
              `command-input-added:${id}`,
              `${name} needs the input ${field}. A write that an installed build queued without it is refused.`,
            ),
      );
    } else if (old !== undefined && next === undefined) {
      changes.push(
        twoWay(`command-input-removed:${id}`, `${name} stops reading the input ${field}.`),
      );
    } else if (old !== undefined && next !== undefined && !same(old, next)) {
      changes.push(
        widens(old, next)
          ? twoWay(
              `command-input-changed:${id}`,
              `${name}.${field} takes each value that it took before, and more.`,
            )
          : oneWay(
              `command-input-changed:${id}`,
              `${name}.${field} takes fewer values. A write that an installed build queued with another value is refused.`,
            ),
      );
    }
  }
  return changes;
}

function commandChanges(before: ManifestCommand, after: ManifestCommand): Array<ManifestChange> {
  const { name } = after;
  const changes = inputChanges(before, after);
  if (before.waits !== after.waits) {
    changes.push(
      twoWay(`command-waits-changed:${name}`, `${name} waits for the ${after.waits} change.`),
    );
  }
  if (before.access !== after.access || before.permission !== after.permission) {
    changes.push(
      oneWay(
        `command-access-changed:${name}`,
        `${name} changes who may run it: ${after.access}${after.permission ? ` with ${after.permission}` : ''}.`,
      ),
    );
  }
  if (!same(before.refuses, after.refuses)) {
    changes.push(
      twoWay(
        `command-refusals-changed:${name}`,
        `${name} refuses with: ${after.refuses.join(', ') || 'no code of its own'}. An installed build reads a code it does not know as \`failed\`.`,
      ),
    );
  }
  if (!same(before.tool, after.tool)) {
    changes.push(
      after.tool === 'none'
        ? oneWay(
            `command-tool-removed:${name}`,
            `${name} stops being a tool, so an agent that calls it fails.`,
          )
        : twoWay(`command-tool-changed:${name}`, `${name} changes what it says or does as a tool.`),
    );
  }
  return changes;
}

function loadChanges(before: ManifestLoad, after: ManifestLoad): Array<ManifestChange> {
  const { name } = after;
  const changes: Array<ManifestChange> = [];
  if (before.record !== after.record || before.group !== after.group) {
    changes.push(
      twoWay(`load-changed:${name}`, `${name} loads ${after.record} by ${after.group}.`),
    );
  }
  if (!same(before.tool, after.tool)) {
    changes.push(
      after.tool === 'none'
        ? oneWay(
            `load-tool-removed:${name}`,
            `${name} stops being a read tool, so an agent that calls it fails.`,
          )
        : twoWay(`load-tool-changed:${name}`, `${name} changes what an agent reads through it.`),
    );
  }
  return changes;
}

/**
 * Each difference between two manifests, sorted by ID. An empty list means
 * the two builds speak the same protocol.
 */
export function compareManifests(before: Manifest, after: Manifest): Array<ManifestChange> {
  const records = split(before.records, after.records);
  const commands = split(before.commands, after.commands);
  const loads = split(before.loads, after.loads);
  return [
    ...jobChanges(before.jobs, after.jobs),
    ...routeChanges(before.routes, after.routes),
    ...records.removed.map(({ name }) =>
      oneWay(
        `record-removed:${name}`,
        `${name} is gone. An installed build still holds and reads its records.`,
      ),
    ),
    ...records.added.map(({ name }) =>
      twoWay(`record-added:${name}`, `${name} is a record of its own.`),
    ),
    ...records.kept.flatMap(([old, next]) => recordChanges(old, next)),
    ...commands.removed.map(({ name }) =>
      oneWay(
        `command-removed:${name}`,
        `${name} is gone. An installed build still sends it, and each of those writes is refused.`,
      ),
    ),
    ...commands.added.map(({ name }) =>
      twoWay(`command-added:${name}`, `${name} is a command of its own.`),
    ),
    ...commands.kept.flatMap(([old, next]) => commandChanges(old, next)),
    ...loads.removed.map(({ name }) => twoWay(`load-removed:${name}`, `${name} is gone.`)),
    ...loads.added.map(({ name }) =>
      twoWay(`load-added:${name}`, `${name} is a load function of its own.`),
    ),
    ...loads.kept.flatMap(([old, next]) => loadChanges(old, next)),
  ].toSorted((a, b) => a.id.localeCompare(b.id));
}
