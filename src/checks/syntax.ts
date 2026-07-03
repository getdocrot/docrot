import ts from 'typescript';
import { parseAllDocuments } from 'yaml';
import { outputReason, partialReason, tooTrivial } from '../placeholders.js';
import type { CodeBlock, Finding } from '../types.js';

// Diagnostics that fire on perfectly reasonable documentation fragments.
export const SNIPPET_FRIENDLY_CODES = new Set([
  1108, // 'return' outside a function
  1308, // 'await' outside an async function
  1375, // top-level 'await' needs module config
  1378, // top-level 'await' needs target config
  1431, // top-level 'for await'
  1432, // top-level 'for await' target config
]);

function blockIdOf(block: CodeBlock): string {
  return `${block.file}:${block.fenceLine}`;
}

// Rule docs deliberately show broken code ("examples of incorrect code…").
// Only consulted after a block has already failed every parse shape.
const INTENTIONALLY_BROKEN_RE =
  /\b(incorrect|invalid|wrong|bad|avoid|don'?t|deprecated|broken|will (?:error|fail|throw)|fails?)\b|:::\s*incorrect/i;

/** Remove JSONC comments and trailing commas without touching strings. */
function stripJsonc(code: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += code[++i] ?? '';
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function fileNameFor(block: CodeBlock): string {
  switch (block.norm) {
    case 'ts':
      return 'snippet.ts';
    case 'tsx':
      return 'snippet.tsx';
    // README ```js blocks routinely contain JSX; .jsx accepts both.
    default:
      return 'snippet.jsx';
  }
}

function transpileErrors(code: string, fileName: string): ts.Diagnostic[] {
  const result = ts.transpileModule(code, {
    reportDiagnostics: true,
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  });
  return (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error && !SNIPPET_FRIENDLY_CODES.has(d.code),
  );
}

// API-reference docs quote fragments that are only valid in context: bare
// object literals, class/interface members, object-type bodies. If the block
// parses under any of those shapes, it is not broken.
function parsesAsFragment(code: string): boolean {
  // `axios.get(url: string): Promise<R>;` — signature notation with a dotted
  // receiver. Rewriting the receiver into an ambient function declaration
  // makes the annotations parse while anything genuinely broken still fails.
  const signaturish = code.replace(
    /^([ \t]*)([\w$]+(?:\.[\w$]+)+)(\s*(?:<[^<>\n]*>)?\()/gm,
    '$1function __sig$3',
  );
  const parses = (text: string): boolean => transpileErrors(text, 'snippet.ts').length === 0;
  const shapes = [
    `(\n${code}\n)`,
    // fluent-API docs quote chain continuations: `.option(...).parse()`
    `__docrot\n${code}`,
    // brace-less property lists: `input: 'x',\nstart: 3,`
    `({\n${code}\n})`,
    `declare class __DocRotFragment {\n${code}\n}`,
    // methods with bodies (object/class excerpts)
    `class __DocRotFragment {\n${code}\n}`,
    // array item listings: `'.a',\n'.b',`
    `[\n${code}\n]`,
    `type __DocRotFragment = {\n${code}\n};`,
    // hook/callback docs quote bare function types: `(a: A) => void`
    `type __DocRotFragment = (\n${code.replace(/;\s*$/, '')}\n);`,
    // switch-body excerpts: `case 0: // next`
    `switch (__docrot) {\n${code}\n}`,
    // loop-body excerpts with continue/break
    `function __docrot() { while (1) {\n${code}\n} }`,
    `declare module "__docrot__" {\n${signaturish}\n}`,
  ];
  if (shapes.some(parses)) return true;

  // ESTree-style spec notation (babel, estree docs):
  // `interface X <: Y {` and `enum K { "a" | "b" }`
  if (/^\s*interface\s+[\w$]+\s*<:/m.test(code) || /^\s*(extend\s+)?enum\s+[\w$]+\s*\{\s*"/m.test(code)) {
    const specced = code
      .replace(/<:/g, 'extends')
      .replace(/\benum\s+([\w$]+)\s*\{([^}]*)\}/g, 'type $1 = $2;');
    if (parses(`declare module "__docrot__" {\n${specced}\n}`)) return true;
  }

  // Annex-B HTML-like comments are valid script-mode JS; the TS module
  // parser rejects them, so strip and retry.
  if (/<!--|-->/.test(code)) {
    const stripped = code.replace(/<!--[^\n]*/g, '').replace(/^\s*-->[^\n]*/gm, '');
    if (parses(stripped)) return true;
  }

  // Alternatives listing: several standalone snippets in one fence,
  // separated by blank or comment-only lines. Valid iff every chunk is.
  const chunks: string[] = [];
  let current: string[] = [];
  for (const line of code.split('\n')) {
    if (/^\s*$/.test(line) || /^\s*\/\/.*$/.test(line) || /^\s*\/\*.*\*\/\s*$/.test(line)) {
      if (current.length) chunks.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) chunks.push(current.join('\n'));
  if (chunks.length >= 2 && chunks.length <= 12) {
    if (chunks.every((c) => parses(c) || parses(`(\n${c}\n)`))) return true;
  }

  // Walkthrough docs quote regions that begin or end mid-block. Peel
  // orphan closer lines from either end progressively — stripping them all
  // at once eats legitimate braces too.
  const allLines = code.split('\n');
  const isCloser = (l: string | undefined): boolean => l !== undefined && /^\s*[}\])]+[;,]?\s*$/.test(l);
  let maxLead = 0;
  while (maxLead < 3 && isCloser(allLines[maxLead])) maxLead++;
  let maxTrail = 0;
  while (maxTrail < 3 && isCloser(allLines[allLines.length - 1 - maxTrail])) maxTrail++;
  for (let lead = 0; lead <= maxLead; lead++) {
    for (let trail = 0; trail <= maxTrail; trail++) {
      if (lead === 0 && trail === 0) continue;
      const inner = allLines.slice(lead, allLines.length - trail).join('\n');
      if (!inner.trim()) continue;
      if (parses(inner)) return true;
      if (parses(`function __docrot() { while (1) {\n${inner}\n} }`)) return true;
      if (parses(`switch (__docrot) {\n${inner}\n}`)) return true;
      if (parses(`class __DocRotFragment {\n${inner}\n}`)) return true;
      if (parses(`({\n${inner}\n})`)) return true;
    }
  }

  // A statement (usually console.log) followed by its pasted output object.
  const lines = code.split('\n');
  for (let i = 1, tried = 0; i < lines.length && tried < 3; i++) {
    if (!/^\s*\{/.test(lines[i])) continue;
    tried++;
    const head = lines.slice(0, i).join('\n');
    const tail = lines.slice(i).join('\n');
    if (parses(head) && parses(`(\n${tail}\n)`)) return true;
  }
  return false;
}

function pushDiagFindings(
  findings: Finding[],
  block: CodeBlock,
  diags: ts.Diagnostic[],
  lineOffset = 0,
): void {
  const lines = block.value.split('\n');
  const seen = new Set<number>();
  for (const d of diags) {
    if (seen.size >= 3) break;
    let lineInBlock = lineOffset;
    if (d.file && typeof d.start === 'number') {
      lineInBlock = d.file.getLineAndCharacterOfPosition(d.start).line + lineOffset;
    }
    if (lineInBlock < 0) lineInBlock = 0;
    if (seen.has(lineInBlock)) continue;
    seen.add(lineInBlock);
    findings.push({
      file: block.file,
      line: block.contentStartLine + lineInBlock,
      severity: 'error',
      check: 'syntax',
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      snippet: lines[lineInBlock]?.trim(),
      blockId: blockIdOf(block),
    });
  }
}

export function checkBlockSyntax(block: CodeBlock): Finding[] {
  const findings: Finding[] = [];
  const code = block.value;
  if (block.skipped) return findings;
  if (tooTrivial(code)) {
    block.skipped = 'too short to verify';
    return findings;
  }

  if (block.norm === 'json') {
    try {
      JSON.parse(code);
    } catch (err) {
      // Docs' json blocks are JSONC by community convention (comments,
      // trailing commas) and often show fragments without the outer braces.
      const cleaned = stripJsonc(code);
      for (const candidate of [cleaned, `{${code}}`, `{${cleaned}}`]) {
        try {
          JSON.parse(candidate);
          return findings;
        } catch {
          // keep trying
        }
      }
      // Several JSON documents pasted in one fence, separated by blank lines.
      const jsonChunks = code.split(/\n\s*\n+/).filter((c) => c.trim());
      if (
        jsonChunks.length >= 2 &&
        jsonChunks.length <= 8 &&
        jsonChunks.every((c) => {
          try {
            JSON.parse(stripJsonc(c));
            return true;
          } catch {
            return false;
          }
        })
      ) {
        return findings;
      }
      // Rule docs show `rule-name: ["error", ...]` fragments in json fences;
      // they read as YAML, which is what the authors meant. Only for blocks
      // shaped like key: value — brace soup must not sneak through.
      if (/^[ \t]*[\w"'@$-]+\s*:/m.test(code) && !/^\s*[{[]/.test(code)) {
        try {
          if (parseAllDocuments(code).every((doc) => doc.errors.length === 0)) return findings;
        } catch {
          // not yaml-ish either
        }
      }
      const reason = partialReason(code);
      if (reason) {
        block.skipped = reason;
        return findings;
      }
      if (block.contextHint && INTENTIONALLY_BROKEN_RE.test(block.contextHint)) {
        block.skipped = 'intentionally incorrect example';
        return findings;
      }
      findings.push({
        file: block.file,
        line: block.contentStartLine,
        severity: 'error',
        check: 'data',
        message: `invalid JSON — ${(err as Error).message}`,
        blockId: blockIdOf(block),
      });
    }
    return findings;
  }

  if (block.norm === 'yaml') {
    let firstError: { message: string; line: number } | null = null;
    try {
      for (const doc of parseAllDocuments(code)) {
        const err = doc.errors[0];
        if (err) {
          firstError = {
            message: err.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''),
            line: err.linePos?.[0]?.line ?? 1,
          };
          break;
        }
      }
    } catch (err) {
      firstError = { message: (err as Error).message.split('\n')[0], line: 1 };
    }
    if (firstError) {
      const reason = partialReason(code);
      if (reason) {
        block.skipped = reason;
        return findings;
      }
      findings.push({
        file: block.file,
        line: block.contentStartLine + firstError.line - 1,
        severity: 'error',
        check: 'data',
        message: `invalid YAML — ${firstError.message}`,
        blockId: blockIdOf(block),
      });
    }
    return findings;
  }

  if (block.norm === 'js' || block.norm === 'ts' || block.norm === 'jsx' || block.norm === 'tsx') {
    let diags = transpileErrors(code, fileNameFor(block));
    if (!diags.length) return findings;

    // TypeScript syntax inside a ```js block: broken for anyone pasting into
    // a .js file, but worth calling out gently rather than as a syntax error.
    if ((block.norm === 'js' || block.norm === 'jsx') && diags.some((d) => d.code >= 8000 && d.code < 9000)) {
      const asTs = transpileErrors(code, 'snippet.tsx');
      if (!asTs.length) {
        findings.push({
          file: block.file,
          line: block.contentStartLine,
          severity: 'warning',
          check: 'syntax',
          message: 'block is labeled `js` but contains TypeScript-only syntax',
          blockId: blockIdOf(block),
        });
        return findings;
      }
      diags = asTs;
    }

    if (parsesAsFragment(code)) return findings;

    const output = outputReason(code);
    if (output) {
      block.skipped = output;
      return findings;
    }

    const reason = partialReason(code);
    if (reason) {
      block.skipped = reason;
      return findings;
    }
    if (block.contextHint && INTENTIONALLY_BROKEN_RE.test(block.contextHint)) {
      block.skipped = 'intentionally incorrect example';
      return findings;
    }
    // Tokenizer/linter docs demonstrate invalid input and say so in the code.
    // Narrower than the prose guard: identifiers named `broken`/`bad` are
    // everywhere, but nobody writes the word "invalid" in working examples.
    if (/\b(invalid|incorrect)\b/i.test(code)) {
      block.skipped = 'demonstrates invalid code';
      return findings;
    }
    // Directory-tree diagrams get fenced as js often enough to matter.
    if (/[├└┌┬┴│]/.test(code)) {
      block.skipped = 'diagram, not code';
      return findings;
    }
    // Human alternatives notation: `"before": "always" or "never"`
    if (/(['"])(?:(?!\1).)*\1\s+or\s+['"]/.test(code)) {
      block.skipped = 'alternatives notation (`"a" or "b"`)';
      return findings;
    }
    // Flow type syntax is not TypeScript, but it isn't rot either.
    if (/<\*>|@flow\b/.test(code)) {
      block.skipped = 'Flow type syntax';
      return findings;
    }
    // Math derivations: `e + b = (k1 & 0xffff) * c1`
    if (/^\s*[\w$]+\s*[+*&|^-]\s*[\w$]+\s*=[^=]/m.test(code)) {
      block.skipped = 'math notation, not code';
      return findings;
    }
    // Raw HTTP multipart payloads pasted into a code fence.
    if (/^-{10,}\d{4,}/m.test(code)) {
      block.skipped = 'protocol output, not code';
      return findings;
    }
    // Terminal commands in a js fence: `node file.js`, `zx script.mjs`…
    const cmdLines = code
      .split('\n')
      .filter((l) => l.trim() && !/^\s*\/\//.test(l));
    if (
      cmdLines.length > 0 &&
      cmdLines.length <= 4 &&
      cmdLines.every((l) =>
        /^(node|npm|npx|yarn|pnpm|bun|bunx|deno|zx|git|sh|bash|cd|mkdir|curl|wget)\b[^;{}=]*$/.test(l.trim()),
      )
    ) {
      block.skipped = 'shell commands, not code';
      return findings;
    }
    // Side-by-side comparison layouts (upgrade guides).
    const wide = cmdLines.filter((l) => /\S {4,}\S/.test(l));
    if (cmdLines.length >= 3 && wide.length / cmdLines.length >= 0.6) {
      block.skipped = 'column layout, not code';
      return findings;
    }
    // Some READMEs label JSON payloads as js.
    try {
      JSON.parse(code);
      block.skipped = 'data block (JSON), not code';
      return findings;
    } catch {
      // genuinely broken code, fall through
    }
    // For a block that reads as one big expression (config objects, mostly),
    // the expression parse pins the error to its real line; the statement
    // parse blames the first property instead.
    if (code.trimStart().startsWith('{')) {
      const exprDiags = transpileErrors(`(\n${code}\n)`, 'snippet.ts');
      if (exprDiags.length) {
        pushDiagFindings(findings, block, exprDiags, -1);
        return findings;
      }
    }
    pushDiagFindings(findings, block, diags);
  }

  return findings;
}
