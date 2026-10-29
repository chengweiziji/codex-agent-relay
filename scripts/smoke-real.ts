// Opt-in real Harness smoke test. Spends provider credits and needs a scanner.
// Required: RELAY_SMOKE_REAL=1, RELAY_SMOKE_PROVIDER, RELAY_SMOKE_MODEL,
// a Harness launch (RELAY_SMOKE_DSH or agents.deepseek-harness in user.json)
// and the credential environment variable (DEEPSEEK_API_KEY by default).
// Optional: RELAY_SMOKE_DSH_TEMPLATE copies profiles/sdk from an existing Harness home.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Relay } from '../src/relay.ts';
import { QuotaReader } from '../src/quota.ts';
import { atomicJSON, defaultHome, readJSON, saveProject } from '../src/config.ts';
import type { Checkpoint, LaunchConfig, ProjectConfig, QuotaSnapshot, UserConfig } from '../src/types.ts';

if (process.env.RELAY_SMOKE_REAL !== '1') {
  console.log('Skipped. Set RELAY_SMOKE_REAL=1 to dispatch a real Harness run (spends provider credits).');
  process.exit(0);
}

const provider = process.env.RELAY_SMOKE_PROVIDER;
const model = process.env.RELAY_SMOKE_MODEL;
if (!provider || !model) throw Error('Set RELAY_SMOKE_PROVIDER and RELAY_SMOKE_MODEL explicitly; the smoke test does not guess a route.');
const credential = process.env.RELAY_SMOKE_CREDENTIAL || 'DEEPSEEK_API_KEY';
const credentialTarget = process.env.RELAY_SMOKE_CREDENTIAL_TARGET || 'DEEPSEEK_API_KEY';
if (!process.env[credential]) throw Error(`Credential environment variable ${credential} is not set.`);

const repo = join(import.meta.dirname, '..');
const stamp = Date.now();
const base = join(repo, '.local', `smoke-${stamp}`);
const home = join(base, 'relay');
const dshHome = join(base, 'dsh');
mkdirSync(home, { recursive: true });
mkdirSync(dshHome, { recursive: true });
const sourceHome = process.env.RELAY_SMOKE_HOME || defaultHome();
const sourceUser = readJSON<UserConfig>(join(sourceHome, 'user.json'), { agents: {} });

let launch: LaunchConfig;
if (process.env.RELAY_SMOKE_DSH) {
  launch = { command: process.execPath, args: [process.env.RELAY_SMOKE_DSH, '--profile', 'sdk'] };
} else {
  const configured = sourceUser.agents?.['deepseek-harness'];
  if (!configured) throw Error(`No deepseek-harness launch in ${join(sourceHome, 'user.json')}. Set RELAY_SMOKE_DSH to its lib/bin.js, or configure the relay first.`);
  launch = structuredClone(configured);
}
launch.env = { ...launch.env, DSH_HOME: dshHome, DSH_PERMISSION_MODE: 'workspace-write' };
launch.envFrom = { ...launch.envFrom, [credentialTarget]: credential };
launch.initializeTimeoutMs ??= 120_000;
launch.receiptTimeoutMs ??= 60_000;
launch.runTimeoutMs ??= 600_000;

const dshTemplate = process.env.RELAY_SMOKE_DSH_TEMPLATE;
if (dshTemplate) {
  const profiles = join(dshTemplate, 'profiles');
  if (existsSync(profiles)) cpSync(profiles, join(dshHome, 'profiles'), { recursive: true });
  const anon = join(dshTemplate, '.anonymous-user-id');
  if (existsSync(anon)) cpSync(anon, join(dshHome, '.anonymous-user-id'));
}

const scannerOverride = process.env.RELAY_SMOKE_SCANNER || process.env.RELAY_TEST_GITLEAKS;
const scanner: LaunchConfig = scannerOverride
  ? { command: scannerOverride, args: [] }
  : sourceUser.scanner ? structuredClone(sourceUser.scanner) : { command: 'gitleaks', args: [] };
atomicJSON(join(home, 'user.json'), { scanner, agents: { 'deepseek-harness': launch } });
const project = mkdtempSync(join(process.platform === 'win32' ? homedir() : tmpdir(), 'relay-smoke-'));
writeFileSync(join(project, 'sum.cjs'), 'module.exports = (a, b) => a - b;\n');
writeFileSync(join(project, 'test.cjs'), "const assert=require('node:assert/strict'); assert.equal(require('./sum.cjs')(2,3),5); console.log('SMOKE_TEST_PASSED');\n");

const config: ProjectConfig = { version: 1, enabled: true, agent: 'deepseek-harness', provider, model, thresholdPercent: 5, quotaBucket: 'codex' };
saveProject(project, config, home);

const checkpoint: Checkpoint = {
  goal: 'Fix sum.cjs so the existing test passes',
  completed: ['Created a disposable two-file arithmetic fixture'],
  remaining: ['Change subtraction to addition in sum.cjs', 'Run node test.cjs'],
  decisions: ['Only modify sum.cjs; leave test.cjs unchanged'],
  files: ['sum.cjs', 'test.cjs'],
  tests: ['Expected sum(2,3) to equal 5; currently it returns -1'],
  processes: [],
  permissions: 'Read/write only this disposable project. No network, package installation, other files or background jobs. Use existing local tools.',
  acceptance: ['node test.cjs exits 0', 'test.cjs stays unchanged'],
};

class SimulatedQuota extends QuotaReader {
  override async refresh() { return this.snapshot; }
  override async close() {}
}
const quota = new SimulatedQuota();
quota.snapshot = { at: Date.now(), data: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 96 } } } } } as QuotaSnapshot;

const relay = new Relay(home, quota);
const timeoutMs = Number(process.env.RELAY_SMOKE_TIMEOUT_MS || 900_000);
let exitCode = 1;
try {
  await relay.loadAdapters();
  const task = await relay.register({ cwd: project, sessionId: `smoke-${stamp}`, checkpoint });
  const job = await relay.handoff({
    taskId: task.id,
    instruction: 'Only modify sum.cjs so the existing node test.cjs passes. Run node test.cjs to verify. Do not modify test.cjs, install packages, use the network, or start background jobs.',
  });
  console.log('JOB', JSON.stringify({ id: job.id, state: job.state, receipt: job.receipt, error: job.error }, null, 2));
  const terminal = new Set(['ended', 'waiting_user', 'failed', 'cancelled']);
  const deadline = Date.now() + timeoutMs;
  while (!terminal.has(job.state) && Date.now() < deadline) await new Promise(r => setTimeout(r, 1_000));
  console.log('FINAL', JSON.stringify({ state: job.state, receipt: job.receipt, reportedComplete: job.reportedComplete, error: job.error }, null, 2));
  console.log('RESULT', job.result);
  console.log('EVENTS', JSON.stringify(relay.events(job.id).map(e => ({ seq: e.seq, kind: e.kind, text: e.text.slice(0, 400) })), null, 2));
  const sum = readFileSync(join(project, 'sum.cjs'), 'utf8').trim();
  const test = spawnSync(process.execPath, ['test.cjs'], { cwd: project, encoding: 'utf8' });
  console.log('SUM', sum);
  console.log('INDEPENDENT_TEST', JSON.stringify({ status: test.status, stdout: test.stdout.trim(), stderr: test.stderr.trim() }));
  console.log('PATHS', JSON.stringify({ project, home, dshHome }));
  console.log('NOTE', 'Independent check run by this script, not relay_verify. Completion remains self-reported.');
  exitCode = job.state === 'ended' && test.status === 0 ? 0 : 1;
} finally {
  await relay.close();
}
process.exitCode = exitCode;

