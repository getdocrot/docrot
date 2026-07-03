import { builtinModules } from 'node:module';
import ts from 'typescript';
import type { CodeBlock, ProjectInfo } from '../types.js';

export interface ImportRef {
  specifier: string;
  /** Named imports to verify against the package's real exports. */
  names: string[];
  hasDefault: boolean;
  /** Absolute 1-based line in the markdown file. */
  line: number;
  file: string;
  blockId: string;
}

const BUILTINS = new Set(builtinModules);
const ASSET_RE = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|eot|mp[34]|wasm)$/i;

function bindingNames(call: ts.CallExpression): string[] {
  let node: ts.Node = call;
  if (ts.isAwaitExpression(node.parent)) node = node.parent;
  const decl = node.parent;
  if (decl && ts.isVariableDeclaration(decl) && ts.isObjectBindingPattern(decl.name)) {
    const names: string[] = [];
    for (const el of decl.name.elements) {
      const prop = el.propertyName;
      if (prop && ts.isIdentifier(prop)) names.push(prop.text);
      else if (ts.isIdentifier(el.name)) names.push(el.name.text);
    }
    return names;
  }
  return [];
}

export function extractImports(block: CodeBlock): ImportRef[] {
  const refs: ImportRef[] = [];
  const blockId = `${block.file}:${block.fenceLine}`;

  const collect = (code: string, toAbsLine: (parsedLine: number) => number): void => {
    const sf = ts.createSourceFile('snippet.tsx', code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
    const push = (node: ts.Node, specifier: string, names: string[], hasDefault: boolean): void => {
      const parsedLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      refs.push({ specifier, names, hasDefault, line: toAbsLine(parsedLine), file: block.file, blockId });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const names: string[] = [];
        let hasDefault = false;
        const clause = node.importClause;
        if (clause) {
          if (clause.name) hasDefault = true;
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text);
          }
        }
        push(node, node.moduleSpecifier.text, names, hasDefault);
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        const names: string[] = [];
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const el of node.exportClause.elements) names.push((el.propertyName ?? el.name).text);
        }
        push(node, node.moduleSpecifier.text, names, false);
      } else if (ts.isCallExpression(node)) {
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const arg = node.arguments[0];
        if ((isRequire || isDynamicImport) && arg && ts.isStringLiteralLike(arg)) {
          push(node, arg.text, bindingNames(node), false);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  };

  collect(block.value, (l) => block.contentStartLine + l);

  // If the block as a whole didn't yield imports but clearly contains import
  // lines (partial examples often break the parser), salvage them line by line.
  if (!refs.length && /^[ \t]*(import\b|const\b[^\n]*=\s*require\()/m.test(block.value)) {
    block.value.split('\n').forEach((lineText, i) => {
      if (/^[ \t]*(import\b|const\b[^\n]*=\s*require\()/.test(lineText)) {
        collect(lineText, () => block.contentStartLine + i);
      }
    });
  }

  return refs;
}

export type ClassifiedImport =
  | { kind: 'ok' }
  | { kind: 'self'; pkgDir: string; subpath: string }
  | { kind: 'unknown'; packageName: string };

export function classifyImport(specifier: string, project: ProjectInfo): ClassifiedImport {
  const spec = specifier.trim();
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) {
    return { kind: 'ok' }; // relative paths and import-maps in examples are illustrative
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) {
    return { kind: 'ok' }; // node:, https:, npm:, jsr: … node: builtins are always fine
  }
  const packageName = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0];
  if (BUILTINS.has(packageName) || BUILTINS.has(spec)) return { kind: 'ok' };

  const wsDir = project.workspaces.get(packageName);
  if (wsDir) {
    const subpath = spec.slice(packageName.length).replace(/^\//, '');
    if (ASSET_RE.test(subpath)) return { kind: 'ok' };
    return { kind: 'self', pkgDir: wsDir, subpath };
  }
  if (project.deps.has(packageName)) return { kind: 'ok' };
  return { kind: 'unknown', packageName };
}
