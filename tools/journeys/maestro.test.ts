import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  accessible,
  advance,
  button,
  field,
  fill,
  gone,
  heading,
  offline,
  onSecond,
  open,
  outcome,
  see,
  shot,
  submit,
  tap,
  text,
  webOnly,
} from '@repo/journeys/testing/steps';
import type { JourneyData } from '@repo/journeys/types/steps';
import { toMaestro } from '@tools/journeys/maestro';
import { parse } from 'yaml';

const journey = (steps: JourneyData['steps']): JourneyData => ({ title: 'a visitor', steps });

test('a journey compiles to a Maestro flow with one command per step', () => {
  const result = toMaestro(
    journey([
      open('/'),
      see(button('Open notes')),
      tap(button('Open notes')),
      see(heading('General', 1)),
      fill(field('New note'), 'Milk'),
      submit(field('New note')),
      gone(text('Empty')),
      offline(true),
      shot('home'),
    ]),
    'com.example',
  );
  expect(result.flow).toBe(
    [
      'appId: com.example',
      '---',
      '- launchApp:',
      '    clearState: true',
      '- extendedWaitUntil:',
      '    visible:',
      '      text: Open notes',
      '    timeout: 10000',
      '- tapOn:',
      '    text: Open notes',
      '- extendedWaitUntil:',
      '    visible:',
      '      text: General',
      '    timeout: 10000',
      '- tapOn:',
      '    text: New note',
      '- eraseText: 100',
      '- inputText: Milk',
      '- pressKey: Enter',
      '- assertNotVisible:',
      '    text: Empty',
      '- setAirplaneMode: enabled',
      '- takeScreenshot: home',
      '',
    ].join('\n'),
  );
  expect(result.outcomes).toEqual([]);
  expect(result.left).toEqual([]);
});

test('each outcome counts the taps and submits since the one before it', () => {
  const result = toMaestro(
    journey([
      open('/'),
      tap(button('Sign up')),
      tap(button('Create account')),
      outcome('signed-up', { url: '/home', text: 'Welcome' }),
      tap(button('Verify email')),
      submit(field('Code')),
      outcome('email-verified', { text: 'Email verified' }),
      outcome('signed-out', { text: 'Signed out' }),
    ]),
    'com.example',
  );
  expect(result.outcomes).toEqual([
    { name: 'signed-up', clicks: 2 },
    { name: 'email-verified', clicks: 2 },
    { name: 'signed-out', clicks: 0 },
  ]);
  expect(result.flow).toContain(
    '- assertVisible:\n    text: Welcome\n    label: outcome signed-up',
  );
});

test('a web-only step is left out of the flow, and one sentence names it', () => {
  const result = toMaestro(
    journey([
      open('/'),
      webOnly(accessible('home'), 'axe reads a web page'),
      webOnly(onSecond(open('/')), 'a native run has one device'),
      tap(button('Open notes')),
      see(heading('General', 1)),
    ]),
    'com.example',
  );
  expect(result.flow.split('\n').filter((line) => line.startsWith('- tapOn'))).toHaveLength(1);
  expect(result.left).toEqual([
    'Step 2 (accessible) runs on web only: axe reads a web page.',
    'Step 3 (open) runs on web only: a native run has one device.',
  ]);
});

test('a web-only step with no reason does not compile', () => {
  const unexplained = { ...accessible('home'), only: 'web' as const };
  expect(() =>
    toMaestro(journey([open('/'), unexplained, see(button('Add'))]), 'com.example'),
  ).toThrow('Step 2 (accessible) is web only with no reason.');
});

test('a native flow with no check does not compile, since it would prove nothing', () => {
  expect(() => toMaestro(journey([open('/')]), 'com.example')).toThrow(
    'The native flow has no `see`, `gone` or `outcome` step',
  );
  expect(() =>
    toMaestro(
      journey([open('/'), webOnly(see(button('Add')), 'a native run has one device')]),
      'com.example',
    ),
  ).toThrow('The native flow has no `see`, `gone` or `outcome` step');
});

test('a step that opens a path uses the URL scheme of the app, and needs one', () => {
  const steps = journey([open('/notes'), see(heading('General', 1))]);
  expect(toMaestro(steps, 'com.example', { scheme: 'example' }).flow).toContain(
    'openLink: example://notes',
  );
  expect(() => toMaestro(steps, 'com.example')).toThrow(
    'Step 1 (open) opens /notes, and the app names no URL scheme.',
  );
});

test('a step with no native form and no webOnly mark fails the compile, and names the step', () => {
  expect(() => toMaestro(journey([open('/'), accessible('home')]), 'com.example')).toThrow(
    'Step 2 (accessible) has no native form. Mark it with webOnly(...) if the native flow does not need it.',
  );
  expect(() =>
    toMaestro(journey([open('/'), onSecond(tap(button('Add')))]), 'com.example'),
  ).toThrow('Step 2 (tap) runs on the second device, which has no native form.');
});

test('a native flow that ends on an act with no check after it does not compile', () => {
  // The check of the tap runs on web only, so the device would prove nothing about it.
  expect(() =>
    toMaestro(
      journey([
        open('/'),
        see(button('Add')),
        tap(button('Add')),
        webOnly(see(text('Added')), 'a native run has one device'),
      ]),
      'com.example',
    ),
  ).toThrow(
    'Step 3 (tap) is the last act of the native flow, and no `see`, `gone` or `outcome` follows it on the device.',
  );
});

test('a clock step has no native form, so it needs the web mark', () => {
  expect(() => toMaestro(journey([open('/'), advance(5000)]), 'com.example')).toThrow(
    'Step 2 (advance) has no native form.',
  );
  const marked = toMaestro(
    journey([open('/'), webOnly(advance(5000), 'the clock of the browser'), see(button('Add'))]),
    'com.example',
  );
  expect(marked.left).toHaveLength(1);
});

test('an outcome with a path and no text has no native form', () => {
  expect(() => toMaestro(journey([outcome('signed-up', { url: '/home' })]), 'com.example')).toThrow(
    'Step 1 (outcome) has no native form.',
  );
});

test('the first launch clears the state of the app, and each launch passes the arguments of the run', () => {
  const result = toMaestro(
    journey([open('/'), see(button('Open notes')), open('/'), see(button('Open notes'))]),
    'com.example',
    { arguments: { devOrganization: 'run-1' } },
  );
  expect(result.flow).toStartWith(
    [
      'appId: com.example',
      '---',
      '- launchApp:',
      '    clearState: true',
      '    arguments:',
      '      devOrganization: run-1',
    ].join('\n'),
  );
  expect(result.flow.match(/clearState/gu)).toHaveLength(1);
  expect(result.flow.match(/devOrganization: run-1/gu)).toHaveLength(2);
});

test('an offline step is left out of an iOS flow, and one sentence names it', () => {
  const steps = journey([open('/'), offline(true), see(button('Open notes'))]);
  const ios = toMaestro(steps, 'com.example', { platform: 'ios' });
  expect(ios.flow).not.toContain('setAirplaneMode');
  expect(ios.left).toEqual([
    'Step 2 (offline) has no form on iOS, so the iOS flow stays online and does not prove it.',
  ]);
  expect(toMaestro(steps, 'com.example', { platform: 'android' }).flow).toContain(
    'setAirplaneMode: enabled',
  );
});

test('a value with quotes and pattern characters is quoted and escaped', () => {
  const result = toMaestro(
    journey([tap(text('Save (draft) "now"')), see(text('Saved'))]),
    'com.example',
  );
  expect(result.flow).toContain('text: Save \\(draft\\) "now"');
});

const createTool = { do: 'tool', name: 'notes_create', input: { title: "Agent's note" } } as const;
const tools = {
  url: 'http://api.example.localhost:1355/mcp',
  headers: { 'x-dev-organization-id': 'run-1' },
};

/** Whether a loaded export is the data of a journey: a title and a list of steps. */
function isJourney(value: unknown): value is JourneyData {
  return typeof value === 'object' && value !== null && 'steps' in value && 'title' in value;
}

test('each data journey of this repository compiles to a native flow', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const files = [...new Bun.Glob('features/*/journeys/*.journey.ts').scanSync({ cwd: root })];
  const previous = process.env.JOURNEY_COMPILE;
  process.env.JOURNEY_COMPILE = '1';
  try {
    for (const file of files.toSorted()) {
      const loaded: Record<string, unknown> = await import(path.join(root, file));
      const found = Object.values(loaded).filter((value) => isJourney(value));
      // One journey to a file, and each step has a native form or the `webOnly` mark.
      expect({ file, journeys: found.length }).toEqual({ file, journeys: 1 });
      for (const data of found) {
        expect(toMaestro(data, 'com.example', { tools }).flow).toStartWith(
          'appId: com.example\n---\n',
        );
      }
    }
  } finally {
    if (previous === undefined) {
      delete process.env.JOURNEY_COMPILE;
    } else {
      process.env.JOURNEY_COMPILE = previous;
    }
  }
});

test('a tool step calls the API from the machine that drives the device, and a refusal fails the flow', () => {
  const { flow } = toMaestro(
    journey([open('/'), createTool, see(text("Agent's note"))]),
    'com.example',
    { tools },
  );
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'step-2',
    method: 'tools/call',
    params: { name: 'notes_create', arguments: { title: "Agent's note" } },
  });
  const headers = '{"content-type":"application/json","x-dev-organization-id":"run-1"}';
  const script = `\${output.tool2 = http.post("http://api.example.localhost:1355/mcp", {headers: ${headers}, body: ${JSON.stringify(body)}})}`;
  const reply = 'output.tool2';
  // The flow is YAML, so the script is read back from it as Maestro reads it.
  const commands: Array<Record<string, unknown>> = parse(flow.split('---\n')[1] ?? '');
  expect(commands[1]).toEqual({ evalScript: script });
  expect(commands[2]).toEqual({
    assertTrue: {
      condition: `\${${reply}.ok && JSON.parse(${reply}.body).result !== undefined && JSON.parse(${reply}.body).result.isError !== true}`,
      label: 'The agent tool notes_create answers with no refusal',
    },
  });
});

test('a tool step needs the API of the run, and a check on the device after it', () => {
  expect(() =>
    toMaestro(journey([open('/'), createTool, see(text('Note'))]), 'com.example'),
  ).toThrow('Step 2 (tool) calls notes_create, and the run names no API to call.');
  expect(() =>
    toMaestro(journey([open('/'), see(text('Notes')), createTool]), 'com.example', { tools }),
  ).toThrow('Step 3 (tool) is the last act of the native flow');
});

const heldTitles = {
  do: 'server-holds',
  tool: 'notes_of_space_list',
  id: 'general',
  field: 'title',
  values: ['Milk', 'Bread'],
} as const;

test('a serverHolds step asks the list tool until the sorted values match, and then checks them', () => {
  const { flow } = toMaestro(journey([open('/'), tap(button('Add')), heldTitles]), 'com.example', {
    tools,
  });
  const commands: Array<Record<string, unknown>> = parse(flow.split('---\n')[1] ?? '');
  const script = String(commands[2]?.evalScript);
  // The values that the script compares with: the sorted list, as JSON text, as a script string.
  const want = JSON.stringify(JSON.stringify(['Bread', 'Milk']));
  const held = 'output.held3';
  expect(script).toStartWith(
    `\${${held} = (function () { var held = null; for (var ask = 0; ask < 50 && held !== ${want}; ask += 1) {`,
  );
  expect(script).toContain(
    '\\"name\\":\\"notes_of_space_list\\",\\"arguments\\":{\\"id\\":\\"general\\",\\"limit\\":200}',
  );
  expect(script).toContain(
    '.result.structuredContent.items.map(function (item) { return String(item["title"]); }).sort()',
  );
  expect(commands[3]).toEqual({
    assertTrue: {
      condition: `\${${held} === ${want}}`,
      label: 'The server holds the title values: Bread, Milk',
    },
  });
});

test('the server proves an act of the device, and a tool call still needs a check on the device', () => {
  // The tap is proven by what the server holds, so the flow compiles.
  expect(
    toMaestro(journey([open('/'), tap(button('Add')), heldTitles]), 'com.example', { tools }).left,
  ).toEqual([]);
  expect(() =>
    toMaestro(journey([open('/'), createTool, heldTitles]), 'com.example', { tools }),
  ).toThrow('Step 2 (tool) is the last act of the native flow');
});
