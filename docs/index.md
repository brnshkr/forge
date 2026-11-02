# 📚 Documentation

Reference documentation for the images, Compose fragments, and workflows shipped by **@brnshkr/forge**.
Installation and usage live in the [README](../README.md); these pages cover what each image holds,
how a project runs the fragments, how it deploys, and what the workflows need.

- [📦 Images](./images/index.md) — PHP-only, Bun-only, and combined toolchains and app runtimes
  - [Web server](./images/web-server.md), [PHP settings](./images/php.md), and [your image](./images/your-image.md)
- [🐳 Compose](./compose/index.md) — the fragments, how a project includes them, and how to change one
  - [CLI](./compose/cli.md), [development](./compose/development.md), [production](./compose/production.md),
    and [tools](./compose/tools.md)
  - [Messenger](./compose/messenger.md), [Mercure](./compose/mercure.md), [Postgres](./compose/postgres.md),
    [Valkey](./compose/valkey.md), and [Mailpit](./compose/mailpit.md)
- [🚀 Deploy](./deploy/index.md) — releasing your image onto your servers
  - [Stages](./deploy/stages.md), [hooks](./deploy/hooks.md), [server](./deploy/server.md),
    [zero downtime](./deploy/zero-downtime.md), [shared services](./deploy/shared.md),
    and [secrets](./deploy/secrets.md)
- [🐙 GitHub](./github/index.md) — the workflows your repository calls
  - [Setup](./github/setup.md), [checks](./github/checks.md), [publishing](./github/publishing.md),
    [deploying](./github/deploying.md), [security](./github/security.md), and [Dependabot](./github/dependabot.md)
  - [Skipping jobs](./github/skipping-jobs.md) and [without @brnshkr/config](./github/without-config.md)
- [🔖 Releases](./releases.md) — what each branch builds, what a release publishes, and its tags
- [📌 Pins](./pins.md) — where versions are pinned and how they are kept current
- [💻 Development](./development.md) — working on @brnshkr/forge itself
