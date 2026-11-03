import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

type Merged = { content: string; conflicts: Array<never> };

const text = (node: unknown) => (isScalar(node) ? String(node.value) : String(node));

/**
 * Adds each code folder that the template's primitive owns to the project's
 * primitive with the same id, when sync delivers that folder. The project keeps
 * its own primitives, and a template primitive that the project lacks is not
 * added, because its folders are not the project's. This is how a package that
 * Clutch ships gets its claim in each project.
 */
export function mergePrimitives(
  project: string,
  template: string,
  delivered: (folder: string) => boolean,
): Merged {
  const own = parseDocument(project);
  const primitives = own.get('primitives');
  const shipped = parseDocument(template).get('primitives');
  let added = false;
  if (isSeq(primitives) && isSeq(shipped)) {
    for (const entry of shipped.items) {
      if (!isMap(entry)) {
        continue;
      }
      const id = entry.get('id');
      const folders = entry.get('code');
      const target = primitives.items.find((item) => isMap(item) && item.get('id') === id);
      const code = isMap(target) ? target.get('code') : undefined;
      if (!isSeq(folders) || !isSeq(code)) {
        continue;
      }
      const owned = new Set(code.items.map(text));
      for (const node of folders.items) {
        const folder = text(node);
        if (!owned.has(folder) && delivered(folder)) {
          code.add(folder);
          owned.add(folder);
          added = true;
        }
      }
    }
  }
  if (!added) {
    return { content: project.endsWith('\n') ? project : `${project}\n`, conflicts: [] };
  }
  return { content: own.toString(), conflicts: [] };
}
