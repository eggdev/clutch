import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Gh } from '@/doctor/remote';
import { gitRepo } from '@/testing/git-repo';

/** The head commit of pull request 7 in the fake. */
export const head = 'a'.repeat(40);
/** A small buffer that starts with the PNG signature. */
export const png = (text: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(text)]);

type Call = { method: string; route: string; body: Record<string, unknown> };
type Comment = { id: number; html_url: string; body: string };

const ok = (value: unknown) => ({
  ok: true,
  out: JSON.stringify(value),
  err: '',
});
const fail = (code: number, text: string) => ({
  ok: false,
  out: '',
  err: `gh: ${text} (HTTP ${code})`,
});
const notFound = fail(404, 'Not Found');

type State = {
  head: string;
  tip?: string;
  refuse: number;
  blobs: Map<string, string>;
  trees: Map<string, Record<string, string>>;
  commits: Map<string, { tree: string; parents: Array<string>; message: string }>;
  comments: Array<Comment>;
};
type Request = {
  route: string;
  body: Record<string, unknown>;
  fields: Record<string, string>;
};
type Answer = { ok: boolean; out: string; err: string };
type Route = [method: string, match: RegExp, answer: (request: Request) => Answer];

/** The REST routes of repository `o/r`, with pull request 7, over `state`. */
function routes(state: State, id: (kind: string) => string): Array<Route> {
  const comment = (request: Request) =>
    state.comments.find((one) => `${one.id}` === request.route.split('/').at(-1));
  return [
    ['GET', /^repos\/o\/r\/pulls\/7$/u, () => ok({ head: { sha: state.head } })],
    [
      'POST',
      /^repos\/o\/r\/git\/blobs$/u,
      ({ body }) => {
        const sha = id('b');
        state.blobs.set(sha, String(body.content));
        return ok({ sha });
      },
    ],
    [
      'GET',
      /^repos\/o\/r\/git\/ref\/heads\/verify-shots$/u,
      () => (state.tip ? ok({ object: { sha: state.tip } }) : notFound),
    ],
    [
      'GET',
      /^repos\/o\/r\/git\/commits\//u,
      ({ route }) => {
        const commit = state.commits.get(route.split('/').at(-1) ?? '');
        return commit ? ok({ tree: { sha: commit.tree } }) : notFound;
      },
    ],
    [
      'POST',
      /^repos\/o\/r\/git\/trees$/u,
      ({ body }) => {
        const base = state.trees.get(String(body.base_tree)) ?? {};
        const entries = body.tree as Array<{ path: string; sha: string }>;
        const sha = id('t');
        state.trees.set(sha, {
          ...base,
          ...Object.fromEntries(entries.map((entry) => [entry.path, entry.sha])),
        });
        return ok({ sha });
      },
    ],
    [
      'POST',
      /^repos\/o\/r\/git\/commits$/u,
      ({ body }) => {
        const sha = id('c');
        const parents = body.parents as Array<string>;
        state.commits.set(sha, {
          tree: String(body.tree),
          parents,
          message: String(body.message),
        });
        return ok({ sha });
      },
    ],
    [
      'POST',
      /^repos\/o\/r\/git\/refs$/u,
      ({ body }) => {
        if (state.tip) {
          return fail(422, 'Reference already exists');
        }
        state.tip = String(body.sha);
        return ok({});
      },
    ],
    [
      'PATCH',
      /^repos\/o\/r\/git\/refs\/heads\/verify-shots$/u,
      ({ body }) => {
        const parents = state.commits.get(String(body.sha))?.parents ?? [];
        if (state.refuse > 0 || !parents.includes(state.tip ?? '')) {
          state.refuse -= 1;
          return fail(422, 'Update is not a fast forward');
        }
        state.tip = String(body.sha);
        return ok({});
      },
    ],
    [
      'GET',
      /^repos\/o\/r\/issues\/7\/comments\?/u,
      ({ route }) => ok(route.endsWith('page=1') ? state.comments : []),
    ],
    [
      'POST',
      /^repos\/o\/r\/issues\/7\/comments$/u,
      ({ fields }) => {
        const number = state.comments.length + 1;
        const added = {
          id: number,
          html_url: `https://c/${number}`,
          body: fields.body,
        };
        state.comments.push(added);
        return ok(added);
      },
    ],
    [
      'PATCH',
      /^repos\/o\/r\/issues\/comments\//u,
      (request) => {
        const found = comment(request);
        if (!found) {
          return notFound;
        }
        found.body = request.fields.body;
        return ok(found);
      },
    ],
  ];
}

/** Splits the arguments of `gh api` into the method, the route, the JSON body and the fields. */
function parseApi(args: Array<string>) {
  if (args[0] !== 'api') {
    throw new Error(`The fake gh answers only gh api, not gh ${args.join(' ')}.`);
  }
  let method = 'GET';
  let route = '';
  let body: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-X') {
      method = args[(index += 1)];
    } else if (arg === '--input') {
      body = JSON.parse(readFileSync(args[(index += 1)], 'utf-8')) as Record<string, unknown>;
    } else if (arg === '-f') {
      const [key, ...value] = args[(index += 1)].split('=');
      fields[key] = value.join('=');
    } else {
      route = arg;
    }
  }
  return { method, route, body, fields };
}

/**
 * A `gh` that acts as the GitHub REST routes that `postShots` calls. It keeps
 * the shots branch, each commit and each comment, and records each call.
 * `state.refuse` makes the next ref updates fail with a 422, as when another
 * run moved the branch first.
 */
export function fakeGitHub() {
  const calls: Array<Call> = [];
  const state: State = {
    head,
    refuse: 0,
    blobs: new Map(),
    trees: new Map(),
    commits: new Map(),
    comments: [],
  };
  let next = 0;
  const table = routes(state, (kind) => `${kind}${(next += 1)}`.padEnd(40, '0'));
  const gh: Gh = (args) => {
    const { method, route, body, fields } = parseApi(args);
    calls.push({ method, route, body });
    const found = table.find(([verb, match]) => verb === method && match.test(route));
    return Promise.resolve(found ? found[2]({ route, body, fields }) : notFound);
  };
  return { gh, calls, state };
}

/** Writes each file next to a new empty Git repository, which it returns with the paths. */
export async function shots(names: Record<string, Buffer>) {
  const repo = await gitRepo({});
  const files = [];
  for (const [name, bytes] of Object.entries(names)) {
    const file = path.join(repo.parent, name);
    await writeFile(file, bytes);
    files.push(file);
  }
  return Object.assign(repo, { files });
}
