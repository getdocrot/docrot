export type Severity = 'error' | 'warning' | 'info';

export type CheckId =
  | 'syntax'
  | 'data'
  | 'missing-export'
  | 'bad-subpath'
  | 'unknown-import'
  | 'broken-link'
  | 'missing-anchor'
  | 'missing-image'
  | 'missing-script'
  | 'install-name'
  | 'unknown-bin';

export interface Finding {
  /** Path relative to the scan root. */
  file: string;
  /** 1-based line in the markdown file. */
  line: number;
  severity: Severity;
  check: CheckId;
  message: string;
  /** Offending source line, when available. */
  snippet?: string;
  /** `${file}:${fenceLine}` when the finding belongs to a fenced code block. */
  blockId?: string;
  /** High-confidence mechanical repair, applied by --fix. */
  fix?: FindingFix;
}

export interface FindingFix {
  /** Exact text to replace on the finding's line. */
  search: string;
  replace: string;
}

export type NormLang =
  | 'js'
  | 'ts'
  | 'jsx'
  | 'tsx'
  | 'json'
  | 'yaml'
  | 'shell'
  | 'python'
  | 'other';

export interface CodeBlock {
  file: string;
  lang: string | null;
  norm: NormLang;
  meta: string | null;
  value: string;
  /** Line of the opening ``` fence. */
  fenceLine: number;
  /** First line of the code itself. */
  contentStartLine: number;
  /** Reason this block is excluded from verification, or null. */
  skipped: string | null;
  /** Prose immediately above the fence — consulted only when a block fails. */
  contextHint?: string;
}

export interface LinkRef {
  file: string;
  line: number;
  url: string;
  kind: 'link' | 'image' | 'definition';
}

export interface DocFile {
  path: string;
  relPath: string;
  blocks: CodeBlock[];
  links: LinkRef[];
  headings: string[];
  htmlAnchors: string[];
}

export interface PackageJson {
  name?: string;
  private?: boolean;
  main?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export interface ProjectInfo {
  root: string;
  pkg: PackageJson | null;
  name: string | null;
  isPrivate: boolean;
  deps: Set<string>;
  scripts: Set<string>;
  binNames: Set<string>;
  /** Package name -> absolute dir. Includes the root package itself. */
  workspaces: Map<string, string>;
}

export interface ScanOptions {
  exclude?: string[];
  includeChangelogs?: boolean;
  /** Enable/disable check groups. All default to true. */
  checks?: Partial<Record<'examples' | 'links' | 'pkg', boolean>>;
}

export interface ScanStats {
  files: number;
  blocks: number;
  checkedBlocks: number;
  skippedBlocks: number;
  brokenBlocks: number;
  skippedChangelogs: number;
  errors: number;
  warnings: number;
  infos: number;
  durationMs: number;
}

export interface ScanResult {
  root: string;
  project: ProjectInfo;
  files: DocFile[];
  findings: Finding[];
  stats: ScanStats;
}
