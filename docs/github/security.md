# 🛡️ Security [🔍](../../.github/workflows/security.yaml 'Go to source')

Each scanner fails the run on a finding and also lists its findings in your repository's _Security_ tab.
Dismissing an alert there never makes a run pass; only the files below accept a finding.

## Usage

```yaml
jobs:
  security:
    permissions:
      contents: read
      security-events: write
    uses: brnshkr/forge/.github/workflows/security.yaml@<commit> # <tag>
    with:
      scan-images: '["ghcr.io/<owner>/acme-base:<tag>"]'
```

| Scanner | Scans |
| --- | --- |
| Semgrep | your sources |
| Gitleaks | your Git history |
| OSV-Scanner | your lock files |
| Trivy | your images: each build in `publish.yaml`, and the ones you released, on a schedule |

On a schedule, Trivy scans the widest tags of your newest stable release or, before the first, your newest prerelease.
`scan-images` adds more, and a tag not published yet is skipped.
Every fixable MEDIUM, HIGH, or CRITICAL finding fails the run.

## Customizing

Turn a Semgrep rule off in `./conf/semgrep.dist.yaml`
([Semgrep docs](https://github.com/brnshkr/config/blob/master/docs/semgrep.md#customizing)),
or a single line with a comment above it:

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
