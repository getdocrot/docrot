# Contributing to docrot

Thanks for helping keep the world's docs honest.

## Setup

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run dev       # run the CLI from source: npm run dev -- ../some-repo
```

## The one rule: fixtures first

docrot's whole value is **precision** — a false positive is a P0 bug here. The test
fixture (`test/fixtures/proj/`) is a tiny package with deliberately rotten docs, where
every rotten block exercises one check and every intentional-convention block proves we
stay quiet about it.

- **Fixing a false positive?** Add the offending pattern to the fixture README first,
  watch the test fail, then teach the parser (usually a new shape in
  `src/checks/syntax.ts#parsesAsFragment` or a skip reason in `src/placeholders.ts`).
- **Adding a check?** Add both a rotten example (must be flagged) and a legitimate
  cousin (must not be).

## Where things live

| Area | File |
| --- | --- |
| Markdown extraction (fences, links, headings) | `src/extract.ts` |
| Syntax verification + fragment shapes | `src/checks/syntax.ts` |
| Import classification | `src/checks/imports.ts` |
| Phantom-export detection (synthetic TS program) | `src/checks/exports.ts` |
| Links and anchors (GitHub slug rules) | `src/checks/links.ts` |
| package.json references (`npm run`, install names) | `src/checks/pkgrefs.ts` |
| Intentional-fragment heuristics | `src/placeholders.ts` |

## Pull requests

- Keep PRs focused: one check, one shape, one fix.
- `npm test && npm run typecheck` must pass; CI also runs docrot on this repo's own
  README — if your change flags our docs, either our docs or your change needs fixing.
- Real-world evidence welcome: if your change is motivated by a repo in the wild,
  link the file/line in the PR description.

## Reporting false positives

Open an issue with the markdown block (fenced exactly as the original) and the finding
docrot reported. These get fixed fast — usually same day.
