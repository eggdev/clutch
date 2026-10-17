type Json = null | boolean | number | string | Array<Json> | { [key: string]: Json };
type JsonObject = Record<string, Json>;

export type Conflict = { path: string; project: Json; template: Json };

/** Keys that name the project. The template's values never replace them. */
const identity = new Set(['name', 'version', 'description', 'license', 'private']);

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function merge(
  project: JsonObject,
  template: JsonObject,
  at: Array<string>,
  conflicts: Array<Conflict>,
) {
  const result: JsonObject = { ...project };
  for (const [key, value] of Object.entries(template)) {
    const own = project[key];
    const path = [...at, key];
    if (own === undefined) {
      result[key] = value;
    } else if (isObject(own) && isObject(value)) {
      result[key] = merge(own, value, path, conflicts);
    } else if (Array.isArray(own) && Array.isArray(value)) {
      result[key] = [
        ...own,
        ...value.filter((item) => !own.some((mine) => Bun.deepEquals(mine, item))),
      ];
    } else if (!Bun.deepEquals(own, value)) {
      result[key] = value;
      conflicts.push({ path: path.join('.'), project: own, template: value });
    }
  }
  return result;
}

/**
 * Merges the template's root package.json into the project's. Objects merge
 * key by key, and lists keep the items of both. When both sides set a different value, the template's value
 * wins and the clash goes into `conflicts` for the kickoff interview.
 */
export function mergePackageJson(project: JsonObject, template: JsonObject) {
  const conflicts: Array<Conflict> = [];
  const shared = Object.fromEntries(Object.entries(template).filter(([key]) => !identity.has(key)));
  return { manifest: merge(project, shared, [], conflicts), conflicts };
}
