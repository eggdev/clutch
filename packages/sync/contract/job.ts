import type { RecordField } from '@repo/sync/contract/fields';

/** The fields of a job payload. A payload is plain JSON, so it takes each record kind but the stamps. */
export type PayloadFields = Readonly<Record<string, RecordField>>;

/**
 * One job, as a contract declares it: its name and the fields of its payload.
 * The job runs after a commit asks for it, so the payload travels in the
 * outbox as plain JSON. The code that runs it is in `jobs/`.
 */
export type JobDeclaration<
  Name extends string = string,
  F extends PayloadFields = PayloadFields,
> = {
  readonly kind: 'job';
  readonly name: Name;
  readonly payload: F;
};

const jobName = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u;

/**
 * Declares one job. The name is `<contract>/<name>` in kebab case, such as
 * `notes/count-notes`. The payload gives the kind of each field.
 */
export function job<const Name extends string, const F extends PayloadFields>(
  name: Name,
  definition: { readonly payload: F },
): JobDeclaration<Name, F> {
  if (!jobName.test(name)) {
    throw new Error(
      `The job name "${name}" is not \`<contract>/<name>\` in kebab case, such as \`notes/count-notes\`.`,
    );
  }
  return { kind: 'job', name, payload: definition.payload };
}
