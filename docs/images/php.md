# 🐘 PHP settings [🔍](../../docker/php/ 'Go to source')

`forge:<tag>`, `forge-php:<tag>`, and the PHP app `-dev` images start from PHP's `php.ini-development`;
the PHP app production images start from `php.ini-production`.
On top, [`90-forge.ini`](../../docker/php/90-forge.ini) sets the timezone, the memory and upload limits,
strict and secure session cookies, and a bigger opcache.
`forge-app:<tag>` and `forge-php-app:<tag>` also add [`91-forge-production.ini`](../../docker/php/91-forge-production.ini),
which enables the JIT and turns off the timestamp checks.

## Customizing

Override anything in `./conf/php/*.ini`, which PHP reads last:

```ini
; ./conf/php/preload.ini

opcache.preload=/app/config/preload.php
```

Or pass it through FrankenPHP:

```dotenv
# ./.env

FRANKENPHP_CONFIG=php_ini memory_limit 512M
```
