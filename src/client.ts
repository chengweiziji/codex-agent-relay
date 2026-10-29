import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHome, readJSON, readUser } from './config.ts';
import { childEnv } from './rpc.ts';
interface Endpoint { pid: number; url: string; token: string }
export async function ensureServer(home = defaultHome()): Promise<Endpoint> {
  const lookup = async (): Promise<Endpoint | null> => {
    try {
      const endpoint = readJSON<Endpoint>(join(home, 'server.json'));
      const response = await fetch(`${endpoint.url}/health`, { headers: { Authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.timeout(1000) });
      const health = await response.json() as any;
      return response.ok && health.pid === endpoint.pid ? endpoint : null;
    } catch { return null; }
  };
  const existing = await lookup(); if (existing) return existing;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const logPath = join(home, 'service.log');
  if (existsSync(logPath) && (statSync(logPath).size > 1_000_000 || Date.now() - statSync(logPath).mtimeMs > 7 * 86400000)) rmSync(logPath);
  const log = openSync(logPath, 'a', 0o600);
  const user = readUser(home);
  const required = Object.values(user.agents || {}).flatMap(c => Object.values(c.envFrom || {}));
  const env = childEnv({ command: '', args: [], env: { AGENT_RELAY_HOME: home } });
  for (const name of [...required, 'CODEX_HOME','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']) if (process.env[name]) env[name] = process.env[name];
  const child = spawn(process.execPath, [fileURLToPath(new URL('./cli.ts', import.meta.url)), 'serve'], {
    detached: true, windowsHide: true, stdio: ['ignore', log, log], env,
  });
  child.unref(); closeSync(log);
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); const endpoint = await lookup(); if (endpoint) return endpoint; }
  throw Error(`Relay server did not start. Inspect ${join(home, 'service.log')}`);
}
export async function call(name: string, input: any = {}, home = defaultHome()): Promise<any> {
  const endpoint = await ensureServer(home);
  const response = await fetch(`${endpoint.url}/api/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000) });
  const value = await response.json() as any;
  if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
  return value;
}
