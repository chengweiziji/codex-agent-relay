import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv } from './rpc.ts';
import { terminateTree } from './process-tree.ts';
import { redact, digest } from './config.ts';
import type { LaunchConfig, Checkpoint, Task, Job } from './types.ts';

export function sanitize<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [redact(k), sanitize(v)])) as T;
  return value;
}
const omitted = '[Content omitted from persisted state; provide a fresh checkpoint to resume]';
function summary(c: Checkpoint): Checkpoint {
  return { goal: redact(c.goal).slice(0, 160), completed: [], remaining: [], decisions: [], files: [], tests: [], processes: [], permissions: omitted, acceptance: [] };
}
export function persistedState(tasks: Task[], jobs: Job[]): unknown {
  return sanitize({
    tasks: tasks.map(t => ({ ...t, checkpoint: summary(t.checkpoint), checkpointHash: digest(t.checkpoint), checkpointFresh: false })),
    jobs: jobs.map(j => ({ ...j, checkpoint: summary(j.checkpoint), instruction: omitted, instructionHash: digest(j.instruction), checkpointHash: digest(j.checkpoint) })),
  });
}

// Scan locally. Never upload suspected secrets or echo scanner output into logs.
export async function scanSecrets(cwd: string, content: unknown, launch: LaunchConfig = { command: 'gitleaks', args: [] }): Promise<void> {
  // Gitleaks 8.30.1 merges source/.gitleaksignore even with an explicit -i.
  // Refuse this unsupported policy rather than editing user files or accepting
  // a scan whose findings can be suppressed by repository content.
  const checkIgnoreFile = () => {
    try { lstatSync(join(cwd, '.gitleaksignore')); }
    catch (e: any) { if (e.code === 'ENOENT') return; throw e; }
    throw Error('Project .gitleaksignore prevents an enforced secret scan; handoff blocked. Project files were not modified.');
  };
  checkIgnoreFile();
  const scannerHome = fileURLToPath(new URL('./security/', import.meta.url));
  const mandatory = ['--config', fileURLToPath(new URL('./security/gitleaks.toml', import.meta.url)),
    '--gitleaks-ignore-path', fileURLToPath(new URL('./security/gitleaksignore', import.meta.url)), '--ignore-gitleaks-allow'];
  const scan = (args: string[], input?: string) => new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, [...launch.args, ...args, ...mandatory, '--no-banner', '--redact', '--exit-code', '23'], { cwd: scannerHome, env: childEnv(launch), shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe','ignore','ignore'] });
    const timer = setTimeout(() => { if (child.pid) void terminateTree(child.pid).catch(() => {}); reject(Error('Secret scan timed out; handoff blocked')); }, 30000);
    child.on('error', () => { clearTimeout(timer); reject(Error('Local secret scanner unavailable; install gitleaks or configure a reviewed scanner')); });
    child.on('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(Error(code === 23 ? 'Secret scan found sensitive content; handoff blocked (values withheld)' : 'Secret scan failed; handoff blocked')); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
  await scan(['stdin'], JSON.stringify(content));
  checkIgnoreFile();
  await scan(['dir', cwd]);
  checkIgnoreFile();
}
