import type { PayloadFields } from '@repo/sync/contract/job';

/** The methods that a route answers. */
export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * One HTTP route, as a contract declares it: its name, its method and path,
 * the JSON body that it decodes, and who calls it. The code that answers it is
 * in `runtime/routes.server.ts`.
 */
export type RouteDeclaration<
  Name extends string = string,
  F extends PayloadFields = PayloadFields,
> = {
  readonly kind: 'route';
  readonly name: Name;
  readonly method: RouteMethod;
  readonly path: `/${string}`;
  /** The JSON body that the route decodes, or `'none'`. */
  readonly body: F | 'none';
  /** One sentence: who calls the route and why. */
  readonly says: string;
};

const routeName = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u;

/**
 * Declares one HTTP route. The name is `<contract>/<name>` in kebab case, such
 * as `notes/import-note`. `says` names the caller and the reason, and it is
 * never empty.
 */
export function route<const Name extends string, const F extends PayloadFields>(
  name: Name,
  definition: {
    readonly method: RouteMethod;
    readonly path: `/${string}`;
    readonly body: F | 'none';
    readonly says: string;
  },
): RouteDeclaration<Name, F> {
  if (!routeName.test(name)) {
    throw new Error(
      `The route name "${name}" is not \`<contract>/<name>\` in kebab case, such as \`notes/import-note\`.`,
    );
  }
  if (definition.says.trim() === '') {
    throw new Error(
      `The route ${name} has no \`says\`. Write one sentence on who calls it and why.`,
    );
  }
  return { kind: 'route', name, ...definition };
}
