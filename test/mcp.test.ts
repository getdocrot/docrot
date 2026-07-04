import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test/fixtures/proj');
// Spawn node with tsx's real JS entry: the .bin/ shims are shell scripts
// (.cmd on Windows), which child_process cannot exec without a shell.
const TSX_CLI = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');

let proc: ChildProcessWithoutNullStreams;
const pending = new Map<number, (msg: any) => void>();

function send(msg: object): void {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

function request(id: number, method: string, params: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

beforeAll(async () => {
  proc = spawn(process.execPath, [TSX_CLI, 'src/mcp.ts'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    } catch {
      // non-JSON noise on stdout would be a protocol bug; surfaced by timeouts
    }
  });

  const init = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'docrot-test', version: '0.0.0' },
  });
  expect(init.result.serverInfo.name).toBe('docrot');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}, 60_000);

afterAll(() => {
  proc?.kill();
});

describe('docrot-mcp', () => {
  it('lists both tools', async () => {
    const res = await request(2, 'tools/list', {});
    const names = res.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(['fix_docs', 'scan_docs']);
  });

  it('scans a directory and returns graded findings', async () => {
    const res = await request(3, 'tools/call', {
      name: 'scan_docs',
      arguments: { path: FIXTURE },
    });
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.grade).toBeDefined();
    expect(payload.stats.errors).toBeGreaterThan(0);
    expect(payload.findings.some((f: any) => f.check === 'missing-export')).toBe(true);
  }, 60_000);

  it('fix_docs defaults to dry run', async () => {
    const res = await request(4, 'tools/call', {
      name: 'fix_docs',
      arguments: { path: FIXTURE },
    });
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.dryRun).toBe(true);
    expect(payload.applied.length).toBeGreaterThanOrEqual(4);
    expect(payload.after).toBeNull();
  }, 60_000);
});
