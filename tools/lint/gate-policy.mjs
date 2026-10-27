/**
 * The one-gate lint. A feature has one gate: the function that settles what
 * the feature needs, then navigates. Every way in calls it. Only the gate and
 * the feature's own route folder name the feature's route. Enforces
 * docs/principles/one-gate-per-feature.md. The registry of gated routes is the
 * rule's option in oxlint.config.ts.
 * See docs/contributing/setup/lint-rules.md#feature-gates.
 */
import path from 'node:path';

/** Calls that navigate: `router.push(href)`, `navigation.replace(href)`, `navigate(href)`. */
const navigations = new Set(['push', 'replace', 'navigate', 'redirect']);

/** AST fields that point back up the tree or hold positions. */
const skippedKeys = new Set(['parent', 'loc', 'range', 'start', 'end']);

/** Each string literal and the leading text of each template literal. */
function strings(node, found = []) {
  if (!node || typeof node !== 'object') {
    return found;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      strings(item, found);
    }
    return found;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    found.push({ node, text: node.value });
    return found;
  }
  if (node.type === 'TemplateLiteral') {
    const [first] = node.quasis;
    found.push({ node, text: first?.value.cooked ?? first?.value.raw ?? '' });
  }
  for (const [key, value] of Object.entries(node)) {
    if (!skippedKeys.has(key)) {
      strings(value, found);
    }
  }
  return found;
}

/**
 * The gated route that a string opens, or null when the file may name it.
 * `gates` maps a route, such as `/feature`, to its gate file and route folder.
 */
export function gateProblem(text, file, gates) {
  for (const [route, { gate, routes }] of Object.entries(gates)) {
    const opens = text === route || text.startsWith(`${route}/`) || text.startsWith(`${route}?`);
    if (opens && file !== gate && !file.startsWith(`${routes}/`)) {
      return { route, gate };
    }
  }
  return null;
}

export default {
  meta: { name: 'repo-gates' },
  rules: {
    'one-gate': {
      meta: {
        type: 'problem',
        schema: false,
        messages: {
          'one-gate':
            '`{{route}}` opens only through its gate in {{gate}}. See docs/principles/one-gate-per-feature.md.',
        },
      },
      create(context) {
        const gates = context.options[0]?.gates ?? {};
        const file = path.relative(context.cwd, context.filename).split(path.sep).join('/');
        const check = (target) => {
          for (const { node, text } of strings(target)) {
            const problem = gateProblem(text, file, gates);
            if (problem) {
              context.report({ node, messageId: 'one-gate', data: problem });
            }
          }
        };
        // Only a navigation opens a route. A screen name or a pattern is not a way in.
        return {
          CallExpression(node) {
            const { callee } = node;
            const name = callee.type === 'MemberExpression' ? callee.property.name : callee.name;
            if (navigations.has(name)) {
              check(node.arguments);
            }
          },
          JSXAttribute(node) {
            if (node.name.type === 'JSXIdentifier' && node.name.name === 'href') {
              check(node.value);
            }
          },
          Property(node) {
            if (node.key.type === 'Identifier' && node.key.name === 'href') {
              check(node.value);
            }
          },
        };
      },
    },
  },
};
