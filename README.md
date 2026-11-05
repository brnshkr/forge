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

**@brnshkr/forge** is a set of pinned toolchain and runtime images, Compose fragments, and GitHub workflows
for [@brnshkr][@brnshkr-organization-url] projects.
One release pins every tool version. Your machine, CI, and your servers run the same binaries.

Forge is not installed as a package.
A project pins a release in `.env` and uses the published images, fragments, and workflows directly.
The maintenance workflow bumps those pins.

It works best with [@brnshkr/config][config-url]. Its shared Makefile runs every tool inside the project's container.
Everything also works without it, with plain `docker compose`.

> ❗ **Note** ❗  
> While you're more than welcome to use this in your own projects, the images and workflows are tailored specifically
> for the [@brnshkr][@brnshkr-organization-url] ecosystem and may not be a perfect fit elsewhere.

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 📚 Documentation

This README covers installation and usage.
The [docs](./docs/index.md) cover images, Compose fragments, deployment, and GitHub workflows,
with a guide for each kind of project.

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 🧰 Prerequisites

- Docker >= v29.4 with Compose >= v5.1 (older versions may work, but are untested)
- GNU Make >= v4.3, for the shared Makefile of [@brnshkr/config][config-url]

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 🚀 Installation

<!-- omit in toc -->
### Compose Fragments

Include a fragment in your Compose file and pin it in `.env`. The smallest working setup, for a library:

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_FRAGMENT_NAMESPACE:-${FORGE_NAMESPACE:?}}/forge-compose-cli:${FORGE_TAG:?}@${FORGE_CLI_FRAGMENT_DIGEST:?}
```

```ini
# ./.env

FORGE_TAG=<tag>
FORGE_CLI_IMAGE_DIGEST=sha256:<digest> # <version>
FORGE_CLI_FRAGMENT_DIGEST=sha256:<digest> # <version>
```

Read each digest once, e.g. with `docker buildx imagetools inspect docker.io/brnshkr/forge:<tag>-cli`.
After that the maintenance workflow bumps it.

Projects pull Forge's images and fragments from `docker.io/brnshkr`.
Set `FORGE_NAMESPACE=ghcr.io/brnshkr` to pull them from GHCR instead.
The shared Makefile of [@brnshkr/config][config-url] reads your `.env`
and passes it to Compose, together with your user IDs.

<!-- omit in toc -->
#### Without the Shared Makefile

Set the same variables yourself:

```sh
FORGE_NAMESPACE=docker.io/brnshkr HOST_UID=$(id -u) HOST_GID=$(id -g) \
  docker compose --env-file ./.env --file ./conf/compose.yaml run --rm cli php --version
```

<!-- omit in toc -->
### Workflows

Call `ci.yaml` and `maintenance.yaml` from your repository's own workflows.
The [GitHub docs](./docs/github/setup.md) show both callers.

<p align="right"><a href="#top" title="Back to top">&nbsp;&nbsp;&nbsp;⬆&nbsp;&nbsp;&nbsp;</a></p>

## 👀 Usage

The commands below are targets of the shared
[🛠️ `make`](https://github.com/brnshkr/config/blob/master/docs/Makefile.md).
Each guide shows the plain `docker compose` way as well.

<!-- omit in toc -->
### 🧱 Libraries and Tools

Include the `cli` fragment as shown above. For browser tests, include `cli-chromium` instead.

```sh
make ci
make shell
make help
```

`make ci` runs every check, `make shell` opens a shell in the container, and `make help` lists every target.
See the [library guide](./docs/guides/library.md) for the full setup.

<!-- omit in toc -->
### 🐘 PHP Apps

Include the `php-app-dev` and `php-worker-dev` fragments.

```sh
make up
make trust
```

`make up` starts the app and its worker. `make trust` makes your browsers trust the app's certificate.
Then open the app on its `SERVER_NAME`, e.g. `https://acme-shop.internal`.
The [PHP app guide](./docs/guides/php-app.md) has the full setup.

<!-- omit in toc -->
### 🥟 Bun Apps

Include the `bun-app-dev` and `bun-worker-dev` fragments.

```sh
make up
```

With `APP_HTTP_PORT=3000`, the app answers on `http://127.0.0.1:3000`.
The full setup is in the [Bun app guide](./docs/guides/bun-app.md).

<!-- omit in toc -->
### 📦 Production Images

A stage file names the image your project ships:

```ini
# ./.env.production

IMAGE_NAME=acme-shop
IMAGE_TARGET=prod
FORGE_APP_IMAGE_DIGEST=sha256:<digest> # <version>
```

Every push builds and scans it. Every release publishes it.
Take a look at the [image docs](./docs/images/your-image.md) and the [deploy docs](./docs/deploy/index.md).

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
