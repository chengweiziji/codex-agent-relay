import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, parse } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ProjectConfig, UserConfig, Checkpoint } from './types.ts';

export const defaultHome = () => resolve(process.env.AGENT_RELAY_HOME || join(homedir(), '.codex-agent-relay'));
export function canonical(path: string): string { return realpathSync(resolve(path)); }
export function pathKey(path: string): string {
  let p: string;
  try { p = canonical(path); } catch (e: any) { if (!['ENOENT','ENOTDIR'].includes(e.code)) throw e; p = resolve(path); }
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
export function readJSON<T>(path: string, fallback?: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e: any) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
export function atomicJSON(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}
export function validateProject(c: any): ProjectConfig {
  if (!c || c.version !== 1 || typeof c.enabled !== 'boolean') throw Error('Config requires version: 1 and enabled: boolean');
  const allowed = ['version','enabled','agent','provider','model','thresholdPercent','quotaBucket'];
  if (Object.keys(c).some(k => !allowed.includes(k))) throw Error('Unknown project field; executable paths and credentials belong in user.json');
  for (const k of ['agent','provider','model','quotaBucket']) if (typeof c[k] !== 'string' || !c[k].trim() || c[k].length > 200) throw Error(`Invalid ${k}`);
  if (!Number.isFinite(c.thresholdPercent) || c.thresholdPercent <= 0 || c.thresholdPercent > 50) throw Error('thresholdPercent must be >0 and <=50');
  return structuredClone(c);
}
export function findProject(cwd: string): { root: string; config: ProjectConfig } | null {
  let current: string;
  try { current = canonical(cwd); } catch (e: any) { if (['ENOENT','ENOTDIR'].includes(e.code)) return null; throw e; }
  while (true) {
    const file = join(current, '.agent-relay.json');
    if (existsSync(file)) return { root: current, config: validateProject(readJSON(file)) };
    if (current === parse(current).root) return null;
    current = dirname(current);
  }
}
export function saveProject(root: string, config: unknown): ProjectConfig {
  const valid = validateProject(config); atomicJSON(join(canonical(root), '.agent-relay.json'), valid); return valid;
}
export function readUser(home: string): UserConfig { return readJSON(join(home, 'user.json'), { agents: {} }); }
export function validateCheckpoint(c: any): Checkpoint {
  if (!c || typeof c.goal !== 'string' || !c.goal.trim() || typeof c.permissions !== 'string' || !c.permissions.trim()) throw Error('Checkpoint requires goal and explicit permissions');
  for (const key of ['completed','remaining','decisions','files','tests','processes','acceptance']) {
    if (!Array.isArray(c[key]) || c[key].some((x: any) => typeof x !== 'string')) throw Error(`Checkpoint ${key} must be a string array`);
  }
  if (!c.acceptance.length) throw Error('Provide at least one acceptance criterion');
  if (JSON.stringify(c).length > 200_000) throw Error('Checkpoint exceeds 200 KB');
  return structuredClone(c);
}
export function redact(text: string): string {
  return text.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]');
}
export function rejectSecrets(value: unknown): void {
  const s = JSON.stringify(value); if (redact(s) !== s) throw Error('Remove credentials from task content; use user-level environment references');
}
