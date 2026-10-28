import ts from 'typescript';

/**
 * Small, exact edits to registration files: one import line, and one element
 * in one array. A registration file has one array per list, such as
 * `export const commands = [...notesCommands];` or `addChildren([homeRoute])`.
 * The edit finds the array with the TypeScript parser, so formatting and
 * comments around it stay as they are.
 */
export type ArrayTarget = { readonly variable: string } | { readonly call: string };

function findArray(file: ts.SourceFile, target: ArrayTarget): ts.ArrayLiteralExpression | null {
  let found: ts.ArrayLiteralExpression | null = null;
  function visit(node: ts.Node) {
    if (found) {
      return;
    }
    if (
      'variable' in target &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === target.variable &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
      return;
    }
    if (
      'call' in target &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === target.call
    ) {
      const [first] = node.arguments;
      if (first && ts.isArrayLiteralExpression(first)) {
        found = first;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

/** Adds `element` at the end of the target array. An element that is already there stays once. */
export function addToArray(source: string, target: ArrayTarget, element: string): string {
  const file = ts.createSourceFile('registry.ts', source, ts.ScriptTarget.Latest, true);
  const array = findArray(file, target);
  if (!array) {
    const name = 'variable' in target ? `const ${target.variable}` : `.${target.call}(...)`;
    throw new Error(`No array literal for \`${name}\`. Add the list by hand, then run again.`);
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
