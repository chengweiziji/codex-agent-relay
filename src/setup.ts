import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicJSON, canonical, findProject, pathKey, readJSON, readUser, rejectSecrets, saveProject, validateProject } from './config.ts';

export function projectPaths(home: string): string[] { return readJSON<string[]>(join(home, 'projects.json'), []); }
export function rememberProject(home: string, project: string): void {
  const paths = projectPaths(home);
  if (!paths.some(p => pathKey(p) === pathKey(project))) atomicJSON(join(home, 'projects.json'), [...paths, canonical(project)]);
}
export function harnessEntry(input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw Error('Choose the Harness installation directory or its bin.js file');
  const path = resolve(input.trim());
  const candidates = [path, join(path, 'lib', 'bin.js'), join(path, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')];
  const entry = candidates.find(p => existsSync(p) && statSync(p).isFile() && /\.[cm]?js$/i.test(p));
  if (!entry) throw Error('Harness entry not found. Select its installation directory or @deepseek-ai/dsh/lib/bin.js');
  return canonical(entry);
}
export function setupInfo(home: string): any {
  const launch = readUser(home).agents?.['deepseek-harness'];
  const credentialEnv = launch?.envFrom?.DEEPSEEK_API_KEY || '';
  return { harnessPath: launch?.args?.find(arg => /\.[cm]?js$/i.test(arg)) || '', credentialEnv: launch ? credentialEnv : 'DEEPSEEK_API_KEY', credentialAvailable: credentialEnv ? !!process.env[credentialEnv] : null, configured: !!launch };
}
export function saveSetup(home: string, input: any): any {
  rejectSecrets(input);
  const project = canonical(input.project);
  const inherited = findProject(project);
  if (inherited && pathKey(inherited.root) !== pathKey(project)) throw Error('This directory inherits a parent project. Select that project root to edit its configuration.');
  const config = validateProject({ version: 1, enabled: true, agent: 'deepseek-harness', provider: input.provider, model: input.model, thresholdPercent: Number(input.thresholdPercent ?? 5), quotaBucket: input.quotaBucket || 'codex' });
  if (input.agent !== 'deepseek-harness') throw Error('First-time setup supports DeepSeek Harness. Install an adapter before selecting another Agent in project settings.');
  const entry = harnessEntry(input.harnessPath);
  const credentialEnv = String(input.credentialEnv || '').trim();
  if (credentialEnv && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(credentialEnv)) throw Error('Enter an environment variable name, not an API key');
  const user = readUser(home);
  const previous = user.agents?.['deepseek-harness'];
  const envFrom = { ...previous?.envFrom }; delete envFrom.DEEPSEEK_API_KEY;
  if (credentialEnv) envFrom.DEEPSEEK_API_KEY = credentialEnv;
  user.agents = { ...user.agents, 'deepseek-harness': {
    ...previous, command: process.execPath, args: [entry, '--profile', 'sdk'],
    // Use the existing Harness home unless the user's launch configuration specifies another.
    env: { ...previous?.env }, envFrom,
  } };
  atomicJSON(join(home, 'user.json'), user);
  saveProject(project, config); rememberProject(home, project);
  return { project, config, credentialAvailable: credentialEnv ? !!process.env[credentialEnv] : null,
    next: 'Install and review/trust the plugin Hooks in Codex, then start an execution chat in this project. No task or model call was started.' };
}
