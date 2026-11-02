<h1 id="top">
  <a href="#top">
    <img
      src="https://raw.githubusercontent.com/brnshkr/brand/refs/heads/master/images/projects/forge.png"
      alt="@brnshkr/forge project logo"
      title="@brnshkr/forge"
    >
  </a>

  [![Semantic Versioning 2.0.0][semver-2.0.0-shield-url]][semver-2.0.0-url]
  [![MIT License][license-shield-url]][license-url]
  [![Stars][stars-shield-url]][stars-url]
  [![Forks][forks-shield-url]][forks-url]
  [![Issues][issues-shield-url]][issues-url]
  [![Release][release-shield-url]][release-url]
</h1>

Centralized build, test, and release infrastructure used across all [@brnshkr][@brnshkr-organization-url] projects.

_[☄️ Bug Reports / Feature Requests »][issues-url]_

<!-- omit in toc -->
## Table of Contents

<!--
  NOTICE:
  GitHub strips emojis in anchors, but multi-codepoint characters may leave invisible remnants,
  causing anchors to differ and require URL encoding.
-->
- [👋 About the Project](#-about-the-project)
- [📚 Documentation](#-documentation)
- [🧰 Prerequisites](#-prerequisites)
- [🚀 Installation](#-installation)
- [👀 Usage](#-usage)
- [❤️ Contributing](#️-contributing)
  - [💄 Commit Style](#-commit-style)
  - [⚙️ Workflows](#️-workflows)
- [🔖 Versioning](#-versioning)
- [📃 License](#-license)
- [🌐 Acknowledgments](#-acknowledgments)

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 👋 About the Project

**@brnshkr/forge** is a centralized collection of container images, Compose fragments, and reusable GitHub workflows
used to build, test, release, and deploy all [@brnshkr][@brnshkr-organization-url] projects.
It runs all projects in the same environment, locally and in CI.
It pins tool versions in one place, prevents drift between repositories, and releases every project the same way.

What you get:

- toolchain images for PHP, Bun, or both, with an optional Chromium for browser tests
- PHP-only, Bun-only, and combined PHP/Bun runtime images with hardened defaults
- Compose fragments for your application, its workers, Postgres, Valkey, Mercure, Mailpit, and a proxy
- workflows that check, scan, publish, and bump every repository, and deploy your image over SSH without downtime

[`@brnshkr/config`][config-url] defines how code is written and checked,
while this project provides the environment it is built, tested, and shipped in.

> ❗ **Note** ❗  
> While you're more than welcome to use this in your own projects, the images and workflows are tailored specifically
> for the [@brnshkr][@brnshkr-organization-url] ecosystem and may not be a perfect fit elsewhere.

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 📚 Documentation

This README covers installation and usage.
The [docs](./docs/index.md) cover the images, fragments, deploys, workflows, and the development setup in detail.

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 🧰 Prerequisites

- Docker >= v29.4 with Compose >= v5.1 (older versions may work, but are untested)
- GNU Make >= v4.3 (older versions may work, but are untested)

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 🚀 Installation

This project is not installed as a package.
Instead, you pin a release and use its published images, Compose fragments, and workflows directly.

<!-- omit in toc -->
### Compose Fragments

Include the fragments you need in your Compose file:

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/cli:${CLI_FRAGMENT_TAG:-${FORGE_TAG:?}}@${CLI_FRAGMENT_DIGEST:?}
```

Then pin the release in your `.env` file:

```dotenv
# ./.env

FORGE_TAG=<tag>
FORGE_CLI_IMAGE_DIGEST=sha256:<digest> # <version>
CLI_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

[`@brnshkr/config`][config-url]'s Makefile reads this file and passes it to Compose for you.  
Without that Makefile, pass the file, `FORGE_REPOSITORY`, `FORGE_REPOSITORY_OWNER`, and your user IDs yourself
from your project's root (example call, adjust as needed):

```sh
FORGE_REPOSITORY=ghcr.io/brnshkr/forge FORGE_REPOSITORY_OWNER=ghcr.io/brnshkr HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose --env-file ./.env --file ./conf/compose.yaml run --rm cli php --version
```

All available fragments (e.g. Postgres, Valkey, or Mailpit) are listed in the [Compose docs](./docs/compose/index.md).

<!-- omit in toc -->
### Workflows

Your repository calls `ci.yaml` and `maintenance.yaml`, both shown with the secrets and settings they need
in the [GitHub docs](./docs/github/index.md).

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 👀 Usage

How you use this project depends on what you are building.

<!-- omit in toc -->
### Libraries and Tools

Include the `cli` fragment and the Makefile runs your tools inside it:

```sh
make ci     # fixes, checks, audits, and tests, the same way CI does
make shell  # opens a shell where your tools run, `make <service>-shell` in any other service
make help   # lists everything else you can run
```

The [CLI docs](./docs/compose/cli.md) show how to pick `forge-php`, `forge-bun`, or a `-chromium` tag instead.

<!-- omit in toc -->
### Web Projects

Include `web-dev` to develop on `forge-app`'s `-dev` image, or `web-bun-dev` for a Bun app;
the [Compose docs](./docs/compose/index.md) show both:

```sh
make up     # starts your app and the other services you included
make trust  # trusts the local certificate authority, once per project
```

The PHP app is served over HTTPS at the domain name you set. The Bun fragment serves HTTP and can use the proxy for HTTPS.

<!-- omit in toc -->
### Production Images

Name your production image and pin its runtime base: `forge-app`, `forge-php-app`, or
`forge-bun-app`. Build it on the matching `-dev` image. Choose `forge-app` for PHP and Bun,
`forge-php-app` when the app needs no Bun, or `forge-bun-app` for Bun-only apps.

```dotenv
# ./.env.production

IMAGE_NAME=acme-shop
IMAGE_TARGET=prod
FORGE_RUNTIME_IMAGE_DIGEST=sha256:<digest> # <version>
```

`publish.yaml` builds and scans it on every push and pushes it on each release, from your committed files only.
Without a Dockerfile of your own, Forge's builds it, as the [Images docs](./docs/images/your-image.md)
show along with what you can change; running it in production is shown in the [Compose docs](./docs/compose/production.md),
and putting it on your servers in the [Deploy docs](./docs/deploy/index.md).

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## ❤️ Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create.
Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request.
You can also simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1. Fork the project
2. Create your feature branch => `git checkout -b feature/my-new-feature`
3. Commit your changes => `git commit -m 'feat(my-new-feature): add some awesome new feature'`
4. Push to the branch => `git push origin feature/my-new-feature`
5. Open a pull request

New to the codebase?
The [Development docs](./docs/development.md) cover the setup and the day-to-day commands.

Any help is always greatly appreciated 🙂

### 💄 Commit Style

This project mostly follows the [Conventional Commits](https://www.conventionalcommits.org) specification.  
There are only a few differences. The main one is that the scope is required:  
So **instead of** this commit message signature: `<type>[optional scope]: <description>`  
You **should use** this one: `<type><scope>: <description>`  
Further details can be found in the [`@brnshkr/config` commitlint docs][commitlint-docs-url].

### ⚙️ Workflows

See the [GitHub docs](./docs/github/index.md) for more information.

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 🔖 Versioning

This project follows [Semantic Versioning 2.0.0][semver-2.0.0-url].  
Images, Compose fragments, and workflows are released together under one version,
taken from the name of the `release/*` branch they are built from.  
See the [Releases docs](./docs/releases.md) for what each branch builds and publishes.

> ❗ **Note** ❗  
> Since tool updates within a major are not considered breaking,
> even a patch release may introduce new errors in code that hasn't changed and break your CI without notice.
> We therefore strongly recommend pinning images, fragments, and workflows by digest or commit,
> so updates stay opt-in and can be applied on your own schedule.

<!-- omit in toc -->
### Changes Considered as Breaking Changes

- Removal of tools, PHP extensions, Compose fragments, image targets, or image tags
- Removal or renaming of Compose variables
- Changes to image defaults a project relies on, like its user, paths, ports, or headers
- Major version updates of PHP, Bun, or Node.js, minor version updates of PHP or Bun, and new Debian releases
- Changes to existing workflow inputs, secrets, or outputs, and new required ones

<!-- omit in toc -->
### Changes Considered as Non-Breaking Changes

- Patch version updates of PHP and Bun, minor and patch version updates of other tools, and refreshed image digests
- Introduction of tools, PHP extensions, Compose fragments, or optional workflow inputs

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 📃 License

Distributed under the MIT License. See [LICENSE](./LICENSE) for more information.

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 🌐 Acknowledgments

- [Docker](https://www.docker.com)
- [PHP](https://www.php.net)
- [docker-php-extension-installer](https://github.com/mlocati/docker-php-extension-installer)
- [FrankenPHP](https://github.com/php/frankenphp)
- [Caddy](https://github.com/caddyserver/caddy)
- [Mercure](https://github.com/dunglas/mercure)
- [Composer](https://github.com/composer/composer)
- [Bun](https://github.com/oven-sh/bun)
- [Node.js](https://github.com/nodejs/node)
- [Semgrep](https://github.com/semgrep/semgrep)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [OSV-Scanner](https://github.com/google/osv-scanner)
- [BuildKit](https://github.com/moby/buildkit)
- [ShellCheck](https://github.com/koalaman/shellcheck)
- [hadolint](https://github.com/hadolint/hadolint)
- [actionlint](https://github.com/rhysd/actionlint)
- [Trivy](https://github.com/aquasecurity/trivy)
- [PostgreSQL](https://www.postgresql.org)
- [Valkey](https://github.com/valkey-io/valkey)
- [Mailpit](https://github.com/axllent/mailpit)
- [GNU Make](https://www.gnu.org/software/make)
- [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
- [Choose an Open Source License](https://choosealicense.com)
- [Shields.io](https://shields.io)
- <a href="https://github.com/brnshkr">
    <img src="https://avatars.githubusercontent.com/u/180693849" width="24" align="center" alt="@brnshkr organization logo">
    @brnshkr organization
  </a>

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

<!-- END OF CONTENT -->

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[@brnshkr-organization-url]: https://github.com/brnshkr
[config-url]: https://github.com/brnshkr/config
[commitlint-docs-url]: https://github.com/brnshkr/config/blob/master/docs/js/commitlint.md

[semver-2.0.0-url]: https://semver.org/#semantic-versioning-200
[semver-2.0.0-shield-url]: https://img.shields.io/badge/semver-2.0.0-blue?label=🔖%20semver&style=flat-square&labelColor=%237f399d&color=%23a5097e

[license-url]: https://github.com/brnshkr/forge/blob/HEAD/LICENSE
[license-shield-url]: https://img.shields.io/github/license/brnshkr/forge.svg?label=📃%20license&style=flat-square&labelColor=%237f399d&color=%23a5097e

[stars-url]: https://github.com/brnshkr/forge/stargazers
[stars-shield-url]: https://img.shields.io/github/stars/brnshkr/forge.svg?label=⭐%20stars&style=flat-square&labelColor=%237f399d&color=%23a5097e

[forks-url]: https://github.com/brnshkr/forge/network/members
[forks-shield-url]: https://img.shields.io/github/forks/brnshkr/forge.svg?label=🍴%20forks&style=flat-square&labelColor=%237f399d&color=%23a5097e

[issues-url]: https://github.com/brnshkr/forge/issues
[issues-shield-url]: https://img.shields.io/github/issues/brnshkr/forge.svg?label=🚨%20issues&style=flat-square&labelColor=%237f399d&color=%23a5097e

[release-url]: https://github.com/brnshkr/forge/releases
[release-shield-url]: https://img.shields.io/github/v/release/brnshkr/forge?include_prereleases&style=flat-square&label=📦%20release&labelColor=7f399d&color=%23a5097e
