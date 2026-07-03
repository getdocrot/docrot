# Security Policy

## Supported versions

The latest published version on npm (`docrot-cli@latest`) is the only supported line.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: **Security → Report a vulnerability**
on this repository. You'll get a first response within 48 hours.

Please do not open public issues for security reports.

## Scope notes for reviewers

docrot is designed to be easy to audit:

- No network calls at runtime — scans are entirely local.
- No telemetry of any kind.
- No install scripts; runtime dependencies are the TypeScript compiler and a
  handful of parsing utilities.
- The only file writes happen under `--fix` (or `fix_docs` with `dryRun: false`),
  and are limited to the markdown files inside the scanned directory.

If you can make docrot write outside the scanned tree, execute code from a
scanned repository, or exfiltrate anything — we very much want to know.
