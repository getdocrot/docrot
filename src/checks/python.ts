import { spawnSync } from 'node:child_process';
import { docFragmentGate } from './syntax.js';
import type { CodeBlock, Finding } from '../types.js';

// One python3 subprocess per scan verifies every block. The driver tries the
// raw source, then textwrap.dedent (docs quote indented fragments), then a
// doctest extraction (>>> sessions), then stripping IPython magics — a block
// is only broken if nothing parses.
const DRIVER = `
import ast, json, re, sys, textwrap

def variants(code):
    yield code
    yield textwrap.dedent(code)
    lines = code.split("\\n")
    doctest = [re.sub(r"^\\s*(>>>|\\.\\.\\.)\\s?", "", l) for l in lines if re.match(r"^\\s*(>>>|\\.\\.\\.)", l)]
    if doctest:
        yield textwrap.dedent("\\n".join(doctest))
    no_magic = [l for l in lines if not re.match(r"^\\s*[%!]", l)]
    if len(no_magic) != len(lines):
        yield textwrap.dedent("\\n".join(no_magic))
    body = textwrap.indent(textwrap.dedent(code), "    ")
    yield "def __docrot__():\\n" + body
    yield "async def __docrot__():\\n" + body
    flat = textwrap.dedent(code)
    yield "(\\n" + flat + "\\n)"
    yield "def __docrot__(\\n" + flat + "\\n): pass"
    yield "__docrot__(\\n" + flat + "\\n)"

def first_error(code):
    err = None
    for candidate in variants(code):
        try:
            ast.parse(candidate)
            return None
        except SyntaxError as e:
            if err is None:
                err = {"line": e.lineno or 1, "msg": e.msg or "invalid syntax"}
    return err

blocks = json.load(sys.stdin)
out = []
for b in blocks:
    e = first_error(b["code"])
    if e is not None:
        out.append({"i": b["i"], "line": e["line"], "msg": e["msg"]})
print(json.dumps(out))
`;

let pythonBin: string | null | undefined;

function findPython(): string | null {
  if (pythonBin !== undefined) return pythonBin;
  for (const bin of ['python3', 'python']) {
    const probe = spawnSync(bin, ['--version'], { timeout: 10_000 });
    if (probe.status === 0) {
      pythonBin = bin;
      return bin;
    }
  }
  pythonBin = null;
  return null;
}

export function checkPythonBlocks(blocks: CodeBlock[]): Finding[] {
  const findings: Finding[] = [];
  const candidates = blocks.filter((b) => !b.skipped && b.value.trim().length >= 4);
  if (!candidates.length) return findings;
  const bin = findPython();
  if (!bin) return findings; // no interpreter: python blocks stay unverified

  const payload = candidates.map((b, i) => ({ i, code: b.value }));
  const proc = spawnSync(bin, ['-c', DRIVER], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (proc.status !== 0 || !proc.stdout) return findings;

  let errors: Array<{ i: number; line: number; msg: string }>;
  try {
    errors = JSON.parse(proc.stdout);
  } catch {
    return findings;
  }

  for (const err of errors) {
    const block = candidates[err.i];
    if (!block) continue;
    const gate = docFragmentGate(block, block.value);
    if (gate) {
      block.skipped = gate;
      continue;
    }
    const lines = block.value.split('\n');
    findings.push({
      file: block.file,
      line: block.contentStartLine + Math.max(0, err.line - 1),
      severity: 'error',
      check: 'syntax',
      message: `Python: ${err.msg}.`,
      snippet: lines[err.line - 1]?.trim(),
      blockId: `${block.file}:${block.fenceLine}`,
    });
  }
  return findings;
}
