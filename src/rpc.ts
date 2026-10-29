import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type { LaunchConfig } from './types.ts';
import { redact } from './config.ts';
import { terminateTree } from './process-tree.ts';

export function childEnv(config: LaunchConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const inherited = new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY']);
  for (const [key, value] of Object.entries(process.env)) if (inherited.has(key.toUpperCase())) env[key] = value;
  // Explicit entries are a user-reviewed allowlist, never task-provided values.
  for (const [key, value] of Object.entries(config.env || {})) {
    if (/^(NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|PYTHONPATH)$/i.test(key)) throw Error(`Unsafe launch environment: ${key}`);
    env[key] = value;
  }
  for (const [target, source] of Object.entries(config.envFrom || {})) {
    if (/^(NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|PYTHONPATH)$/i.test(target)) throw Error(`Unsafe launch environment: ${target}`);
    if (!process.env[source]) throw Error(`Missing environment variable: ${source}`);
    env[target] = process.env[source];
  }
  return env;
}
export class JsonRpc extends EventEmitter {
  child: ChildProcessWithoutNullStreams;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  sequence = 0;
  closed = false;
  stderr = '';
  closing?: Promise<void>;
  constructor(config: LaunchConfig, cwd?: string) {
    super();
    this.child = spawn(config.command, config.args, { cwd, env: childEnv(config), shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: 'pipe' });
    createInterface({ input: this.child.stdout }).on('line', line => {
      if (line.length > 4_000_000) { this.fail(Error('Oversized RPC frame')); return; }
      let msg: any; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id != null && !msg.method) {
        const p = this.pending.get(msg.id); if (!p) return;
        clearTimeout(p.timer); this.pending.delete(msg.id);
        if (msg.error) p.reject(Error(redact(msg.error.message || JSON.stringify(msg.error)))); else p.resolve(msg.result);
      } else if (msg.method && msg.id == null) this.emit('notification', msg.method, msg.params);
      else if (msg.method && msg.id != null) this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Interactive requests are unsupported; no permission granted' } });
    });
    this.child.stderr.on('data', b => { this.stderr = (this.stderr + redact(String(b))).slice(-6000); });
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', (code, signal) => this.fail(Error(`Agent transport exited (${code ?? signal}): ${this.stderr}`)));
    this.child.stdin.on('error', e => this.fail(e));
  }
  send(value: unknown): void { if (!this.closed) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  notify(method: string, params: unknown = {}): void { this.send({ jsonrpc: '2.0', method, params }); }
  request(method: string, params: unknown = {}, timeout = 15_000): Promise<any> {
    if (this.closed) return Promise.reject(Error('Transport is closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`RPC timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  fail(error: Error): void {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (!this.child.pid) return;
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        if (process.platform !== 'win32') await terminateTree(this.child.pid);
        return;
      }
      // Kill while the parent is still alive so Windows can enumerate its tree.
      const exit = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
      await terminateTree(this.child.pid);
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([exit, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Process-tree exit timed out')), 10_000); })]); }
      finally { clearTimeout(timer); }
    })();
    return this.closing;
  }
}
