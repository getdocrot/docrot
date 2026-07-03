// Docs examples are often intentionally partial. The worst thing docrot could
// do is scream about pseudo-code, so anything that smells like an on-purpose
// fragment is skipped instead of failed. These heuristics only run when a
// block already failed to parse — valid code is never demoted.

const ELLIPSIS_LINE_RE = /^\s*(?:\/\/|#|--|\/\*|<!--|;)?\s*(?:\.{3,}|…)\s*(?:\*\/|-->)?[,;]?\s*$/m;
const UPPER_PLACEHOLDER_RE = /<[A-Z][A-Z0-9]*(?:[_-][A-Z0-9]+)+>/;
const WORDY_PLACEHOLDER_RE = /<(?:your|my|the|insert)[-_ ][^>\n]{1,60}>/i;
const MUSTACHE_RE = /\{\{[^{}\n]+\}\}/;
const SNIP_COMMENT_RE = /^\s*(?:\/\/|#|\/\*)\s*(?:snip|\.{3}\s*$|omitted|rest of|more code|etc\.?\s*$)/im;

export function partialReason(code: string): string | null {
  if (code.includes('…')) return 'partial example (`…`)';
  if (ELLIPSIS_LINE_RE.test(code)) return 'partial example (`...`)';
  if (/[([{,]\s*\.{3}\s*[)\]},]/.test(code)) return 'partial example (`...`)';
  if (/(^|[\s(])\.{3}\s*$/m.test(code)) return 'partial example (`...`)'; // `try ...`
  if (/=\s*\.{3}\s*(\/\/|;|,|\)|$)/m.test(code)) return 'partial example (`= ...`)';
  if (/\(\s*[\w.$'"]+\[,\s*[\w.$\s]+\]/.test(code)) return 'signature notation (`fn(a[, b])`)';
  if (UPPER_PLACEHOLDER_RE.test(code)) return 'placeholder values';
  if (WORDY_PLACEHOLDER_RE.test(code)) return 'placeholder values';
  if (MUSTACHE_RE.test(code)) return 'template placeholders';
  if (SNIP_COMMENT_RE.test(code)) return 'partial example (snipped)';
  return null;
}

export function tooTrivial(code: string): boolean {
  return code.trim().length < 4;
}

// Thrown-error output and stack traces get fenced as ```js often enough that
// they deserve their own escape hatch.
export function outputReason(code: string): string | null {
  if (/^\s+at .+ \(.+\)\s*$/m.test(code)) return 'console output, not code';
  if (/^[A-Za-z]+Error: /m.test(code) && /^\s*\^\s*$/m.test(code)) return 'console output, not code';
  return null;
}
