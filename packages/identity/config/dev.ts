import { Config } from 'effect';

/**
 * The actor for local development. A project replaces this with its sign-in
 * vendor, in `runtime/`, behind the same `CurrentActor` service.
 */
export const devActor = Config.all({
  userId: Config.String('DEV_USER_ID').pipe(Config.withDefault('user-dev')),
  organizationId: Config.String('DEV_ORGANIZATION_ID').pipe(Config.withDefault('org-dev')),
});
