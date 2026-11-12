import { defineGroup } from '@repo/sync/contract/groups';

/**
 * The built-in groups of this sync engine. The engine owns this file: the
 * prefixes are in each stored event, so a project keeps the ones that its
 * data already has. The rest of `contract/` is the same in every project.
 */

/** The group of one user. Only that user loads it. A record names it with `userGroup.by`. */
export const userGroup = defineGroup('user');

/**
 * The group of an organization. Every actor in it loads it. A record of the
 * whole organization names it with `organizationGroup.ofScope`.
 */
export const organizationGroup = defineGroup('org');
