# 🐘 PHP [🔍](../../docker/php/ 'Go to source')

Every image with PHP starts from PHP's own `php.ini` and adds Forge's settings on top.

## Usage

| Role | Starts from | Adds |
| --- | --- | --- |
| `-cli`, `-cli-chromium`, `-app-dev` | `php.ini-development` | `90-forge.ini` |
| `-app` | `php.ini-production` | `90-forge.ini`, `91-forge-production.ini` |

[`90-forge.ini`](../../docker/php/90-forge.ini) sets the timezone, `expose_php`, the memory and upload limits,
the realpath cache, opcache's sizes, and strict, secure session cookies.

[`91-forge-production.ini`](../../docker/php/91-forge-production.ini) turns on the tracing JIT
and `opcache.enable_file_override`. It turns off `opcache.validate_timestamps`.
A running `-app` never rereads its code.

PHP stays on UTC whatever `TZ` says.

## Your own settings

Put your own settings in `./conf/php/`. PHP reads every `*.ini` there last:

```ini
; ./conf/php/acme-shop.ini

memory_limit=512M
date.timezone=Europe/Berlin
```

The `-cli` and `-app-dev` containers read them from your working copy.
An `-app` image reads them once it ships `./conf/php/`, see [your image](./your-image.md).
