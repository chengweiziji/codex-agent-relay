import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { atomicJSON, saveProject, readJSON } from '../src/config.ts';
import { JsonRpc } from '../src/rpc.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'hooks-e2e-'));
const home = join(dir, 'relay');
const project = join(dir, 'project');
mkdirSync(home, { recursive: true });
mkdirSync(project);
const env = { ...process.env, AGENT_RELAY_HOME: home };
const report: string[] = [];
const step = (name: string, detail: string) => { report.push(`${name}: ${detail}`); console.log(`PASS ${name}: ${detail}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

atomicJSON(join(home, 'user.json'), {
  scanner: { command: process.execPath, args: [join(root, 'test/fixtures/scanner.mjs')] },
  adapterModules: { fixture: join(root, 'test/fixtures/adapter.ts') },
  agents: {
    fixture: {
      command: process.execPath,
      args: [join(root, 'test/fixtures/fake-sdk.mjs'), '--profile', 'sdk'],
      env: { RELAY_TEST_DELAY: '1200' },
      initializeTimeoutMs: 3000,
      receiptTimeoutMs: 3000,
      runTimeoutMs: 15000,
    },
  },
});
saveProject(project, { version: 1, enabled: true, agent: 'fixture', provider: 'fixture-provider', model: 'fixture-model', thresholdPercent: 5, quotaBucket: 'codex' }, home);

const logPath = join(home, 'service.log');
const logFd = openSync(logPath, 'a');
const daemon = spawn(process.execPath, [join(root, 'test', 'fixtures', 'sim-daemon.ts'), home], { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true, env: process.env });
daemon.unref(); closeSync(logFd);

let endpoint: any;
for (let i = 0; i < 100 && !endpoint; i++) {
  await sleep(100);
  try {
    const candidate = readJSON<any>(join(home, 'server.json'));
    const response = await fetch(candidate.url + '/health', { headers: { Authorization: `Bearer ${candidate.token}` }, signal: AbortSignal.timeout(500) });
    const health = await response.json() as any;
    if (response.ok && health.pid === candidate.pid) endpoint = candidate;
  } catch {}
}
assert.ok(endpoint, `daemon did not become healthy: ${readFileSync(logPath, 'utf8')}`);

const hook = (event: any): any => {
  const run = spawnSync(process.execPath, [join(root, 'src/cli.ts'), 'hook'], { input: JSON.stringify(event), env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout || '{}');
};

let rpc: JsonRpc | undefined;
try {
  const sessionId = 'sim-hook-session';
  const cwd = project;
  const checkpoint = {
    goal: 'Complete the simulated Hooks chain',
    completed: ['Inspected the disposable fixture'],
    remaining: ['Run the simulated handoff'],
    decisions: ['Simulation only; no provider inference.'],
    files: ['simulation.txt'],
    tests: ['Fixture completion marker'],
    processes: [],
    permissions: 'Disposable simulation; no real project changes.',
    acceptance: ['Fixture reports completed'],
  };

  const start = hook({ cwd, session_id: sessionId, hook_event_name: 'SessionStart' });
  assert.match(start.hookSpecificOutput.additionalContext, /relay_register/);
  assert.ok(start.hookSpecificOutput.additionalContext.includes(sessionId));
  step('SessionStart', 'registration instruction names relay_register and the Codex session id');

  rpc = new JsonRpc({ command: process.execPath, args: [join(root, 'src/cli.ts'), 'mcp'], env: { AGENT_RELAY_HOME: home } }, project);
  await rpc.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'simulated-codex-host', version: '1' } });
  const raw = async (name: string, input: any) => rpc!.request('tools/call', { name, arguments: input });
  const ok = async (name: string, input: any) => {
    const result = await raw(name, input);
    assert.equal(result.isError, false, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };

  const task = await ok('relay_register', { cwd, sessionId, checkpoint });
  assert.equal(task.state, 'active');
  step('relay_register', `task ${task.id} registered active through MCP stdio`);

  const threshold = hook({ cwd, session_id: sessionId, hook_event_name: 'PostToolUse', tool_name: 'shell', tool_use_id: 'tool-1' });
  const thresholdText = threshold.hookSpecificOutput.additionalContext;
  assert.match(thresholdText, /quota remaining 4%/i);
  assert.match(thresholdText, /relay_checkpoint/);
  assert.match(thresholdText, /relay_handoff/);
  assert.ok(thresholdText.includes(task.id));
  step('PostToolUse threshold', '4% remaining instruction names relay_checkpoint and relay_handoff');

  const stopped = hook({ cwd, session_id: sessionId, hook_event_name: 'Stop' });
  assert.match(stopped.systemMessage, /paused/);
  let snapshot = await ok('relay_status', {});
  assert.equal(snapshot.tasks.find((t: any) => t.id === task.id).state, 'paused');
  step('Stop', 'end of turn pauses the active task and returns a system message');

  const resume = hook({ cwd, session_id: sessionId, hook_event_name: 'UserPromptSubmit' });
  assert.match(resume.hookSpecificOutput.additionalContext, /relay_task_state\(active\)/);
  await ok('relay_task_state', { taskId: task.id, state: 'active' });
  step('UserPromptSubmit', 'paused task is resumed only through explicit relay_task_state');

  const pre = hook({ cwd, session_id: sessionId, hook_event_name: 'PreToolUse', tool_name: 'shell', tool_use_id: 'tool-2' });
  assert.notEqual(pre.hookSpecificOutput?.permissionDecision, 'deny');
  const fenced = await raw('relay_handoff', { taskId: task.id, instruction: 'Must not dispatch while a tool is in flight.' });
  assert.equal(fenced.isError, true);
  assert.match(fenced.content[0].text, /Wait for tool operations/);
  hook({ cwd, session_id: sessionId, hook_event_name: 'PostToolUse', tool_name: 'shell', tool_use_id: 'tool-2' });
  step('in-flight fence', 'handoff rejected while a source tool is in flight, then unblocked');

  const job = await ok('relay_handoff', { taskId: task.id, instruction: 'SIMULATION: complete the Hooks chain fixture.' });
  assert.ok(job.receipt);
  assert.ok(job.dashboardUrl.includes('job=' + job.id));
  step('relay_handoff', `job ${job.id} accepted with durable receipt`);

  const denied = hook({ cwd, session_id: sessionId, hook_event_name: 'PreToolUse', tool_name: 'shell', tool_use_id: 'tool-3' });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /external Agent owns this workspace/);
  const safe = hook({ cwd, session_id: sessionId, hook_event_name: 'PreToolUse', tool_name: 'mcp__agent_relay__relay_status', tool_use_id: 'tool-4' });
  assert.notEqual(safe.hookSpecificOutput?.permissionDecision, 'deny');
  step('PreToolUse fencing', 'source tools denied while the external Agent owns the workspace; relay_status allowed');

  let detail: any;
  for (let i = 0; i < 100; i++) {
    detail = await ok('relay_status', { jobId: job.id });
    if (detail.job.state === 'ended') break;
    await sleep(100);
  }
  assert.equal(detail.job.state, 'ended');
  assert.equal(detail.job.reportedComplete, true);
  assert.match(detail.job.result, /Fixture completed/);
  const kinds = new Set(detail.events.map((e: any) => e.kind));
  for (const kind of ['preparing', 'accepted', 'running', 'ended']) assert.ok(kinds.has(kind), `missing ${kind}`);
  step('execution', `job ended self-reported complete; events: ${[...kinds].join(', ')}`);

  const verified = await ok('relay_verify', { jobId: job.id, evidence: ['Simulated Hooks chain completed; fixture result inspected independently.'] });
  assert.equal(verified.verification.status, 'evidence_recorded');
  const after = hook({ cwd, session_id: sessionId, hook_event_name: 'PreToolUse', tool_name: 'shell', tool_use_id: 'tool-5' });
  assert.equal(after.hookSpecificOutput.permissionDecision, 'deny');
  step('post-handoff', 'evidence recorded (not auto-accepted); source tools stay fenced after the job ends');

  const persisted = readJSON<any>(join(home, 'state.json'));
  assert.equal(persisted.jobs[0].state, 'ended');
  assert.equal(persisted.tasks[0].state, 'handed_off');
  step('persistence', 'state.json records handed_off task and ended job');

  console.log(JSON.stringify({ ok: true, taskId: task.id, jobId: job.id, steps: report }, null, 2));
} finally {
  await rpc?.close();
  if (daemon.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(daemon.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else { try { process.kill(daemon.pid, 'SIGTERM'); } catch {} }
  }
  await sleep(300);
  for (let i = 0; i < 30; i++) {
    try { rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(100); }
  }
}
