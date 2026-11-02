# 📬 Mailpit [🔍](../../compose/mailpit.yaml 'Go to source')

`forge/compose/mailpit` runs Mailpit, which catches every mail your application sends and shows it in a web interface.
It never runs in production: a production release that includes it fails to deploy.

## Usage

```yaml
# ./conf/compose.yaml

include:
  - path: oci://${FORGE_REPOSITORY}/compose/mailpit:${MAILPIT_FRAGMENT_TAG:-${FORGE_TAG:?}}@${MAILPIT_FRAGMENT_DIGEST:?}
```

```dotenv
# ./.env

MAILPIT_MAX_MESSAGES=500
MAILPIT_SMTP_PORT=1025
MAILPIT_WEB_PORT=8025
MAILER_DSN=smtp://mailpit:${MAILPIT_SMTP_PORT}
```

The web interface listens on `127.0.0.1:<MAILPIT_WEB_PORT>`, and `MAILPIT_HOST_IP` opens it to your network.

## Customizing

Testing and staging may catch mail too, or send through a real `MAILER_DSN` instead.
On a server, the proxy shows the mails at `MAILPIT_SERVER_NAME`,
behind the login in `shared/.env.mailpit.local` (`MP_UI_AUTH` or `MP_UI_AUTH_FILE`), which only Mailpit reads;
a deploy refuses the name without one:

```dotenv
# ./.env.staging

MAILPIT_SERVER_NAME=mail.staging.acme-shop.example.com
```

```sh
ssh deploy@203.0.113.20 'printf "MP_UI_AUTH=alice:<password>\n" >>/srv/acme-shop/shared/.env.mailpit.local'
```

Everyone who logs in sees every mail, so an audience of its own takes a Mailpit of its own.
A project's own Mailpit accepts any SMTP login, since only its own network reaches it.
A Mailpit shared in `forge-shared` only accepts the SMTP logins in `/srv/forge-shared/mailpit.passwd`,
Mailpit's password file, since every project on the server could reach it.
