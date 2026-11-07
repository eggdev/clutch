import { allowProblems, allowedModules, pageStep } from '@tools/journeys/core-allow';
import type { Names } from '@tools/journeys/core-allow';
import ts from 'typescript';

/**
 * The source rules of a web `Core:` journey, read from its TypeScript syntax
 * tree rather than its text. So a comment, a string, a template literal or
 * bracket access cannot hide code from them. See core-rules.ts for the rules,
 * and docs/contributing/journeys/core.md for why.
 */

const catalog = 'docs/contributing/journeys/core.md';

/** Names that load state, log in, or mock the backend: a seed by another road. */
const seeding = new Set([
  'storageState',
  'addCookies',
  'addInitScript',
  'localStorage',
  'sessionStorage',
  'request',
  'fetch',
  'route',
  'routeFromHAR',
  'setExtraHTTPHeaders',
  'extraHTTPHeaders',
  'httpCredentials',
]);

/** Names that run code in the page or change the URL without a tap. */
const scripting = new Set([
  'evaluate',
  'evaluateHandle',
  '$eval',
  '$$eval',
  'exposeFunction',
  'exposeBinding',
  'history',
  'location',
  'window',
  'document',
  'globalThis',
]);

/** Names that reach past the page: the environment, the file system, or code built at run time. */
const escaping = new Set(['process', 'Bun', 'Deno', 'require', 'eval', 'Function']);

/** The steps that a user takes. Each outcome follows at least one. */
const actions = new Set([
  'click',
  'dblclick',
  'tap',
  'fill',
  'press',
  'pressSequentially',
  'type',
  'check',
  'uncheck',
  'selectOption',
  'setInputFiles',
  'dragTo',
  'reload',
  'goBack',
  'goForward',
]);

const seedName = /^seed(?:ed|s|ing)?$|^seed[A-Z_]/u;
const kebab = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const isCall = (node: ts.Node, name: string) =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;

/** The callee's member name of `await x.y(…)`, or of `x.y(…)`. */
function memberCalled(node: ts.Node) {
  const call = ts.isAwaitExpression(node) ? node.expression : node;
  if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name.text;
  }
  return null;
}

/** The outcome name of `await outcome('<name>', …)`, when the statement is one. */
function outcomeOf(statement: ts.Statement) {
  if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) {
    return null;
  }
  const call = statement.expression.expression;
  if (!isCall(call, 'outcome') || !ts.isCallExpression(call)) {
    return null;
  }
  const [first] = call.arguments;
  return first && ts.isStringLiteralLike(first) ? first.text : '';
}

/** The body of each `test(title, async ({ page }) => { … })` in the file. */
function testBodies(file: ts.SourceFile) {
  const bodies: Array<ts.Block> = [];
  const visit = (node: ts.Node) => {
    if (isCall(node, 'test') && ts.isCallExpression(node)) {
      const fn = node.arguments.find(
        (item) => ts.isArrowFunction(item) || ts.isFunctionExpression(item),
      );
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isBlock(fn.body)) {
        bodies.push(fn.body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return bodies;
}

type Found = { problems: Set<string>; seen: Array<string>; idle: Array<string> };

const message = {
  imports: (file: string, from: string) =>
    `${file}: it imports ${from}. A core journey imports only @playwright/test and @repo/journeys/testing, so every step is in the journey. See ${catalog}.`,
  escapes: (file: string) =>
    `${file}: it reaches past the page, through a dynamic import, \`require\`, the environment or the file system. See ${catalog}.`,
  brackets: (file: string) =>
    `${file}: it reaches a member through brackets. Write each call by name, such as \`page.goto('/')\`, so a check can read it. See ${catalog}.`,
  seeds: (file: string) =>
    `${file}: it loads a seed fixture, a saved session or a token, or logs in through the API. A core journey makes a new account through the sign-up screens. See ${catalog}.`,
  scripts: (file: string) =>
    `${file}: it changes the URL or runs code in the page without a tap. A core journey reaches each screen through the buttons that a user taps. See ${catalog}.`,
  expects: (file: string) =>
    `${file}: it asserts with \`expect\`. A core journey asserts only through \`outcome(name, expected)\` from @repo/journeys/testing/outcome. See ${catalog}.`,
  binds: (file: string) =>
    `${file}: it binds \`outcomes(page)\` to a name other than \`outcome\`. Write \`const outcome = outcomes(page)\`, so a check can read each outcome. See ${catalog}.`,
};

/** The problems that one name in the code brings, wherever it sits. */
function nameProblems(file: string, text: string) {
  return [
    ...(seeding.has(text) || seedName.test(text) ? [message.seeds(file)] : []),
    ...(scripting.has(text) ? [message.scripts(file)] : []),
    ...(escaping.has(text) ? [message.escapes(file)] : []),
    ...(text === 'expect' ? [message.expects(file)] : []),
  ];
}

/** The problems of a `.goto` member: it must be called, with `'/'`. */
function gotoProblems(file: string, node: ts.PropertyAccessExpression) {
  const call = node.parent;
  if (!ts.isCallExpression(call) || call.expression !== node) {
    return [message.scripts(file)];
  }
  const [url] = call.arguments;
  if (url && ts.isStringLiteralLike(url) && url.text === '/') {
    return [];
  }
  return [
    `${file}: it opens ${url?.getText() ?? 'no URL'}. A core journey opens only the entry, \`/\`, and reaches each screen through the app. See ${catalog}.`,
  ];
}

/** Whether `outcomes(page)` is bound as `const outcome`. */
function boundAsOutcome(node: ts.Node) {
  const declaration = node.parent;
  return (
    ts.isVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === 'outcome' &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

/** The problems of one node of the tree, before its children. */
function nodeProblems(file: string, node: ts.Node): Array<string> {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const from = node.moduleSpecifier.text;
    return allowedModules.has(from) ? [] : [message.imports(file, from)];
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return [message.escapes(file)];
  }
  if (ts.isElementAccessExpression(node)) {
    return ts.isNumericLiteral(node.argumentExpression) ? [] : [message.brackets(file)];
  }
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return nameProblems(file, node.text);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const fixture =
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'test' &&
      ['extend', 'use'].includes(node.name.text);
    if (fixture) {
      return [message.seeds(file)];
    }
    return node.name.text === 'goto' ? gotoProblems(file, node) : [];
  }
  if (isCall(node, 'outcomes')) {
    return boundAsOutcome(node) ? [] : [message.binds(file)];
  }
  return [];
}

function scan(file: string, node: ts.Node, found: Found) {
  for (const problem of nodeProblems(file, node)) {
    found.problems.add(problem);
  }
  ts.forEachChild(node, (child) => scan(file, child, found));
}

/** Every `outcome(…)` call in the file, wherever it sits. */
function countOutcomeCalls(source: ts.SourceFile) {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (isCall(node, 'outcome')) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/** Any name, so a step's own arguments do not decide whether it counts as a step. The allow list checks them. */
const everyName: Names = { has: () => true };

/** Each outcome is an awaited statement of the test body, in order, after a user step. */
function steps(file: string, body: ts.Block, found: Found) {
  let entered = false;
  let stepped = false;
  for (const statement of body.statements) {
    const name = outcomeOf(statement);
    if (name !== null) {
      found.seen.push(name);
      if (name === '' || !kebab.test(name)) {
        found.problems.add(
          `${file}: an outcome name is not a literal string. Write each name as a string, such as \`outcome('signed-in', …)\`, so a check can read it. See ${catalog}.`,
        );
      }
      if (!entered || !stepped) {
        found.idle.push(name);
      }
      stepped = false;
      continue;
    }
    const call =
      ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression)
        ? statement.expression.expression
        : null;
    // Only a step that starts at `page` counts, so a stand-in `{ click }` object does not.
    const member = call ? pageStep(call, everyName) : null;
    if (member === 'goto') {
      entered = true;
    } else if (member !== null && actions.has(member)) {
      stepped = true;
    }
  }
}

/** The problems of a web `Core:` journey, and the outcome names it asserts, in order. */
export function webFindings(file: string, body: string) {
  const source = ts.createSourceFile('journey.ts', body, ts.ScriptTarget.Latest, true);
  const found: Found = { problems: new Set(), seen: [], idle: [] };
  scan(file, source, found);
  for (const problem of allowProblems(file, source)) {
    found.problems.add(problem);
  }
  const bodies = testBodies(source);
  for (const block of bodies) {
    steps(file, block, found);
  }
  if (countOutcomeCalls(source) !== found.seen.length) {
    found.problems.add(
      `${file}: an outcome sits inside a branch, a loop or a helper. Write each one as its own \`await outcome(…)\` line in the test, so it runs in order. See ${catalog}.`,
    );
  }
  if (
    !bodies.some((block) =>
      block.statements.some(
        (item) => ts.isExpressionStatement(item) && memberCalled(item.expression) === 'goto',
      ),
    )
  ) {
    found.problems.add(`${file}: it never opens the entry. Start with \`page.goto('/')\`.`);
  }
  if (found.idle.length > 0) {
    found.problems.add(
      `${file}: no user step comes before ${found.idle.map((item) => `\`${item}\``).join(', ')}. Each outcome comes after a tap, a fill or a reload, so it cannot hold on the screen before. See ${catalog}.`,
    );
  }
  return { problems: [...found.problems], seen: found.seen };
}
