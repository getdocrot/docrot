import ts from 'typescript';
import { parseAllDocuments } from 'yaml';
import { outputReason, partialReason, tooTrivial } from '../placeholders.js';
import type { CodeBlock, Finding } from '../types.js';

// Diagnostics that fire on perfectly reasonable documentation fragments.
const SNIPPET_FRIENDLY_CODES = new Set([
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

  // Walkthrough docs quote regions that begin or end mid-block: strip
  // leading/trailing close-brace lines and try the loop/switch shapes again.
  const deblocked = code
    .replace(/^(\s*[}\])]+;?,?\s*\n)+/, '')
    .replace(/(\n\s*[}\])]+;?,?\s*)+$/, '');
  if (deblocked !== code && deblocked.trim()) {
    if (parses(deblocked)) return true;
    if (parses(`function __docrot() { while (1) {\n${deblocked}\n} }`)) return true;
    if (parses(`switch (__docrot) {\n${deblocked}\n}`)) return true;
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
      const reason = partialReason(code);
      if (reason) {
        block.skipped = reason;
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
