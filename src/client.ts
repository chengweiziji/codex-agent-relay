import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHome, readJSON } from './config.ts';
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
  const log = openSync(join(home, 'service.log'), 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./cli.ts', import.meta.url)), 'serve'], {
    detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, AGENT_RELAY_HOME: home },
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
