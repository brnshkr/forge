# 🛡️ Security [🔍](../../.github/workflows/security.yaml 'Go to source')

`security.yaml` runs four scanners. Each fails the run on a finding and lists it in your repository's _Security_ tab.

## Usage

```yaml
# ./.github/workflows/maintenance.yaml

jobs:
  security:
    permissions:
      contents: read
      security-events: write
    uses: brnshkr/forge/.github/workflows/security.yaml@<commit> # <tag>
    with:
      scan-images: '["ghcr.io/acme/acme-base:<tag>"]'
```

| Scanner | Scans |
| --- | --- |
| Semgrep | your sources |
| Gitleaks | your Git history |
| OSV-Scanner | your lock files |
| Trivy | each image build in `publish.yaml`, and your released images on a schedule |

On a schedule, Trivy scans the widest tags of your newest stable release. Before the first one, it scans your newest
prerelease. `scan-images` adds more. An image not published yet is skipped.
Every fixable MEDIUM, HIGH, or CRITICAL finding fails the run.

Dismissing an alert in the _Security_ tab never makes a run pass. Only the files below accept a finding.

## Accepting findings

Turn a Semgrep rule off in `./conf/semgrep.dist.yaml`,
see the [Semgrep docs](https://github.com/brnshkr/config/blob/master/docs/semgrep.md#customizing).
Or turn it off for one line, with a comment above it:

```php
// nosemgrep: <rule-id>
unlink($path);
```

Accept a leak by its fingerprint:

```text
# ./conf/gitleaksignore

<commit>:<file>:<rule-id>:<line>
```

Accept a vulnerability until a date:

```toml
# ./conf/osv-scanner.toml

[[IgnoredVulns]]
id = "GHSA-<id>"
ignoreUntil = 9999-12-31
reason = "only reachable through an extension we do not load"
```

```yaml
# ./conf/trivyignore.yaml

vulnerabilities:
  - id: CVE-<year>-<number>
    statement: only reachable through an extension we do not load
    expired_at: 9999-12-31
```

## Customizing

| Input | Changes |
| --- | --- |
| `scan-images` | which published images are scanned besides your newest release's |
| `install-command` | how dependencies install |
| `semgrep-command` | how Semgrep runs |

The defaults are in [`security.yaml`](../../.github/workflows/security.yaml).

### Without the shared Makefile

Set `semgrep-command` to a command that runs Semgrep and writes its SARIF report to the path in `SARIF_FILE`.
