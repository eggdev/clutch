/**
 * The Tailwind class lint. Each rule enforces one line of
 * docs/principles/design-tokens.md or docs/principles/compositor-only-motion.md.
 * Stylelint sees CSS files only, so these rules read the class strings in TSX.
 * See docs/contributing/setup/lint-rules.md#tailwind-classes.
 */

/** The JSX attributes that hold classes. */
const classAttributes = new Set(['className', 'class']);

/** The helpers whose string arguments are classes. */
const classHelpers = new Set(['cn', 'clsx', 'cx', 'cva', 'tv', 'twMerge', 'twJoin']);

/** AST fields that point back up the tree or hold positions. */
const skippedKeys = new Set(['parent', 'loc', 'range', 'start', 'end']);

/** Splits a class into its variants and its utility, at each `:` outside brackets. */
export function splitClass(token) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of token) {
    if (char === '[' || char === '(') {
      depth += 1;
    } else if (char === ']' || char === ')') {
      depth -= 1;
    }
    if (char === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  const utility = current.replaceAll(/^!|!$/gu, '').replace(/^-/u, '');
  return { variants: parts, utility };
}

/**
 * The rule that a class breaks, or null. A duration or a delay reads a speed
 * token through the variable shorthand, such as `duration-(--speed-quick)`.
 */
export function classProblem(token) {
  const { variants, utility } = splitClass(token);
  if (variants.includes('dark')) {
    return 'no-dark-variant';
  }
  if (utility.includes('[')) {
    return 'no-arbitrary-values';
  }
  if (
    /^(?:duration|delay)-/u.test(utility) &&
    !/^(?:duration|delay)-\(--speed-[\w-]+\)$/u.test(utility)
  ) {
    return 'speed-tokens-only';
  }
  if (utility === 'transition-all') {
    return 'no-transition-all';
  }
  return null;
}

/** Each string literal and template part in a node, with the node that holds it. */
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
  if (node.type === 'TemplateElement') {
    found.push({ node, text: node.value.cooked ?? node.value.raw });
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    if (!skippedKeys.has(key)) {
      strings(value, found);
    }
  }
  return found;
}

/**
 * Calls `check` once with each class string in the file. A helper call inside
 * a class attribute is reached from both, so each string is checked once.
 */
function classStrings(check) {
  const seen = new WeakSet();
  const checkEach = (items) => {
    for (const item of items) {
      if (!seen.has(item.node)) {
        seen.add(item.node);
        check(item);
      }
    }
  };
  return {
    JSXAttribute(node) {
      if (node.name.type === 'JSXIdentifier' && classAttributes.has(node.name.name)) {
        checkEach(strings(node.value));
      }
    },
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && classHelpers.has(node.callee.name)) {
        checkEach(strings(node.arguments));
      }
    },
  };
}

function rule(name, message) {
  return {
    meta: { type: 'problem', schema: [], messages: { [name]: message } },
    create(context) {
      return classStrings(({ node, text }) => {
        for (const token of text.split(/\s+/u).filter(Boolean)) {
          if (classProblem(token) === name) {
            context.report({ node, messageId: name, data: { token } });
          }
        }
      });
    },
  };
}

export default {
  meta: { name: 'repo-classes' },
  rules: {
    'no-arbitrary-values': rule(
      'no-arbitrary-values',
      '`{{token}}` holds an arbitrary value. Use a token role, or add one. See docs/principles/design-tokens.md.',
    ),
    'speed-tokens-only': rule(
      'speed-tokens-only',
      '`{{token}}` sets its own time. Use a speed token, such as `duration-(--speed-quick)`. See docs/principles/compositor-only-motion.md.',
    ),
    'no-transition-all': rule(
      'no-transition-all',
      '`{{token}}` animates layout properties too. Name the property, such as `transition-colors` or `transition-transform`.',
    ),
    'no-dark-variant': rule(
      'no-dark-variant',
      '`{{token}}` styles one scheme. Use a role: its value changes with the scheme. See docs/principles/design-tokens.md.',
    ),
  },
};
