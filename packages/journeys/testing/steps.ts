/**
 * The step builders of a journey in data form. A journey file calls them to
 * write its steps, and `journey()` in `./journey` runs them on web. The types
 * of the steps are in `@repo/journeys/types/steps`, so the native compiler reads
 * them without a browser. See docs/contributing/end-to-end-testing.md#data-journeys.
 */

import type { OutcomeExpected, Step, Target } from '@repo/journeys/types/steps';
import type { CommandDeclaration } from '@repo/sync/contract/command';
import type { CallOf, Fields } from '@repo/sync/contract/fields';
import type { Load, RecordDeclaration, RecordFields } from '@repo/sync/contract/record';
import { toolName } from '@repo/sync/contract/tools';

/** A button, by its accessible name. */
export function button(name: string): Target {
  return { kind: 'button', name };
}

/** A heading, by its accessible name and its level when the page has more than one. */
export function heading(name: string, level?: number): Target {
  return level === undefined ? { kind: 'heading', name } : { kind: 'heading', name, level };
}

/** A field, by its label. */
export function field(label: string): Target {
  return { kind: 'field', label };
}

/** The field with that label whose saved value is `value`. It tells apart two fields of one label. */
export function fieldWith(label: string, value: string): Target {
  return { kind: 'field', label, value };
}

/** Visible text, matched exactly. */
export function text(value: string): Target {
  return { kind: 'text', text: value };
}

/** Opens a path. The first step of a journey usually opens `/`. */
export function open(path: string): Step {
  return { do: 'open', path };
}

/** Taps or clicks a target. */
export function tap(target: Target): Step {
  return { do: 'tap', target };
}

/** Replaces the text of a field. */
export function fill(target: Target, value: string): Step {
  return { do: 'fill', target, text: value };
}

/** Presses Enter in a field. */
export function submit(target: Target): Step {
  return { do: 'submit', target };
}

/** Expects a target to be visible. `within` sets the wait in milliseconds. */
export function see(target: Target, options: { within?: number } = {}): Step {
  return options.within === undefined
    ? { do: 'see', target }
    : { do: 'see', target, within: options.within };
}

/** Expects no element of a target. */
export function gone(target: Target): Step {
  return { do: 'gone', target };
}

/** Turns the network of the device off, or back on. */
export function offline(value: boolean): Step {
  return { do: 'offline', offline: value };
}

/**
 * Moves the clock of the device forward, and fires each timer that comes due.
 * The journey owns the clock, so it never waits for a retry or a delay: it
 * moves past it. A device has no such clock, so the step runs on web only.
 */
export function advance(ms: number): Step {
  return { do: 'advance', ms };
}

/**
 * Calls the agent tool of a command through `/mcp`, as the same person. The
 * tool name and the input come from the command declaration, so a rename or a
 * wrong field fails to compile. A command with `tool: 'none'` throws here, when
 * the journey file loads.
 */
export function tool<Name extends string, F extends Fields>(
  declared: CommandDeclaration<Name, F>,
  input: CallOf<F>,
): Step {
  if (declared.tool === 'none') {
    throw new Error(
      `The command ${declared.name} offers no agent tool. Declare a \`tool\` for it in its contract, or drop this step.`,
    );
  }
  return { do: 'tool', name: toolName(declared.name), input };
}

/** Waits until the device has no command without an answer from the server. */
export function settled(): Step {
  return { do: 'settled' };
}

/**
 * Expects the pool of the device to hold exactly the records of `record` whose
 * `field` values, sorted, equal `values`. The field must be one of the record.
 */
export function holds<Name extends string, F extends RecordFields>(
  record: RecordDeclaration<Name, F>,
  fieldName: keyof F & string,
  values: ReadonlyArray<string>,
): Step {
  return { do: 'holds', model: record.name, field: fieldName, values };
}

/**
 * Expects the server to hold exactly the records of one group whose `field`
 * values, sorted, equal `values`. `declared` is a load function, and `id`
 * names its group. The check asks the list tool of the load function, as an
 * agent does, so it has the same form on web and on a device. It asks again
 * for a short time, since a write of the device reaches the server a moment
 * later. A load function with `tool: 'none'`, or a field that its tool does
 * not list, throws here, when the journey file loads.
 */
export function serverHolds(
  declared: Load,
  id: string,
  fieldName: string,
  values: ReadonlyArray<string>,
): Step {
  if (declared.tool === 'none') {
    throw new Error(
      `The load function ${declared.name} offers no agent tool, so a journey cannot ask the server through it. Declare a \`tool\` for it in its contract, or drop this step.`,
    );
  }
  if (!declared.tool.fields.includes(fieldName)) {
    throw new Error(
      `The list tool of ${declared.name} gives no \`${fieldName}\`. It gives: ${declared.tool.fields.join(', ')}.`,
    );
  }
  return {
    do: 'server-holds',
    tool: `${toolName(declared.name)}_list`,
    id,
    field: fieldName,
    values,
  };
}

/** Takes a screenshot under a name. `style` hides page parts that change. */
export function shot(name: string, options: { style?: string } = {}): Step {
  return options.style === undefined
    ? { do: 'shot', name }
    : { do: 'shot', name, style: options.style };
}

/** Runs axe on the page, and fails on a violation. */
export function accessible(name: string): Step {
  return { do: 'accessible', name };
}

/** Asserts an outcome of the journey, with the stable name of the catalog. */
export function outcome(name: string, expected: OutcomeExpected): Step {
  return { do: 'outcome', name, expected };
}

/** The step, run on the second device. */
export function onSecond<S extends Step>(step: S): S & { readonly on: 'second' } {
  return { ...step, on: 'second' };
}

/**
 * The step, left out of the native flow, with the reason it has no native
 * form. A step with no native form must carry this, and the native run prints
 * each reason, so a reader sees what the native flow does not prove.
 */
export function webOnly<S extends Step>(
  step: S,
  why: string,
): S & { readonly only: 'web'; readonly why: string } {
  return { ...step, only: 'web', why };
}
