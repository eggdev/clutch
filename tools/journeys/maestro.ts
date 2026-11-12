import type { JourneyData, Step, Target } from '@repo/journeys/types/steps';
import { stringify } from 'yaml';

/**
 * Compiles a journey in data form to a Maestro flow, so one journey runs on
 * web and on a device. The flow is linear, so the clicks of each outcome are
 * known before the run: the native runner checks them against the click
 * budget of a core journey. A step with no native form must carry
 * `webOnly(...)`, or the compile fails. See
 * docs/contributing/end-to-end-testing.md#data-journeys.
 *
 * The first launch of a flow clears the state of the app, as a web run starts
 * in a new browser context. Each launch passes the arguments of the run, such
 * as its development organization, so a run starts with no record of another.
 */

/** What the compile needs beside the journey and the app ID. */
export type FlowOptions = {
  /** The platform of the device. A step with no form on it is left out, and `left` says so. */
  readonly platform?: 'ios' | 'android';
  /** The launch arguments of the app, on each launch of the flow. */
  readonly arguments?: Readonly<Record<string, string>>;
  /** The URL scheme of the app, which a step that opens a path needs. */
  readonly scheme?: string;
  /** Where a `tool` step calls the agent tools, and the headers that name the actor of the run. */
  readonly tools?: { readonly url: string; readonly headers: Readonly<Record<string, string>> };
};

/** The Maestro flow of a journey, the clicks before each outcome, and what the flow leaves out. */
export type MaestroFlow = {
  readonly flow: string;
  readonly outcomes: ReadonlyArray<{ readonly name: string; readonly clicks: number }>;
  readonly left: ReadonlyArray<string>;
};

/** How many characters a `fill` erases before it types. */
const eraseLength = 100;

/** How long a `see` waits for the target, in milliseconds, when the step names no `within`. */
const defaultWait = 10_000;

/** Maestro reads text as a pattern, so each character of the text is escaped. */
function escapePattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** The text that a target matches on the device. */
function textOf(target: Target): string {
  if (target.kind === 'field') {
    return target.label;
  }
  if (target.kind === 'text') {
    return target.text;
  }
  return target.name;
}

/** The value text that a `fieldWith` target matches on the device, or the label of a field. */
function selectorOf(target: Target): { text: string } {
  if (target.kind === 'field' && target.value !== undefined) {
    return { text: escapePattern(target.value) };
  }
  return { text: escapePattern(textOf(target)) };
}

/** The launch of the app. The first launch of a flow clears the state of the app. */
function launchOf(first: boolean, options: FlowOptions): unknown {
  const launch = {
    ...(first ? { clearState: true } : {}),
    ...(options.arguments ? { arguments: options.arguments } : {}),
  };
  return Object.keys(launch).length ? { launchApp: launch } : 'launchApp';
}

/** The script that posts one call of an agent tool from the machine that drives the device. */
function postOf(
  name: string,
  input: Readonly<Record<string, unknown>>,
  number: number,
  what: string,
  options: FlowOptions,
): string {
  if (!options.tools) {
    throw new Error(
      `Step ${number} (${what}) calls ${name}, and the run names no API to call. Give the compile its \`tools\` option.`,
    );
  }
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `step-${number}`,
    method: 'tools/call',
    params: { name, arguments: input },
  });
  const headers = JSON.stringify({ 'content-type': 'application/json', ...options.tools.headers });
  return `http.post(${JSON.stringify(options.tools.url)}, {headers: ${headers}, body: ${JSON.stringify(body)}})`;
}

/** How many times the flow asks the server before a `serverHolds` step fails. */
const asks = 50;

/**
 * The check of what the server holds. The script asks the list tool of a load
 * function, as the web run does, and asks again until the values match: a
 * write of the device reaches the server a moment later.
 */
function serverHoldsCommands(
  step: Extract<Step, { do: 'server-holds' }>,
  number: number,
  options: FlowOptions,
): Array<unknown> {
  const post = postOf(step.tool, { id: step.id, limit: 200 }, number, 'serverHolds', options);
  const want = JSON.stringify(JSON.stringify(step.values.toSorted()));
  const read = `JSON.stringify(JSON.parse(${post}.body).result.structuredContent.items.map(function (item) { return String(item[${JSON.stringify(step.field)}]); }).sort())`;
  const held = `output.held${number}`;
  return [
    {
      evalScript: `\${${held} = (function () { var held = null; for (var ask = 0; ask < ${asks} && held !== ${want}; ask += 1) { held = ${read}; } return held; })()}`,
    },
    {
      assertTrue: {
        condition: `\${${held} === ${want}}`,
        label: `The server holds the ${step.field} values: ${step.values.toSorted().join(', ')}`,
      },
    },
  ];
}

/**
 * The call of an agent tool. Maestro runs the script on the machine that
 * drives the device, so the call reaches the API from outside the app, as an
 * agent does. A later `see` on the device then proves that the write came
 * through the server. The check fails the flow when the tool refuses.
 */
function toolCommands(
  step: Extract<Step, { do: 'tool' }>,
  number: number,
  options: FlowOptions,
): Array<unknown> {
  const post = postOf(step.name, step.input, number, 'tool', options);
  const reply = `output.tool${number}`;
  return [
    { evalScript: `\${${reply} = ${post}}` },
    {
      assertTrue: {
        condition: `\${${reply}.ok && JSON.parse(${reply}.body).result !== undefined && JSON.parse(${reply}.body).result.isError !== true}`,
        label: `The agent tool ${step.name} answers with no refusal`,
      },
    },
  ];
}

/** The Maestro commands of one step that is not a launch, or the reason it has none. */
function commandsOf(step: Step, number: number, options: FlowOptions): Array<unknown> {
  if (step.do === 'open') {
    if (!options.scheme) {
      throw new Error(
        `Step ${number} (open) opens ${step.path}, and the app names no URL scheme. Set expo.scheme in its app.json.`,
      );
    }
    return [{ openLink: `${options.scheme}://${step.path.replace(/^\//u, '')}` }];
  }
  if (step.do === 'tap') {
    return [{ tapOn: selectorOf(step.target) }];
  }
  if (step.do === 'fill') {
    return [
      { tapOn: selectorOf(step.target) },
      { eraseText: eraseLength },
      { inputText: step.text },
    ];
  }
  if (step.do === 'submit') {
    return [{ pressKey: 'Enter' }];
  }
  if (step.do === 'see') {
    return [
      {
        extendedWaitUntil: {
          visible: selectorOf(step.target),
          timeout: step.within ?? defaultWait,
        },
      },
    ];
  }
  if (step.do === 'gone') {
    return [{ assertNotVisible: selectorOf(step.target) }];
  }
  if (step.do === 'offline') {
    return [{ setAirplaneMode: step.offline ? 'enabled' : 'disabled' }];
  }
  if (step.do === 'shot') {
    return [{ takeScreenshot: step.name }];
  }
  if (step.do === 'tool') {
    return toolCommands(step, number, options);
  }
  if (step.do === 'server-holds') {
    return serverHoldsCommands(step, number, options);
  }
  if (step.do === 'outcome' && step.expected.text !== undefined) {
    return [
      {
        assertVisible: {
          ...selectorOf({ kind: 'text', text: step.expected.text }),
          label: `outcome ${step.name}`,
        },
      },
    ];
  }
  throw new Error(
    `Step ${number} (${step.do}) has no native form. Mark it with webOnly(...) if the native flow does not need it.`,
  );
}

/**
 * The sentence for a step that the flow leaves out, or null for a step that it
 * runs. A web-only step needs its reason, and a step of the second device
 * needs the web-only mark: without either, the compile stops.
 */
function leftOut(step: Step, number: number, options: FlowOptions): string | null {
  if (step.only === 'web') {
    if (!step.why) {
      throw new Error(
        `Step ${number} (${step.do}) is web only with no reason. Give webOnly(...) the reason as its second argument.`,
      );
    }
    return `Step ${number} (${step.do}) runs on web only: ${step.why}.`;
  }
  if (step.on === 'second') {
    throw new Error(
      `Step ${number} (${step.do}) runs on the second device, which has no native form. Mark it with webOnly(...) if the native flow does not need it.`,
    );
  }
  // A simulator shares the network of its host, and Maestro cannot cut it.
  return step.do === 'offline' && options.platform === 'ios'
    ? `Step ${number} (offline) has no form on iOS, so the iOS flow stays online and does not prove it.`
    : null;
}

/** A step that acts: a tap, a fill, a submit or a tool call. */
type Act = { readonly number: number; readonly does: string };

/** The steps that check what an act did. */
const checkSteps = new Set<Step['do']>(['see', 'gone', 'outcome', 'server-holds']);

/**
 * The last act that no later step checks, after this step. A `see`, a `gone`
 * or an `outcome` on the device checks any act. The server proves an act of
 * the device. It proves nothing about a tool call, which wrote to the server
 * itself, so a tool call needs a check on the device.
 */
function uncheckedAfter(step: Step, number: number, before: Act | null): Act | null {
  if (step.do === 'tap' || step.do === 'fill' || step.do === 'submit' || step.do === 'tool') {
    return { number, does: step.do };
  }
  if (step.do === 'server-holds') {
    return before?.does === 'tool' ? before : null;
  }
  return checkSteps.has(step.do) ? null : before;
}

/** Compiles the journey to a Maestro flow for the app `appId`. */
export function toMaestro(
  journey: JourneyData,
  appId: string,
  options: FlowOptions = {},
): MaestroFlow {
  const commands: Array<unknown> = [];
  let launched = false;
  const outcomes: Array<{ name: string; clicks: number }> = [];
  const left: Array<string> = [];
  let clicks = 0;
  let marked = 0;
  let checks = 0;
  let unchecked: Act | null = null;
  for (const [index, step] of journey.steps.entries()) {
    const number = index + 1;
    const skipped = leftOut(step, number, options);
    if (skipped !== null) {
      left.push(skipped);
      continue;
    }
    if (step.do === 'open' && step.path === '/') {
      commands.push(launchOf(!launched, options));
      launched = true;
    } else {
      commands.push(...commandsOf(step, number, options));
    }
    if (step.do === 'tap' || step.do === 'submit') {
      clicks += 1;
    }
    unchecked = uncheckedAfter(step, number, unchecked);
    checks += checkSteps.has(step.do) ? 1 : 0;
    if (step.do === 'outcome') {
      outcomes.push({ name: step.name, clicks: clicks - marked });
      marked = clicks;
    }
  }
  if (unchecked !== null) {
    throw new Error(
      `Step ${unchecked.number} (${unchecked.does}) is the last act of the native flow, and no \`see\`, \`gone\` or \`outcome\` follows it on the device. Add one, or the flow does not prove that step.`,
    );
  }
  if (checks === 0) {
    throw new Error(
      'The native flow has no `see`, `gone` or `outcome` step, so it would pass and prove nothing. Give it one that is not web only.',
    );
  }
  return {
    flow: `${stringify({ appId }).trimEnd()}\n---\n${stringify(commands, { aliasDuplicateObjects: false, lineWidth: 0 })}`,
    outcomes,
    left,
  };
}
