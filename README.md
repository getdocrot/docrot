<p align="center"><img src="docs/assets/logo.png" alt="docrot logo" width="130"></p>

# docrot

**Your docs are lying. Find out where — before your users (and their AI agents) copy-paste the lie.**

`docrot` verifies every code example, import, link and anchor in your markdown **against the code that actually ships**. Zero config. One command. CI-ready.

```bash
npx docrot-cli
```

<p align="center"><img src="docs/assets/demo.gif" alt="docrot scanning axios: real broken examples and a dead README link found in 4.5 seconds" width="820"></p>

*Real output from running docrot on axios — it found a dead link that has been sitting in the README and a config example that isn't valid JavaScript. Docs rot happens to everyone.*

## Why

Code moves on. Docs don't. Every library accumulates:

- **Phantom exports** — the README says `import { retry } from 'yourlib'`, but `retry` was renamed two majors ago.
- **Broken examples** — a TypeScript signature pasted into a runtime snippet, a `}` that never got closed, JSON with a trailing comma.
- **Dead links and anchors** — the guide that moved, the heading that got reworded, the image that never got committed.
- **Stale commands** — `npm run docs` when the script is now `docs:build`, install instructions for the package's old name.

It used to cost you a confused user. **Now it costs more: LLMs and coding agents read your docs and reproduce the lie at scale.** Your README is training data and agent context. Broken examples in, broken code out — in thousands of codebases you'll never see.

`docrot` makes "the docs are verified" a CI guarantee, like tests.

## What it checks

| Check | What it catches | Severity |
| --- | --- | --- |
| `missing-export` | Example imports a name your package doesn't export (verified against your real types) | error |
| `bad-subpath` | Example imports `pkg/sub` that your `exports` map doesn't expose | error |
| `syntax` | Code blocks that don't parse (JS/TS/JSX/TSX) | error |
| `data` | JSON/YAML blocks that don't parse | error |
| `broken-link` / `missing-image` | Relative links/images pointing at files that don't exist | error |
| `missing-anchor` | `#fragments` that match no heading (GitHub slug rules) | warning |
| `missing-script` | `npm run x` in docs, but no `x` in `package.json` scripts | error |
| `install-name` / `unknown-bin` | Install/`npx` commands using a lookalike of your package's real name | warning |
| `unknown-import` | Example imports a package that isn't a dependency (often fine) | info |

## What it deliberately does NOT flag

False positives kill linters. docrot is engineered to stay quiet about intentional things:

- **Partial examples** — blocks with `...`, `…`, `<YOUR_KEY>`, `{{ templates }}` are skipped, not failed.
- **Fragments** — API-reference notation (`axios.get(url: string): Promise`), bare config objects, class members and function types all parse in their documented shape.
- **Console output** — stack traces and error output fenced as code are recognized and skipped.
- **Changelogs** — historical documents legitimately reference old APIs; excluded by default.
- **Docs-site routes** — `/guide/config` style links and extensionless routes resolve like your static site generator would.

If docrot says it's broken, it's broken.

## Install

```bash
# nothing to install — run it right now
npx docrot-cli

# or keep it in the project (the command is `docrot`)
npm install -D docrot-cli
```

Requires Node.js 18.17+.

## CI

**GitHub Actions** (using the bundled action):

```yaml
name: docs
on: [push, pull_request]
jobs:
  docrot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: getdocrot/docrot@v1
        with:
          fail-on: error
```

Findings show up as inline annotations on the exact markdown lines. Or run it anywhere:

```bash
npx docrot-cli --reporter=github --fail-on=error
```

## Usage

```text
docrot [path] [options]

--fix                             repair mechanical rot (see below)
--dry-run                         with --fix: show changes without writing
--reporter <pretty|github|json>   output format (default: pretty)
--fail-on <error|warning|never>   exit non-zero threshold (default: error)
--only <checks>                   comma list of: examples,links,pkg
--exclude <glob>                  extra ignore globs (repeatable)
--include-changelogs              also scan CHANGELOG-style files
-v, --verbose                     show informational notes
```

### Fixing

docrot repairs the mechanical rot itself:

```bash
npx docrot-cli --fix            # apply high-confidence fixes
npx docrot-cli --fix --dry-run  # preview without writing
```

What it fixes: dead anchors (rewritten to the single unambiguous nearest heading),
lookalike script/install/bin names (`npm run build-wasm` → `build:wasm`), docs-root
style links, and missing commas in examples — a comma is only inserted where it
provably makes the whole block parse. After fixing, docrot re-scans: any file that
somehow scans worse is reverted automatically. Conservative by design; the long
tail stays human.

### Ignoring a block

Add a comment before the fence, or `docrot-ignore` to the fence meta:

````markdown
<!-- docrot-ignore -->
```js
deliberately broken example
```
````

### Config

`docrot.config.json` (or a `"docrot"` key in `package.json`):

```json
{
  "exclude": ["examples/legacy/**"],
  "includeChangelogs": false
}
```

### Programmatic API

```js
import { scan, healthGrade } from 'docrot-cli';

const result = await scan('.');
console.log(healthGrade(result), result.stats.errors);
```

## How the export check works

docrot resolves your package's real entry point (exports map → types → source), then type-checks a synthetic module that imports every name your docs claim exists. Renamed API? `docrot` tells you the line in the README and suggests the closest current name. When your types can't fully resolve locally (deps not installed), findings are downgraded to warnings instead of accusing you falsely.

## Roadmap

- Python / Go / Rust example verification
- `--fix` for the long tail: AI-assisted rewrites (bring your own key)
- Execution mode: actually run examples in a sandbox
- MCP server, so your coding agent can call docrot directly
- `llms.txt` verification — keep your AI-facing docs honest too
- Verified-docs badge service
- Semantic checks: does `client.users.list()` exist on the type?

## Contributing

`npm install && npm test`. The test fixtures are a tiny package with deliberately rotten docs — add your false-positive case there first, then make it pass.

## License

MIT
