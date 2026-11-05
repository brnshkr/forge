# 📤 Publishing [🔍](../../.github/workflows/publish.yaml 'Go to source')

`publish.yaml` builds, verifies, and scans your images on every push. On `release/*` it publishes the release.

## Usage

```yaml
# ./.github/workflows/ci.yaml

jobs:
  publish:
    permissions:
      contents: write
      id-token: write
      packages: write
      pages: write
      security-events: write
    uses: brnshkr/forge/.github/workflows/publish.yaml@<commit> # <tag>
    with:
      namespace: acme-images
    secrets:
      BOT_CLIENT_ID: ${{ secrets.BOT_CLIENT_ID }}
      BOT_PRIVATE_KEY: ${{ secrets.BOT_PRIVATE_KEY }}
      NPM_CONFIG_TOKEN: ${{ secrets.NPM_CONFIG_TOKEN }}
      PACKAGIST_TOKEN: ${{ secrets.PACKAGIST_TOKEN }}
      PACKAGIST_USERNAME: ${{ secrets.PACKAGIST_USERNAME }}
```

Images and Compose fragments go to `ghcr.io/<owner>`, or to `ghcr.io/acme-images` with the `namespace` above.
A fragment is named after your repository, e.g. `ghcr.io/<owner>/acme-shop-compose-postgres`.
Another registry takes the `registry` input and the `REGISTRY_USERNAME` and `REGISTRY_TOKEN` secrets.
`image.yaml` builds the images. Stages sharing a Dockerfile build in two waves on one cache.
Take a look at the [releases](../releases.md) for what a release includes and in which order.

### Mirror

Every release tag can also go to a second registry, e.g. Docker Hub:

```sh
gh variable set MIRROR_REGISTRY --body docker.io
gh variable set MIRROR_NAMESPACE --body acme
gh secret set MIRROR_REGISTRY_USERNAME --body acme
gh secret set MIRROR_REGISTRY_TOKEN
```

Without `MIRROR_REGISTRY_TOKEN`, nothing is mirrored.

## Trusted publishing

Publishing to npm and Packagist runs in the environment `registry`.
npm trusts a workflow only for a package that already exists, so a package's first release takes a token:

1. Create the environment `registry` under _Settings → Environments_.
2. Add a granular npm token as the secret `NPM_CONFIG_TOKEN`, then release.
3. On npmjs.com, add a trusted publisher to the package: your repository, your caller `ci.yaml`,
   and the environment `registry`.
4. Delete `NPM_CONFIG_TOKEN`. A leftover token fails the next release.

## Customizing

| Input | Falls back to | Changes |
| --- | --- | --- |
| `registry` | — | where images and fragments go |
| `namespace` | the repository owner | which namespace is used there |
| `mirror-registry` | the `MIRROR_REGISTRY` variable | where every release tag also goes |
| `mirror-namespace` | the `MIRROR_NAMESPACE` variable, else `namespace` | which namespace is used there |
| `deploy-targets` | every stage file that sets `DEPLOY_HOSTS` | which targets are deployed |
| `group-image-builds` | — | whether stages sharing a Dockerfile build in two waves |
| `changelog-directory` | the Makefile's `CHANGELOG_DIR` | where the changelog is written |
| `pages-command` | — | how the site is built |
| `pages-directory` | — | where the site is written |

The defaults are in [`publish.yaml`](../../.github/workflows/publish.yaml).

A `pages` target or `pages-command` publishes a site on every release through the environment `github-pages`.
Set _Settings → Pages → Source_ to _GitHub Actions_ once.

### Without the shared Makefile

| Input | Changes | Gets |
| --- | --- | --- |
| `build-command` | how the npm package is built | — |
| `changelog-notes-command` | how the release notes are printed | `CHANGELOG_URL`, `VERSION` |
| `changelog-write-command` | how the changelog is written | `CHANGELOG_URL`, `VERSION` |

A release commits only the changelog directory and leaves it out of the npm package.
Your stages, Dockerfiles, and Compose files need nothing from your Makefile.
