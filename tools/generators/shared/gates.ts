import type { Tree } from '@nx/devkit';
import ts from 'typescript';

const lintConfig = 'oxlint.config.ts';

/**
 * Registers a gated route in the `one-gate` options of the lint config: the
 * route, its gate file and its route folder. It edits the one object literal
 * named `gates`, found with the TypeScript parser.
 */
function findGates(file: ts.SourceFile): ts.ObjectLiteralExpression | null {
  let gates: ts.ObjectLiteralExpression | null = null;
  function visit(node: ts.Node) {
    if (
      !gates &&
      ts.isPropertyAssignment(node) &&
      node.name.getText(file) === 'gates' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      gates = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return gates;
}

export function addGateEntry(source: string, route: string, gate: string, routes: string) {
  const file = ts.createSourceFile(lintConfig, source, ts.ScriptTarget.Latest, true);
  const object = findGates(file);
  if (!object) {
    throw new Error(`${lintConfig} has no \`gates\` object. Restore the one-gate options.`);
  }
  const key = `'${route}'`;
  if (object.properties.some((property) => property.name?.getText(file) === key)) {
    return source;
  }
  const entry = `${key}: { gate: '${gate}', routes: '${routes}' }`;
  const last = object.properties.at(-1);
  const at = last ? last.getEnd() : object.getStart(file) + 1;
  return `${source.slice(0, at)}${last ? ', ' : ''}${entry}${source.slice(at)}`;
}

export function addGate(tree: Tree, route: string, gate: string, routes: string) {
  const source = tree.read(lintConfig, 'utf-8');
  if (source !== null) {
    tree.write(lintConfig, addGateEntry(source, route, gate, routes));
  }
}
