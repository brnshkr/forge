import { file } from 'bun';
import path from 'node:path';

import { isPlainObject, objectEntries, readOwnValue } from '#src/shared/utils/object';

export type NpmState = 'new' | 'published' | 'known';

interface SecretState {
  readonly hasNpmToken: boolean;
  readonly hasPackagistCredentials: boolean;
  readonly npm: string;
  readonly npmState: NpmState;
  readonly packagist: string;
}

export interface Manifests {
  readonly composer: unknown;
  readonly npm: unknown;
}

const DEVELOPMENT_VERSION = '0.0.0-dev';

const SHARED_MANIFEST_FIELDS = <const>[
  'description',
  'homepage',
  'license',
];

const MANIFEST_FILES = <const>{
  composer: 'composer.json',
  npm: 'package.json',
} satisfies Record<keyof Manifests, string>;

const readManifestField = (manifest: unknown, field: string): unknown => (isPlainObject(manifest)
  ? readOwnValue(manifest, field)
  : undefined);

/**
 * @rejects {SyntaxError}
 */
const readManifest = async (filePath: string): Promise<unknown> => {
  const manifest = file(filePath);

  return await manifest.exists() ? manifest.json() : undefined;
};

/**
 * @rejects {SyntaxError}
 */
export const readManifests = async (directory: string): Promise<Manifests> => {
  const [composer, npm] = await Promise.all([
    readManifest(path.join(directory, MANIFEST_FILES.composer)),
    readManifest(path.join(directory, MANIFEST_FILES.npm)),
  ]);

  return {
    composer,
    npm,
  };
};

const findVersionIssues = (manifests: Manifests): string[] => objectEntries(MANIFEST_FILES)
  .flatMap(([manifest, fileName]) => {
    const version = readManifestField(readOwnValue(manifests, manifest), 'version');

    return (typeof version === 'string' && version !== DEVELOPMENT_VERSION)
      ? [`Version in "${fileName}" must be "${DEVELOPMENT_VERSION}", "${version}" given.`]
      : [];
  });

const findAgreementIssues = (manifests: Manifests): string[] => {
  if (manifests.composer === undefined || manifests.npm === undefined) {
    return [];
  }

  const fieldIssues = SHARED_MANIFEST_FIELDS
    .filter((field) => readManifestField(manifests.composer, field) !== readManifestField(manifests.npm, field))
    .map((field) => `Field "${field}" differs between "composer.json" and "package.json".`);

  const composerName = readManifestField(manifests.composer, 'name');

  return (typeof composerName === 'string' && readManifestField(manifests.npm, 'name') === `@${composerName}`)
    ? fieldIssues
    : [...fieldIssues, 'Name in "package.json" must be "@" followed by the name in "composer.json".'];
};

export const findManifestIssues = (manifests: Manifests): string[] => [
  ...findVersionIssues(manifests),
  ...findAgreementIssues(manifests),
];

export const readPackageTargets = (manifests: Manifests): Record<'npm' | 'packagist', string> => {
  const npmName = readManifestField(manifests.npm, 'name');
  const composerName = readManifestField(manifests.composer, 'name');

  return {
    npm: (typeof npmName === 'string' && readManifestField(manifests.npm, 'private') !== true)
      ? npmName
      : '',
    packagist: (typeof composerName === 'string' && readManifestField(manifests.composer, 'type') !== 'project')
      ? composerName
      : '',
  };
};

export const findSecretIssues = (secretState: SecretState): string[] => [
  ...(secretState.packagist !== '' && !secretState.hasPackagistCredentials)
    ? [`Packagist requires "PACKAGIST_USERNAME" and "PACKAGIST_TOKEN" for "${secretState.packagist}".`]
    : [],
  ...(secretState.npm !== '' && secretState.npmState === 'new' && !secretState.hasNpmToken)
    ? [`The first npm release of "${secretState.npm}" requires "NPM_CONFIG_TOKEN".`]
    : [],
  ...(secretState.npm !== '' && secretState.npmState === 'known' && secretState.hasNpmToken)
    ? [`Package "${secretState.npm}" already exists on npm. Remove "NPM_CONFIG_TOKEN" to publish from this workflow.`]
    : [],
];
