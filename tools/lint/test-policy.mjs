/**
 * The test rules. A test proves the behavior that a user or a caller sees.
 * It never hides from the run, never only takes a picture of an output, and
 * never only checks that something exists. See
 * docs/contributing/testing.md#test-rules.
 */

/** The functions that declare a test or a group of tests. */
const declarers = new Set(['test', 'it', 'describe']);
/** The modifiers that leave a test out of the run, or run it alone. */
const hidden = new Set(['skip', 'only', 'todo', 'skipIf', 'todoIf', 'failing', 'if']);
/** The global spellings of a skipped or focused test. */
const hiddenGlobals = new Set(['xtest', 'xit', 'xdescribe', 'fit', 'fdescribe', 'ftest']);
/** Snapshot matchers. A snapshot records an output; it does not say which behavior is right. */
const snapshots = new Set([
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
  'toThrowErrorMatchingSnapshot',
  'toThrowErrorMatchingInlineSnapshot',
]);
/** Matchers that only check that a value exists. `not` turns the second set into one. */
const existence = new Set(['toBeDefined', 'toBeTruthy']);
const existenceWhenNegated = new Set(['toBeNull', 'toBeUndefined', 'toBeFalsy', 'toThrow']);

/** The name of the function that a call declares a test with, such as `test` in `test.each(...)(...)`. */
function declarerOf(callee) {
  let current = callee;
  while (current?.type === 'MemberExpression' || current?.type === 'CallExpression') {
    current = current.type === 'CallExpression' ? current.callee : current.object;
  }
  return current?.type === 'Identifier' ? current.name : null;
}

/** The member names along a call's callee, such as `['skip']` for `test.skip(...)`. */
function membersOf(callee) {
  const names = [];
  let current = callee;
  while (current?.type === 'MemberExpression' || current?.type === 'CallExpression') {
    if (current.type === 'MemberExpression' && !current.computed) {
      names.push(current.property.name);
    }
    current = current.type === 'CallExpression' ? current.callee : current.object;
  }
  return names;
}

/** The matcher of an assertion, and whether `not` negates it, for `expect(x).not.toBe(y)`. */
function assertionOf(node) {
  if (node.callee?.type !== 'MemberExpression' || node.callee.computed) {
    return null;
  }
  const names = membersOf(node.callee);
  if (declarerOf(node.callee) !== 'expect') {
    return null;
  }
  return { matcher: names[0], negated: names.includes('not') };
}

/** A call that asserts through a helper, by name: `expectProblem(...)`, `assertSynced(...)`. */
const isAssertionHelper = (callee) =>
  callee?.type === 'Identifier' &&
  /^(?:expect|assert)[A-Z]/u.test(callee.name) &&
  callee.name !== 'expect';

/** A test declaration with its body: `test('name', () => ...)`, at its outermost call. */
const isTest = (node) =>
  ['test', 'it'].includes(declarerOf(node.callee)) &&
  !(node.parent?.type === 'CallExpression' && node.parent.callee === node) &&
  node.arguments.some(
    (argument) =>
      argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression',
  );

const message = (text) =>
  `${text} Assert the behavior that a user or a caller sees. See docs/contributing/testing.md#test-rules.`;

export default {
  meta: { name: 'repo-tests' },
  rules: {
    'no-hidden-tests': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          hidden: message(
            '`{{name}}` leaves tests out of the run, or runs some alone. Fix the test or delete it.',
          ),
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const { callee } = node;
            if (callee.type === 'Identifier' && hiddenGlobals.has(callee.name)) {
              context.report({ node, messageId: 'hidden', data: { name: callee.name } });
              return;
            }
            // Check each declaration once, at its outermost call: `test.skip.each(rows)(...)`.
            const outermost = !(
              node.parent?.type === 'CallExpression' && node.parent.callee === node
            );
            if (!outermost || !declarers.has(declarerOf(callee))) {
              return;
            }
            const modifier = membersOf(callee).find((name) => hidden.has(name));
            if (modifier) {
              context.report({
                node,
                messageId: 'hidden',
                data: { name: `${declarerOf(callee)}.${modifier}` },
              });
            }
          },
        };
      },
    },
    'no-snapshots': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          snapshot: message(
            '`{{name}}` records an output, and it passes again after an update that hides a bug.',
          ),
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const assertion = assertionOf(node);
            if (assertion && snapshots.has(assertion.matcher)) {
              context.report({ node, messageId: 'snapshot', data: { name: assertion.matcher } });
            }
          },
        };
      },
    },
    'assert-behavior': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          none: message('This test asserts nothing, so it passes whatever the code does.'),
          existence: message(
            'This test only checks that something exists or does not throw, so a wrong value passes.',
          ),
        },
      },
      create(context) {
        const open = [];
        return {
          CallExpression(node) {
            if (isTest(node)) {
              open.push({ node, assertions: [], helpers: 0 });
              return;
            }
            const current = open.at(-1);
            if (!current) {
              return;
            }
            const assertion = assertionOf(node);
            if (assertion?.matcher) {
              current.assertions.push(assertion);
            } else if (isAssertionHelper(node.callee)) {
              current.helpers += 1;
            }
          },
          'CallExpression:exit'(node) {
            if (open.at(-1)?.node !== node) {
              return;
            }
            const { assertions, helpers } = open.pop();
            if (!assertions.length && !helpers) {
              context.report({ node, messageId: 'none' });
            } else if (
              !helpers &&
              assertions.every(({ matcher, negated }) =>
                negated ? existenceWhenNegated.has(matcher) : existence.has(matcher),
              )
            ) {
              context.report({ node, messageId: 'existence' });
            }
          },
        };
      },
    },
  },
};
