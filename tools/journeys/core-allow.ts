import ts from 'typescript';

/**
 * The allow list of a web `Core:` journey. A file holds only imports and
 * `test(title, async ({ page }) => { … })` calls. Each statement of a test is
 * one of:
 *
 * - `const outcome = outcomes(page);`
 * - `const <name> = <a plain value>;`
 * - `await page.<locator chain>.<action>(<plain values>);`
 * - `await outcome('<name>', <plain values>);`
 * - `await <journey kit helper>(page, <plain values>);`
 *
 * A plain value is a literal, an object or array of plain values, a const
 * from the test, a template of those, or `Date.now()`. So no reflection, no
 * page script, no fake step and no setup hook can sit in a core journey. See
 * docs/contributing/journeys/core.md.
 */

const catalog = 'docs/contributing/journeys/core.md';

/** The names that a plain value may use: the consts of the test so far. */
export type Names = { has: (name: string) => boolean };

/**
 * The only modules a core journey may import, by exact path, so `..` in a
 * path cannot leave the journey kit. `test` must come from @playwright/test.
 */
export const allowedModules = new Set([
  '@playwright/test',
  '@repo/journeys/testing/outcome',
  '@repo/journeys/testing/a11y',
  '@repo/journeys/testing/visual',
]);

/** The members that a page step may chain: locators, then one action. */
const chain = new Set([
  'getByRole',
  'getByLabel',
  'getByText',
  'getByPlaceholder',
  'getByTestId',
  'getByAltText',
  'getByTitle',
  'locator',
  'first',
  'last',
  'nth',
  'filter',
  'and',
  'or',
  'keyboard',
]);

/** The members that end a page step: an action, the entry, or a wait. */
const finals = new Set([
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
  'goto',
  'waitForURL',
  'waitForLoadState',
  'insertText',
]);

/** Whether `node` is `Date.now()` or `Date.now().toString(<number>)`. */
function isNow(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }
  const { expression, name } = node.expression;
  if (name.text === 'now') {
    return ts.isIdentifier(expression) && expression.text === 'Date' && node.arguments.length === 0;
  }
  return (
    name.text === 'toString' &&
    isNow(expression) &&
    node.arguments.every((item) => ts.isNumericLiteral(item))
  );
}

/** Whether `node` is a plain value: a literal, a const, a template or an object of those. */
function plain(node: ts.Expression, consts: Names): boolean {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    ts.isRegularExpressionLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (ts.isIdentifier(node)) {
    return consts.has(node.text);
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.every((span) => plain(span.expression, consts));
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every((item) => plain(item, consts));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (item) =>
        ts.isPropertyAssignment(item) &&
        (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
        plain(item.initializer, consts),
    );
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return ts.isNumericLiteral(node.operand);
  }
  return isNow(node);
}

/** The final member of `page.<chain>.<final>(…)`, when the call is one. */
export function pageStep(node: ts.Expression, consts: Names): string | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  const last = node.expression.name.text;
  if (!finals.has(last) || !node.arguments.every((item) => plain(item, consts))) {
    return null;
  }
  let link: ts.Expression = node.expression.expression;
  for (;;) {
    if (ts.isIdentifier(link)) {
      return link.text === 'page' ? last : null;
    }
    if (ts.isCallExpression(link) && ts.isPropertyAccessExpression(link.expression)) {
      if (
        !chain.has(link.expression.name.text) ||
        !link.arguments.every((item) => plain(item, consts))
      ) {
        return null;
      }
      link = link.expression.expression;
    } else if (ts.isPropertyAccessExpression(link) && link.name.text === 'keyboard') {
      link = link.expression;
    } else {
      return null;
    }
  }
}

/** Whether `statement` is one that the allow list takes, given the consts so far. */
function allowed(statement: ts.Statement, consts: Set<string>, kit: ReadonlySet<string>) {
  if (ts.isVariableStatement(statement)) {
    const list = statement.declarationList;
    if ((list.flags & ts.NodeFlags.Const) === 0) {
      return false;
    }
    return list.declarations.every((item) => {
      if (!ts.isIdentifier(item.name) || !item.initializer) {
        return false;
      }
      const { initializer } = item;
      const ok =
        (item.name.text === 'outcome' &&
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          initializer.expression.text === 'outcomes' &&
          initializer.arguments.length === 1 &&
          ts.isIdentifier(initializer.arguments[0] as ts.Expression) &&
          (initializer.arguments[0] as ts.Identifier).text === 'page') ||
        plain(initializer, consts);
      if (ok) {
        consts.add(item.name.text);
      }
      return ok;
    });
  }
  if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) {
    return false;
  }
  const call = statement.expression.expression;
  if (pageStep(call, consts) !== null) {
    return true;
  }
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) {
    return false;
  }
  const callee = call.expression.text;
  const [first, ...rest] = call.arguments;
  if (callee === 'outcome') {
    return call.arguments.every((item) => plain(item, consts));
  }
  return (
    kit.has(callee) &&
    first !== undefined &&
    ts.isIdentifier(first) &&
    first.text === 'page' &&
    rest.every((item) => plain(item, consts))
  );
}

/** Whether `node` is `test(<title>, async ({ page }) => { … })`, and its body when it is. */
function testBody(node: ts.Statement) {
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) {
    return null;
  }
  const call = node.expression;
  const [title, fn] = call.arguments;
  if (
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== 'test' ||
    call.arguments.length !== 2 ||
    !title ||
    !ts.isStringLiteralLike(title) ||
    !fn ||
    !ts.isArrowFunction(fn) ||
    !ts.isBlock(fn.body)
  ) {
    return null;
  }
  const [param] = fn.parameters;
  const onlyPage =
    fn.parameters.length === 1 &&
    param !== undefined &&
    ts.isObjectBindingPattern(param.name) &&
    param.name.elements.length === 1 &&
    param.name.elements[0]?.name.getText() === 'page' &&
    param.name.elements[0].propertyName === undefined;
  return onlyPage ? fn.body : null;
}

/**
 * Whether an import is one that a core journey may have: named imports from
 * an allowed module by exact path, with `test` only from @playwright/test. It
 * adds each journey kit helper to `kit`. A side-effect, default or namespace
 * import runs or hides code that no rule reads.
 */
function importAllowed(statement: ts.ImportDeclaration, kit: Set<string>) {
  const from = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  if (
    !allowedModules.has(from) ||
    !clause ||
    clause.name ||
    !bindings ||
    !ts.isNamedImports(bindings)
  ) {
    return false;
  }
  if (from === '@playwright/test') {
    return bindings.elements.every(
      (item) => item.name.text === 'test' && (item.propertyName ?? item.name).text === 'test',
    );
  }
  for (const item of bindings.elements) {
    if (item.name.text !== 'outcomes') {
      kit.add(item.name.text);
    }
  }
  return true;
}

/** The lines of a web `Core:` journey that the allow list does not take. */
export function allowProblems(file: string, source: ts.SourceFile): Array<string> {
  const kit = new Set<string>();
  const lines: Array<number> = [];
  const line = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!importAllowed(statement, kit)) {
        lines.push(line(statement));
      }
      continue;
    }
    const body = testBody(statement);
    if (body === null) {
      lines.push(line(statement));
      continue;
    }
    const consts = new Set<string>();
    for (const item of body.statements) {
      if (!allowed(item, consts, kit)) {
        lines.push(line(item));
      }
    }
  }
  if (lines.length === 0) {
    return [];
  }
  return [
    `${file}: ${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')} ${lines.length === 1 ? 'is not a step' : 'are not steps'} that a core journey takes. A test holds only page steps from \`page\`, outcomes, journey kit calls and consts of plain values. See ${catalog}.`,
  ];
}
