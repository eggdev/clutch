type Json = null | boolean | number | string | Array<Json> | { [key: string]: Json };
type JsonObject = Record<string, Json>;

export type Conflict = { path: string; project: Json; template: Json };

/** Keys that name the project. The template's values never replace them. */
const identity = new Set(['name', 'version', 'description', 'license', 'private']);

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Says whether the project keeps its own value at a clashing path, such as `scripts.validate`. */
type Keep = (path: string) => boolean;

function merge(
  project: JsonObject,
  template: JsonObject,
  at: Array<string>,
  conflicts: Array<Conflict>,
  keep: Keep,
) {
  const result: JsonObject = { ...project };
  for (const [key, value] of Object.entries(template)) {
    const own = project[key];
    const path = [...at, key];
    if (own === undefined) {
      result[key] = value;
    } else if (isObject(own) && isObject(value)) {
      result[key] = merge(own, value, path, conflicts, keep);
    } else if (Array.isArray(own) && Array.isArray(value)) {
      result[key] = [
        ...own,
        ...value.filter((item) => !own.some((mine) => Bun.deepEquals(mine, item))),
      ];
    } else if (!Bun.deepEquals(own, value) && !keep(path.join('.'))) {
      result[key] = value;
      conflicts.push({ path: path.join('.'), project: own, template: value });
    }
  }
  return result;
}

/**
 * Merges the template's root package.json into the project's. Objects merge
 * key by key, and lists keep the items of both. When both sides set a different
 * value, the template's value wins and the clash goes into `conflicts`, unless
 * `keep` says the project keeps its own value at that path.
 */
export function mergePackageJson(
  project: JsonObject,
  template: JsonObject,
  keep: Keep = () => false,
) {
  const conflicts: Array<Conflict> = [];
  const shared = Object.fromEntries(Object.entries(template).filter(([key]) => !identity.has(key)));
  return { manifest: merge(project, shared, [], conflicts, keep), conflicts };
}
