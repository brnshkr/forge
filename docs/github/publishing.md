# 📤 Publishing [🔍](../../.github/workflows/publish.yaml 'Go to source')

On every push and pull request it builds and scans your images, and on `release/*` it publishes the release.
What a release includes and in which order is described in the [Releases docs](../releases.md).

## Usage

```yaml
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
Another registry takes the `registry` input and the `REGISTRY_USERNAME` and `REGISTRY_PASSWORD` secrets.

## Trusted publishing

Publishing runs in an environment named `registry`.
npm can only trust a workflow for a package that already exists, so a package's first release takes a token:

1. Create the `registry` environment (_Settings → Environments_)
2. Add a granular npm token as the `NPM_CONFIG_TOKEN` secret and release
3. On npmjs.com, add a trusted publisher to the package: your repository, the workflow `ci.yaml`
   (your caller, not Forge's `publish.yaml`), and the environment `registry`
4. Delete `NPM_CONFIG_TOKEN`, since a leftover token fails the next release

## Customizing

A Makefile with a `pages` target, or a `pages-command`, also publishes a site to GitHub Pages on every release:
the command writes it to `./.cache/pages.cache` (`pages-directory`), and the environment `github-pages` deploys it.
Set _Settings → Pages → Source_ to _GitHub Actions_ once.
