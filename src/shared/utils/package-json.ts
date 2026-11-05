/**
 * @internal @brnshkr/forge
 */

import manifest from '#package.json' with { type: 'json' };

import type { Maybe } from '#src/shared/types/core';

export const packageFullName = manifest.name;

const packageOrganizationInternal = <Maybe<'brnshkr'>>manifest.name
  .split('/', 1)
  .at(0)
  ?.replace(/^@/v, '');

if (packageOrganizationInternal === undefined || packageOrganizationInternal.length === 0) {
  throw new Error('Package organization not found in "package.json".');
}

export const packageOrganization = packageOrganizationInternal;
export const packageName = packageFullName.slice(packageFullName.indexOf('/') + 1);
