import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { defaultHome, atomicJSON, readJSON, saveProject, findProject, redact } from './config.ts';
import { call, ensureServer } from './client.ts';
import { serve } from './server.ts';
import { runMcp } from './mcp.ts';
import { rememberProject } from './setup.ts';

const args = process.argv.slice(2);
const command = args.shift() || 'help';
const option = (name: string, fallback = '') => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] || fallback : fallback; };
async function stdin(): Promise<string> { let text = ''; for await (const c of process.stdin) text += c; return text; }
try {
  let result: unknown;
  if (command === 'serve') await serve(defaultHome());
  else if (command === 'mcp') await runMcp();
  else if (command === 'hook') {
    const event = JSON.parse(await stdin());
    // A running service may still own this directory after its project switch is disabled.
    if (!findProject(event.cwd)?.config.enabled && !existsSync(join(defaultHome(), 'server.json'))) result = {};
    else try { result = await call('hook', event); } catch (e: any) {
      // Fail closed for execution hooks in enabled projects: a lost relay must not create dual writers.
      result = event.hook_event_name === 'PreToolUse' ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Relay unavailable: ${redact(e.message)}. Inspect relay status before continuing.` } } : { systemMessage: `Relay unavailable: ${redact(e.message)}` };
    }
  } else if (command === 'init') {
    const root = resolve(option('project', process.cwd()));
    if (findProject(root)) throw Error('Project already configured. Use configure.');
    if (!args.includes('--approve')) throw Error('Review data disclosure in docs/security.md, then use --approve or the setup page');
    const model = option('model'); if (!model) throw Error('Specify --model using an available model identifier');
    result = saveProject(root, { version: 1, enabled: true, agent: option('agent','deepseek-harness'), provider: option('provider','deepseek-official'), model, thresholdPercent: Number(option('threshold','5')), quotaBucket: option('bucket','codex') });
    rememberProject(defaultHome(), root);
  } else if (command === 'configure') {
    const root = resolve(option('project', process.cwd())); const p = findProject(root); if (!p) throw Error('Run init first');
    if (!args.includes('--approve')) throw Error('Configuration changes require --approve after reviewing docs/security.md');
    const next = { ...p.config };
    for (const name of ['agent','provider','model'] as const) if (option(name)) next[name] = option(name);
    if (option('threshold')) next.thresholdPercent = Number(option('threshold'));
    if (args.includes('--disable')) next.enabled = false;
    if (args.includes('--enable')) next.enabled = true;
    result = saveProject(p.root, next);
  } else if (command === 'setup') result = await call('setup', { cwd: option('project', process.cwd()) });
  else if (command === 'user-config') {
    const file = option('file'); if (!file) throw Error('Use --file with your user launch configuration');
    const value = readJSON(file); atomicJSON(join(defaultHome(), 'user.json'), value); result = { saved: join(defaultHome(), 'user.json'), restartServiceToApply: true };
  } else if (command === 'status') result = await call('status', option('job') ? { jobId: option('job') } : {});
  else if (command === 'stop') result = await call('stop', { jobId: option('job') });
  else if (command === 'recover') result = await call('recover', { jobId: option('job'), evidence: option('evidence') });
  else if (command === 'dashboard') { const e = await ensureServer(); result = { dashboardUrl: `${e.url}/#token=${e.token}` }; }
  else if (command === 'doctor') {
    const e = await ensureServer(); const state = await call('status');
    result = { node: process.version, service: e.url, agents: state.agents, project: findProject(option('project', process.cwd())), quota: state.quota, note: 'Validate the selected provider/model with a disposable task. Hook trust and browser opening require the Codex host.' };
  } else if (command === 'request') {
    const input = option('file') ? JSON.parse(readFileSync(option('file'), 'utf8')) : JSON.parse(await stdin());
    result = await call(option('action'), input);
  } else result = { usage: ['setup [--project PATH]', 'init --project PATH --model MODEL [--provider PROVIDER] [--threshold 5]', 'configure --project PATH --model MODEL [--agent ID] [--enable|--disable]', 'user-config --file PATH', 'doctor', 'dashboard', 'status [--job ID]', 'stop --job ID', 'request --action ACTION --file JSON', 'serve', 'mcp', 'hook'], runtime: 'Node.js 24+', home: defaultHome() };
  if (result !== undefined) process.stdout.write(JSON.stringify(result, null, command === 'hook' ? undefined : 2) + '\n');
} catch (e: any) { process.stderr.write(redact(e.message) + '\n'); process.exitCode = 1; }
