import ts from 'typescript';

/**
 * Small, exact edits to registration files: one import line, and one element
 * in one array. A registration file has one array per list, such as
 * `export const commands = [...notesCommands];`, `addChildren([homeRoute])`,
 * `records: [...]` in a `defineContract` call, or `clientPackage(xContract, [...])`.
 * The edit finds the array with the TypeScript parser, so formatting and
 * comments around it stay as they are.
 */
export type ArrayTarget =
  | { readonly variable: string }
  | { readonly call: string }
  | { readonly property: string }
  | { readonly callee: string };

/** The array of a `const <variable> = [...]` declaration, or `null`. */
function variableArray(node: ts.Node, name: string): ts.ArrayLiteralExpression | null {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name) {
    return null;
  }
  return node.initializer && ts.isArrayLiteralExpression(node.initializer)
    ? node.initializer
    : null;
}

/** The array of a `<name>: [...]` property, or `null`. */
function propertyArray(
  node: ts.Node,
  file: ts.SourceFile,
  name: string,
): ts.ArrayLiteralExpression | null {
  if (!ts.isPropertyAssignment(node) || node.name.getText(file) !== name) {
    return null;
  }
  return ts.isArrayLiteralExpression(node.initializer) ? node.initializer : null;
}

/** The first argument of a `x.<name>([...])` call when it is an array, or `null`. */
function methodArray(node: ts.Node, name: string): ts.ArrayLiteralExpression | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  const [first] = node.arguments;
  return node.expression.name.text === name && first && ts.isArrayLiteralExpression(first)
    ? first
    : null;
}

/** The last argument of a `<name>(..., [...])` call when it is an array, or `null`. */
function calleeArray(node: ts.Node, name: string): ts.ArrayLiteralExpression | null {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
    return null;
  }
  const last = node.arguments.at(-1);
  return node.expression.text === name && last && ts.isArrayLiteralExpression(last) ? last : null;
}

/** The array literal that one node holds for a target, or `null` when the node holds none. */
function arrayAt(
  node: ts.Node,
  file: ts.SourceFile,
  target: ArrayTarget,
): ts.ArrayLiteralExpression | null {
  if ('variable' in target) {
    return variableArray(node, target.variable);
  }
  if ('property' in target) {
    return propertyArray(node, file, target.property);
  }
  if ('call' in target) {
    return methodArray(node, target.call);
  }
  return calleeArray(node, target.callee);
}

/** The array literal that a target names, or `null` when the file has none. */
function findArray(file: ts.SourceFile, target: ArrayTarget): ts.ArrayLiteralExpression | null {
  let found: ts.ArrayLiteralExpression | null = null;
  function visit(node: ts.Node) {
    if (found) {
      return;
    }
    found = arrayAt(node, file, target);
    if (!found) {
      ts.forEachChild(node, visit);
    }
  }
  visit(file);
  return found;
}

/** A readable name of a target, for the error that says the list is missing. */
function nameOf(target: ArrayTarget): string {
  if ('variable' in target) {
    return `const ${target.variable}`;
  }
  if ('call' in target) {
    return `.${target.call}(...)`;
  }
  if ('property' in target) {
    return `${target.property}: [...]`;
  }
  return `${target.callee}(..., [...])`;
}

/** Adds `element` at the end of the target array. An element that is already there stays once. */
export function addToArray(source: string, target: ArrayTarget, element: string): string {
  const file = ts.createSourceFile('registry.ts', source, ts.ScriptTarget.Latest, true);
  const array = findArray(file, target);
  if (!array) {
    throw new Error(
      `No array literal for \`${nameOf(target)}\`. Add the list by hand, then run again.`,
    );
  }
  if (array.elements.some((item) => item.getText(file) === element)) {
    return source;
  }
  const last = array.elements.at(-1);
  if (!last) {
    const open = array.getStart(file) + 1;
    return `${source.slice(0, open)}${element}${source.slice(open)}`;
  }
  const end = last.getEnd();
  return `${source.slice(0, end)}, ${element}${source.slice(end)}`;
}

/** Adds an import line after the last import. A line that is already there stays once. */
export function addImport(source: string, line: string): string {
  if (source.includes(line)) {
    return source;
  }
  const file = ts.createSourceFile('registry.ts', source, ts.ScriptTarget.Latest, true);
  const imports = file.statements.filter((statement) => ts.isImportDeclaration(statement));
  const last = imports.at(-1);
  if (!last) {
    return `${line}\n\n${source}`;
  }
  const end = last.getEnd();
  return `${source.slice(0, end)}\n${line}${source.slice(end)}`;
}

/**
 * Makes sure that named imports from one module exist, in one import line of
 * the same kind (a value import or an `import type`). The names already there
 * stay, and the missing ones are added in sorted order. A module with no such
 * line gets a new one after the last import.
 */
export function mergeNamedImport(
  source: string,
  module: string,
  names: ReadonlyArray<string>,
  typeOnly: boolean,
): string {
  const file = ts.createSourceFile('registry.ts', source, ts.ScriptTarget.Latest, true);
  const existing = file.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === module &&
      (statement.importClause?.isTypeOnly ?? false) === typeOnly &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings),
  );
  if (
    !existing ||
    !existing.importClause?.namedBindings ||
    !ts.isNamedImports(existing.importClause.namedBindings)
  ) {
    const line = `import ${typeOnly ? 'type ' : ''}{ ${[...names].toSorted().join(', ')} } from '${module}';`;
    return addImport(source, line);
  }
  const current = existing.importClause.namedBindings.elements.map((element) => element.name.text);
  const merged = [...new Set([...current, ...names])].toSorted();
  if (merged.length === current.length) {
    return source;
  }
  const line = `import ${typeOnly ? 'type ' : ''}{ ${merged.join(', ')} } from '${module}';`;
  return `${source.slice(0, existing.getStart(file))}${line}${source.slice(existing.getEnd())}`;
}

/** The start of the comment block that sits directly above a statement, or the statement itself. */
function commentStart(source: string, statement: ts.Statement): number {
  const ranges = ts.getLeadingCommentRanges(source, statement.getFullStart()) ?? [];
  let start = statement.getStart();
  for (const range of ranges.toReversed()) {
    const gap = source.slice(range.end, start);
    if (gap.split('\n').length > 2 || gap.trim() !== '') {
      break;
    }
    start = range.pos;
  }
  return start;
}

/**
 * Inserts `text` on its own lines before the contract declaration: the
 * top-level `const <name>Contract = defineContract(...)` statement. The
 * JSDoc comment above that statement moves down with it, so the new text
 * lands above the comment.
 */
export function insertBeforeContract(source: string, text: string): string {
  const file = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true);
  const statement = file.statements.find(
    (candidate): candidate is ts.VariableStatement =>
      ts.isVariableStatement(candidate) &&
      candidate.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text.endsWith('Contract') &&
          declaration.initializer !== undefined &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text === 'defineContract',
      ),
  );
  if (!statement) {
    throw new Error(
      'The contract file has no `const <name>Contract = defineContract(...)` statement. Declare the contract with `defineContract` first, then run again.',
    );
  }
  const at = commentStart(source, statement);
  return `${source.slice(0, at)}${text}\n\n${source.slice(at)}`;
}

/** Whether a file declares a top-level constant with this name. */
export function declaresConstant(source: string, name: string): boolean {
  const file = ts.createSourceFile('declared.ts', source, ts.ScriptTarget.Latest, true);
  return file.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
      ),
  );
}
