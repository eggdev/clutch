import vm from 'node:vm';

import { parseAllDocuments, stringify } from 'yaml';

/**
 * A native journey runs on a device of the shared pool through `agent-device`,
 * whose daemon is on the pool machine. That daemon refuses each script step of
 * a flow that it gets over the network, and a screenshot that it takes stays
 * on the pool machine. So the runner keeps those steps on this machine: it
 * sends each stretch of device steps as one flow, and runs the steps between
 * two stretches itself. See docs/contributing/end-to-end-testing.md#native-journeys.
 */
type FlowPart =
  | { readonly kind: 'device'; readonly first: number; readonly commands: ReadonlyArray<unknown> }
  | { readonly kind: 'evalScript'; readonly step: number; readonly script: string }
  | { readonly kind: 'takeScreenshot'; readonly step: number; readonly name: string };

/** A flow, cut into its parts in order. */
export type Flow = {
  /** The first YAML document of the flow, with its `appId`, less its `env`. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly appId: string;
  /** The `env` of the first document, in order: the names that the flow gives its own values. */
  readonly env: ReadonlyArray<readonly [name: string, value: string]>;
  readonly parts: ReadonlyArray<FlowPart>;
};

/** The steps that run on this machine. */
const localSteps = ['evalScript', 'takeScreenshot'] as const;
type LocalStep = (typeof localSteps)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The local step that a command is, or null for a device step. */
function localStepOf(command: unknown): LocalStep | null {
  return isRecord(command) ? (localSteps.find((name) => name in command) ?? null) : null;
}

/**
 * Whether a device step holds a step that the runner cannot reach: a script or
 * screenshot step below the top level, or a `runFlow` of another file, whose
 * steps the runner does not read.
 */
function holdsLocalStep(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => holdsLocalStep(item));
  }
  if (!isRecord(value)) {
    return false;
  }
  const { runFlow } = value;
  if (typeof runFlow === 'string' || (isRecord(runFlow) && 'file' in runFlow)) {
    return true;
  }
  return Object.entries(value).some(
    ([key, item]) =>
      localSteps.some((name) => name === key) || key === 'runScript' || holdsLocalStep(item),
  );
}

/** The part of one local step, or an error when the runner does not read its form. */
function localPart(name: LocalStep, command: Record<string, unknown>, step: number): FlowPart {
  const value = command[name];
  if (name === 'evalScript' && typeof value === 'string') {
    return { kind: 'evalScript', step, script: value };
  }
  if (name === 'takeScreenshot') {
    const shot = isRecord(value) ? value.path : value;
    if (typeof shot === 'string' && /^[\w.-]+$/u.test(shot)) {
      return { kind: 'takeScreenshot', step, name: shot };
    }
  }
  throw new Error(
    `Step ${step} is a ${name} step in a form that the runner does not read. Write \`evalScript: \${...}\` or \`takeScreenshot: <name>\`.`,
  );
}

/** The parts of a flow, in order. Each stretch of device steps is one part. */
export function flowOf(source: string): Flow {
  const [first, second, ...rest] = parseAllDocuments(source);
  const header: unknown = first?.toJS();
  const commands: unknown = second?.toJS();
  if (
    !isRecord(header) ||
    typeof header.appId !== 'string' ||
    !Array.isArray(commands) ||
    rest.length > 0
  ) {
    throw new Error(
      'A flow has two YAML documents: the first names `appId`, and the second lists the steps.',
    );
  }
  // The runner sends each stretch as a flow of its own, so a hook would run once for each stretch.
  const hook = ['onFlowStart', 'onFlowComplete'].find((name) => name in header);
  if (hook !== undefined) {
    throw new Error(
      `The flow has ${hook}, which would run once for each part that the device gets. Put its steps in the flow.`,
    );
  }
  const { env, ...config } = header;
  const parts: Array<FlowPart> = [];
  let stretch: { first: number; commands: Array<unknown> } | null = null;
  for (const [index, command] of commands.entries()) {
    const step = index + 1;
    const name = localStepOf(command);
    if (name !== null && isRecord(command)) {
      stretch = null;
      parts.push(localPart(name, command, step));
      continue;
    }
    if (isRecord(command) && 'runScript' in command) {
      throw new Error(
        `Step ${step} is a runScript step, and the runner runs no script file. Write the step as \`evalScript: \${...}\`.`,
      );
    }
    if (holdsLocalStep(command)) {
      throw new Error(
        `Step ${step} holds a script or screenshot step inside another step, or runs the flow of another file. The device pool refuses a script, and the runner reads only the top-level steps of one file. Move the step to the top level of the flow.`,
      );
    }
    if (stretch === null) {
      stretch = { first: step, commands: [] };
      parts.push({ kind: 'device', ...stretch });
    }
    stretch.commands.push(command);
  }
  return {
    config,
    appId: header.appId,
    env: Object.entries(isRecord(env) ? env : {}).map(([name, value]) => [name, String(value)]),
    parts,
  };
}

/** The flow file of one stretch of device steps. */
export function deviceFlow(
  config: Readonly<Record<string, unknown>>,
  commands: ReadonlyArray<unknown>,
): string {
  // No line folding: a long text stays on one line, as the flow has it.
  return `${stringify(config, { lineWidth: 0 })}---\n${stringify(commands, { lineWidth: 0 })}`;
}

/** What `http.post` gives a script, as the script API of Maestro does. */
export type PostReply = { readonly ok: boolean; readonly status: number; readonly body: string };

/** The child script of `syncPost`: it posts, then prints the reply as JSON. */
const postScript = `const [url, options] = process.argv.slice(-2);
const { headers, body } = JSON.parse(options);
const reply = await fetch(url, { method: 'POST', headers, body });
console.log(JSON.stringify({ ok: reply.ok, status: reply.status, body: await reply.text() }));`;

/**
 * Posts to a URL and waits for the reply. A script runs synchronously in
 * `node:vm`, so the post runs in a child process that this one waits for.
 */
export function syncPost(
  url: string,
  options: { readonly headers?: Readonly<Record<string, string>>; readonly body?: string } = {},
): PostReply {
  const command = [process.execPath, '-e', postScript, url, JSON.stringify(options)];
  const child = Bun.spawnSync(command, { timeout: 30_000 });
  if (!child.success) {
    throw new Error(`The post to ${url} failed: ${child.stderr.toString().trim()}`);
  }
  return JSON.parse(child.stdout.toString()) as PostReply;
}

/** How long one script may run, in milliseconds. A wait that the script asks for counts. */
const scriptMs = 150_000;

/**
 * One `${expression}` of a step. The expression may hold quoted text and one
 * level of braces, as the compiled checks of a tool call do.
 */
const placeholder =
  /\$\{((?:[^{}'"`]|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\{[^{}]*\})+)\}/gu;

/**
 * Runs the script steps of one flow on this machine, and gives the device
 * steps their values. A script reads the variables of the run by name, calls
 * `http.post`, `json` and the globals that the runner gives, and writes
 * `output.<name>`. The flow is the repository's own, so it is trusted;
 * `node:vm` is no sandbox for any other.
 */
export function scriptHost(
  /** The values that the runner gives, such as `ORIGIN`. */
  variables: Readonly<Record<string, string>>,
  /** Other names that a script may use, such as an object `device` with functions. */
  globals: Readonly<Record<string, unknown>> = {},
  post: typeof syncPost = syncPost,
) {
  const context = vm.createContext({
    ...globals,
    ...variables,
    http: { post },
    json: (text: string): unknown => JSON.parse(text),
    output: {},
  });
  const run = (code: string, filename: string) =>
    vm.runInContext(code, context, { filename, timeout: scriptMs }) as unknown;

  /** The text with each `${expression}` replaced by its value. */
  const text = (value: string, where: string) =>
    value.replaceAll(placeholder, (_, expression: string) => {
      const result = run(`(${expression}\n)`, where);
      if (result === undefined || result === null) {
        throw new Error(
          `${where} reads \${${expression}}, which has no value. Set it in the env of the flow or in a script step before, or pass it to the run.`,
        );
      }
      return String(result);
    });

  /** A step with each `${expression}` in it replaced, so the device gets plain values. */
  const resolved = (value: unknown, step: number): unknown => {
    if (typeof value === 'string') {
      return text(value, `Step ${step}`);
    }
    if (Array.isArray(value)) {
      return value.map((item) => resolved(item, step));
    }
    return isRecord(value)
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolved(item, step)]))
      : value;
  };

  return {
    resolved,
    /**
     * Gives each name of the flow's `env` its value, in order, so a value can read
     * the names before it. A name that the runner gives keeps its value, as with `-e`.
     */
    define(env: Flow['env']) {
      for (const [name, value] of env) {
        if (!(name in variables)) {
          context[name] = text(value, `The env value ${name}`);
        }
      }
    },
    /** Runs an `evalScript` step: one `${expression}`, for what it writes to `output`. */
    evalScript(script: string, step: number) {
      const expression = /^\$\{(.*)\}$/su.exec(script.trim())?.[1];
      if (expression === undefined) {
        throw new Error(
          `Step ${step} is an evalScript with no \${...}. Write \`evalScript: \${...}\`.`,
        );
      }
      try {
        run(`(${expression}\n)`, `Step ${step}`);
      } catch (error) {
        // An error of the script comes from another realm, so it is no `Error` of this one.
        const message = isRecord(error) ? String(error.message) : String(error);
        throw new Error(`Step ${step} is an evalScript that failed: ${message}`, { cause: error });
      }
    },
  };
}
