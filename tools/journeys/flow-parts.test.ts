import { expect, test } from 'bun:test';

import type { PostReply } from '@tools/journeys/flow-parts';
import { deviceFlow, flowOf, scriptHost, syncPost } from '@tools/journeys/flow-parts';

const source = [
  'appId: com.example.app',
  'env:',
  `  EMAIL: journey-\${RUN}@test.dev`,
  `  OWNER_EMAIL: owner-\${EMAIL}`,
  '---',
  "- tapOn: 'Email address'",
  `- inputText: \${EMAIL}`,
  `- evalScript: \${output.code = lookup(EMAIL)}`,
  `- inputText: \${output.code}`,
  '- takeScreenshot: signed-in',
  "- assertVisible: 'Settings'",
  '',
].join('\n');

test('a flow is cut at each script and screenshot step, and the device steps between two stay together', () => {
  const flow = flowOf(source);
  expect(flow.appId).toBe('com.example.app');
  expect(flow.config).toEqual({ appId: 'com.example.app' });
  expect(flow.env).toEqual([
    ['EMAIL', `journey-\${RUN}@test.dev`],
    ['OWNER_EMAIL', `owner-\${EMAIL}`],
  ]);
  expect(flow.parts).toEqual([
    {
      kind: 'device',
      first: 1,
      commands: [{ tapOn: 'Email address' }, { inputText: `\${EMAIL}` }],
    },
    { kind: 'evalScript', step: 3, script: `\${output.code = lookup(EMAIL)}` },
    { kind: 'device', first: 4, commands: [{ inputText: `\${output.code}` }] },
    { kind: 'takeScreenshot', step: 5, name: 'signed-in' },
    { kind: 'device', first: 6, commands: [{ assertVisible: 'Settings' }] },
  ]);
});

const nestedRefusal =
  'Step 1 holds a script or screenshot step inside another step, or runs the flow of another file.';

test('a script step inside another step is refused, because the device pool would get it', () => {
  const nested = [
    'appId: x',
    '---',
    '- runFlow:',
    '    when:',
    "      visible: 'Open'",
    '    commands:',
    `      - evalScript: \${output.a = 1}`,
    '',
  ].join('\n');
  expect(() => flowOf(nested)).toThrow(nestedRefusal);
});

test('a script file, a flow of another file and a flow hook are refused', () => {
  expect(() => flowOf('appId: x\n---\n- runScript: post.js\n')).toThrow(
    `Step 1 is a runScript step, and the runner runs no script file. Write the step as \`evalScript: \${...}\`.`,
  );
  expect(() => flowOf('appId: x\n---\n- runFlow: sign-in.yaml\n')).toThrow(nestedRefusal);
  expect(() => flowOf("appId: x\nonFlowStart:\n  - tapOn: 'a'\n---\n- tapOn: 'b'\n")).toThrow(
    'The flow has onFlowStart, which would run once for each part',
  );
});

test('a file that is not a flow of two documents is refused', () => {
  expect(() => flowOf("- tapOn: 'x'\n")).toThrow('A flow has two YAML documents');
});

test('the flow of a stretch is the config, then its steps, and a long text stays on one line', () => {
  expect(deviceFlow({ appId: 'x' }, [{ tapOn: 'Open' }])).toBe('appId: x\n---\n- tapOn: Open\n');
  const text =
    'Kitchen remodel at 8 Oak Street, Austin, TX for Ben Homeowner. Demolition for 1200 dollars.';
  expect(deviceFlow({ appId: 'x' }, [{ inputText: text }])).toBe(
    `appId: x\n---\n- inputText: ${text}\n`,
  );
});

test('the env of a flow builds its values from the run, in order, and the run keeps its own', () => {
  const host = scriptHost({ RUN: 'r7', ORIGIN: 'https://stack.test' });
  host.define([
    ['EMAIL', `journey-\${RUN}@test.dev`],
    ['OWNER_EMAIL', `owner-\${EMAIL}`],
    ['ORIGIN', 'https://other.test'],
  ]);
  expect(host.resolved({ inputText: `\${OWNER_EMAIL}` }, 1)).toEqual({
    inputText: 'owner-journey-r7@test.dev',
  });
  expect(host.resolved(`.*\${ORIGIN}.*`, 2)).toBe('.*https://stack.test.*');
});

test('a script calls a global of the run and writes output, and a later device step gets the plain value', () => {
  const waits: Array<number> = [];
  const device = { wait: (ms: number) => waits.push(ms) };
  const host = scriptHost({ RUN: 'r7' }, { device, lookup: (email: string) => `code-${email}` });
  host.define([['EMAIL', `journey-\${RUN}@test.dev`]]);
  host.evalScript(`\${output.code = (device.wait(500), lookup(EMAIL))}`, 3);
  expect(waits).toEqual([500]);
  expect(host.resolved({ inputText: `\${output.code}` }, 4)).toEqual({
    inputText: 'code-journey-r7@test.dev',
  });
});

test('a step that reads a value which nothing set is refused, with its number', () => {
  const host = scriptHost({});
  expect(() => host.resolved({ inputText: `\${output.code}` }, 9)).toThrow(
    `Step 9 reads \${output.code}, which has no value.`,
  );
});

test('a script that throws makes its step fail with the message', () => {
  const host = scriptHost({});
  expect(() => host.evalScript(`\${(function () { throw new Error('no reply'); })()}`, 4)).toThrow(
    'Step 4 is an evalScript that failed: no reply',
  );
});

const url = 'http://stack.test/mcp';
const body = JSON.stringify({ jsonrpc: '2.0', id: 'step-3', method: 'tools/call' });
const items = JSON.stringify({
  result: { structuredContent: { items: [{ n: 'b' }, { n: 'a' }] } },
});

/** A fake post that answers each call with the given reply, and records the calls. */
function fakePost(ok: boolean, reply: string) {
  const calls: Array<[string, unknown]> = [];
  const post = (to: string, options?: unknown): PostReply => {
    calls.push([to, options]);
    return { ok, status: ok ? 200 : 500, body: reply };
  };
  return { calls, post };
}

test('a tool step posts with http.post, and its check resolves to true, or false when the post fails', () => {
  const tool = `\${output.tool3 = http.post("${url}", {headers: {"content-type": "application/json"}, body: ${JSON.stringify(body)}})}`;
  const check = {
    assertTrue: {
      condition: `\${output.tool3.ok && JSON.parse(output.tool3.body).result !== undefined}`,
      label: 'The agent tool answers with no refusal',
    },
  };
  for (const ok of [true, false]) {
    const fake = fakePost(ok, JSON.stringify({ result: { content: [] } }));
    const host = scriptHost({}, {}, fake.post);
    host.evalScript(tool, 3);
    expect(fake.calls).toEqual([[url, { headers: { 'content-type': 'application/json' }, body }]]);
    expect(host.resolved(check, 4)).toEqual({
      assertTrue: { condition: String(ok), label: 'The agent tool answers with no refusal' },
    });
  }
});

test('a server check asks with http.post until the values match, and json reads a reply', () => {
  const read = `JSON.stringify(JSON.parse(http.post("${url}", {headers: {}, body: "{}"}).body).result.structuredContent.items.map(function (item) { return String(item["n"]); }).sort())`;
  const want = JSON.stringify(JSON.stringify(['a', 'b']));
  const held = `\${output.held5 = (function () { var held = null; for (var ask = 0; ask < 50 && held !== ${want}; ask += 1) { held = ${read}; } return held; })()}`;
  const fake = fakePost(true, items);
  const host = scriptHost({}, {}, fake.post);
  host.evalScript(held, 5);
  expect(fake.calls).toHaveLength(1);
  expect(host.resolved({ assertTrue: `\${output.held5 === ${want}}` }, 6)).toEqual({
    assertTrue: 'true',
  });
  host.evalScript(
    `\${output.first = json(http.post("u").body).result.structuredContent.items[0].n}`,
    7,
  );
  expect(host.resolved(`\${output.first}`, 8)).toBe('b');
});

test('syncPost posts to a server in another process and gives its reply', async () => {
  const server = Bun.spawn(
    [
      process.execPath,
      '-e',
      `const s = Bun.serve({ port: 0, fetch: async (r) => new Response(r.headers.get('x-a') + ':' + (await r.text()), { status: 201 }) }); process.stdout.write(String(s.port));`,
    ],
    { stdout: 'pipe' },
  );
  try {
    // The server writes its port as plain text (`console.log` may color a number), then keeps running.
    const { value } = await server.stdout.getReader().read();
    const port = new TextDecoder().decode(value).trim();
    expect(syncPost(`http://127.0.0.1:${port}/`, { headers: { 'x-a': 'h' }, body: 'b' })).toEqual({
      ok: true,
      status: 201,
      body: 'h:b',
    });
  } finally {
    server.kill();
  }
  expect(() => syncPost('http://127.0.0.1:1/')).toThrow('The post to http://127.0.0.1:1/ failed');
});
