import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { atomicJSON, canonical, pathKey, findProject, readJSON, readUser, redact, rejectSecrets, validateCheckpoint, saveProject, digest } from './config.ts';
import { QuotaReader, remaining } from './quota.ts';
import { DshAdapter } from './adapters/dsh.ts';
import { projectPaths, rememberProject } from './setup.ts';
import type { Task, Job, RelayEvent, AgentAdapter, AgentRun, QuotaSnapshot, AdapterEvent, TaskState } from './types.ts';

import { persistedState, sanitize, scanSecrets } from './privacy.ts';

const liveStates = new Set(['preparing','accepted','running']);
const safeTool = (name: string) => /(?:^|__)relay_(?:setup|register|checkpoint|handoff|status|finish|task_state|verify)$/.test(name) || /(?:open_in_codex|request_user_input|wait)$/.test(name);
export class Relay extends EventEmitter {
  home: string;
  tasks: Task[] = [];
  jobs: Job[] = [];
  runs = new Map<string, AgentRun>();
  launches = new Map<string, Promise<Job>>();
  quota: QuotaReader;
  timer?: NodeJS.Timeout;
  retentionTimer?: NodeJS.Timeout;
  adapters = new Map<string, AgentAdapter>([['deepseek-harness', new DshAdapter()]]);
  baseUrl = '';
  token = '';
  constructor(home: string, quota?: QuotaReader) {
    super(); this.home = home;
    mkdirSync(join(home, 'events'), { recursive: true, mode: 0o700 });
    const saved = readJSON<{ tasks: Task[]; jobs: Job[] }>(join(home, 'state.json'), { tasks: [], jobs: [] });
    this.tasks = saved.tasks; this.jobs = saved.jobs;
    for (const job of this.jobs) if (liveStates.has(job.state)) { job.state = 'failed'; job.recoveryRequired = true; job.error = 'Relay restarted; previous execution state is unknown. Inspect existing processes before retrying. No task was resent.'; }
    for (const task of this.tasks) { task.inFlight = []; task.checkpointFresh = false; if (task.state === 'active') task.state = 'paused'; }
    this.quota = quota || new QuotaReader(readUser(home).codex);
    this.save();
  }
  async loadAdapters(): Promise<void> {
    for (const [name, modulePath] of Object.entries(readUser(this.home).adapterModules || {})) {
      if (!isAbsolute(modulePath) || name === 'deepseek-harness') throw Error('Adapter modules must be absolute, user-installed paths with unique names');
      const adapter = (await import(pathToFileURL(modulePath).href)).default;
      if (!adapter?.start || !adapter?.validate) throw Error(`Invalid adapter: ${name}`);
      this.adapters.set(name, adapter);
    }
  }
  save(): void {
    const days = readUser(this.home).retentionDays ?? 7;
    if (!Number.isFinite(days) || days < 1 || days > 30) throw Error('retentionDays must be between 1 and 30');
    const cutoff = Date.now() - days * 86400000;
    const expired = new Set(this.jobs.filter(j => !liveStates.has(j.state) && !this.runs.has(j.id) && Date.parse(j.updatedAt) < cutoff).map(j => j.id));
    for (const id of expired) if (/^[a-f0-9-]{36}$/.test(id)) rmSync(join(this.home, 'events', id + '.jsonl'), { force: true });
    for (const j of this.jobs) if (expired.has(j.id) && j.recoveryRequired) { j.result = undefined; j.verification = null; j.instruction = '[Expired]'; j.checkpoint = { ...j.checkpoint, goal: '[Expired]', completed: [], remaining: [], decisions: [], files: [], tests: [], processes: [], acceptance: [], permissions: '' }; }
    this.jobs = this.jobs.filter(j => !expired.has(j.id) || j.recoveryRequired);
    this.tasks = this.tasks.filter(t => !(t.jobId && expired.has(t.jobId) && !this.jobs.some(j => j.id === t.jobId)) && (t.state === 'active' || !!t.jobId || Date.parse(t.updatedAt) >= cutoff));
    atomicJSON(join(this.home, 'state.json'), persistedState(this.tasks, this.jobs)); this.emit('change');
  }
  event(job: Job, kind: string, text: string): void {
    const events = this.events(job.id);
    const item: RelayEvent = { seq: (events.at(-1)?.seq || 0) + 1, at: new Date().toISOString(), kind, text: redact(text).slice(0, 8_000) };
    const eventPath = join(this.home, 'events', `${job.id}.jsonl`);
    try { if (statSync(eventPath).size > 2_000_000) return; } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    appendFileSync(eventPath, JSON.stringify(item) + '\n', { mode: 0o600 });
    this.emit('event', job.id, item);
  }
  events(id: string): RelayEvent[] {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid job id');
    try { return readFileSync(join(this.home, 'events', `${id}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
    catch (e: any) { if (e.code === 'ENOENT') return []; throw e; }
  }
  task(id: string): Task { const task = this.tasks.find(t => t.id === id); if (!task) throw Error('Unknown task'); return task; }
  job(id: string): Job { const job = this.jobs.find(j => j.id === id); if (!job) throw Error('Unknown job'); return job; }
  taskForSession(session: string, cwd: string): Task | undefined { return this.tasks.findLast(t => t.sessionId === session && pathKey(t.cwd) === pathKey(cwd)); }
  async register(input: any): Promise<Task> {
    const project = findProject(input.cwd, this.home);
    if (!project?.config.enabled) throw Error('Project relay is not enabled');
    rememberProject(this.home, project.root);
    if (typeof input.sessionId !== 'string' || !input.sessionId) throw Error('sessionId is required');
    const checkpoint = validateCheckpoint(input.checkpoint); rejectSecrets(checkpoint);
    const previous = this.taskForSession(input.sessionId, input.cwd);
    if (previous && previous.state !== 'completed') {
      if (previous.checkpoint.goal !== checkpoint.goal) throw Error('Finish or explicitly complete the existing task before registering another');
      return previous;
    }
    const task: Task = { id: randomUUID(), sessionId: input.sessionId, cwd: canonical(input.cwd), project: project.root,
      mode: input.mode || 'default', state: input.mode === 'plan' ? 'paused' : 'active', checkpoint, updatedAt: new Date().toISOString(), inFlight: [], checkpointFresh: true };
    this.tasks.push(task); this.save(); await this.refresh(); return task;
  }
  checkpoint(input: any): Task {
    const task = this.task(input.taskId);
    if (task.jobId) throw Error('Dispatched task content is immutable');
    const checkpoint = validateCheckpoint(input.checkpoint); rejectSecrets(checkpoint);
    task.checkpoint = checkpoint; task.checkpointFresh = true; task.updatedAt = new Date().toISOString();
    // Background work must be identified explicitly, with evidence in the checkpoint.
    if (input.backgroundToolIds?.length) {
      if (!checkpoint.processes.length) throw Error('Record background process IDs and inspection evidence first');
      task.inFlight = task.inFlight.filter(id => !input.backgroundToolIds.includes(id));
    }
    this.save(); return task;
  }
  setState(id: string, state: TaskState): Task {
    const task = this.task(id);
    if (!['active','paused','waiting_user','completed'].includes(state)) throw Error('Invalid task state');
    if (task.jobId && liveStates.has(this.job(task.jobId).state)) throw Error('External execution still owns this task; stop it first');
    if (task.jobId && state === 'active') throw Error('Create a new task after reviewing the external result; dispatched tasks cannot be resent');
    task.state = state; if (state === 'completed') task.checkpoint.remaining = [];
    task.updatedAt = new Date().toISOString(); this.save(); return task;
  }
  async refresh(): Promise<QuotaSnapshot> {
    if (!this.tasks.some(t => t.state === 'active' && t.mode !== 'plan')) { this.save(); return this.quota.snapshot; }
    const snapshot = await this.quota.refresh();
    for (const task of this.tasks) {
      if (task.state !== 'active') continue;
      const project = findProject(task.cwd, this.home);
      if (project?.config.enabled && remaining(snapshot, project.config.quotaBucket) === 0 && !task.jobId) {
        task.state = 'handoff_failed'; task.handoffError = 'Codex quota exhausted before a confirmed handoff. Checkpoint retained; no task was sent.';
      }
    }
    this.save(); return snapshot;
  }
  startMonitor(): void {
    if (this.timer || this.retentionTimer) return;
    this.timer = setInterval(() => { void this.refresh().catch(e => this.emit('diagnostic', redact(String(e)))); }, 30_000);
    // Retention must run even with no active tasks or a stalled quota request.
    this.retentionTimer = setInterval(() => {
      try { this.save(); } catch (e) { this.emit('diagnostic', redact(String(e))); }
    }, 30_000);
  }
  quotaFor(task: Task): number | null { const p = findProject(task.cwd, this.home); return p ? remaining(this.quota.snapshot, p.config.quotaBucket) : null; }
  async handoff(input: any): Promise<Job> {
    const task = this.task(input.taskId);
    const pending = this.launches.get(task.id); if (pending) return pending;
    if (task.jobId) return this.job(task.jobId);
    const promise = this.beginHandoff(task, input);
    this.launches.set(task.id, promise);
    try { return await promise; } finally { this.launches.delete(task.id); }
  }
  async beginHandoff(task: Task, input: any): Promise<Job> {
    if (task.checkpointFresh === false) throw Error('Provide a fresh checkpoint after service restart');
    let project = findProject(task.cwd, this.home);
    if (!project?.config.enabled) throw Error('Project relay disabled');
    if (task.state !== 'active' || task.mode === 'plan' || !task.checkpoint.remaining.length) throw Error('Only unfinished, active execution tasks may be handed off');
    if (task.inFlight.length) throw Error(`Wait for tool operations to finish: ${task.inFlight.join(', ')}`);
    await this.refresh();
    // User state, configuration and tool activity may change while quota is being read.
    project = findProject(task.cwd, this.home);
    if (!project?.config.enabled) throw Error('Project relay disabled');
    if (task.state !== 'active' || task.mode === 'plan' || !task.checkpoint.remaining.length) throw Error('Only unfinished, active execution tasks may be handed off');
    if (task.inFlight.length) throw Error(`Wait for tool operations to finish: ${task.inFlight.join(', ')}`);
    const left = remaining(this.quota.snapshot, project.config.quotaBucket);
    if (left === null) throw Error('Quota unknown; handoff not started');
    if (left <= 0) throw Error('Quota already exhausted; preserve checkpoint for manual recovery');
    if (left > project.config.thresholdPercent) throw Error('Quota threshold has not been reached');
    if (typeof input.instruction !== 'string' || !input.instruction.trim()) throw Error('Codex must supply final handoff instructions');
    rejectSecrets(input.instruction);
    const adapter = this.adapters.get(project.config.agent);
    const launch = readUser(this.home).agents[project.config.agent];
    if (!adapter || !launch) throw Error(`Agent adapter or user launch configuration unavailable: ${project.config.agent}`);
    adapter.validate(project.config, launch);
    const approvedConfig = JSON.stringify(project.config);
    const approvedLaunch = digest(launch);
    const payload = structuredClone({ checkpoint: task.checkpoint, instruction: input.instruction });
    const checkpointHash = digest(payload.checkpoint);
    await scanSecrets(task.cwd, payload, readUser(this.home).scanner);
    project = findProject(task.cwd, this.home);
    if (!project?.config.enabled || JSON.stringify(project.config) !== approvedConfig || task.state !== 'active' || task.inFlight.length || task.mode === 'plan') throw Error('Task or approved configuration changed during preflight; handoff blocked');
    if (!task.checkpoint.remaining.length || digest(task.checkpoint) !== checkpointHash || input.instruction !== payload.instruction) throw Error('Checkpoint or instruction changed during secret scan; handoff blocked. Update the checkpoint and retry.');
    if (digest(readUser(this.home).agents[project.config.agent]) !== approvedLaunch) throw Error('Launch configuration changed during secret scan; handoff blocked');
    const currentLeft = remaining(this.quota.snapshot, project.config.quotaBucket);
    if (currentLeft === null || currentLeft <= 0 || currentLeft > project.config.thresholdPercent) throw Error('Quota changed or became unknown during preflight');
    // Recheck after the quota await: another session may have acquired this workspace.
    if (this.jobs.some(j => pathKey(j.cwd) === pathKey(task.cwd) && (liveStates.has(j.state) || this.runs.has(j.id) || j.recoveryRequired))) throw Error('Workspace busy: another managed handoff is running or needs recovery inspection');
    const now = new Date().toISOString();
    const job: Job = { id: randomUUID(), taskId: task.id, project: task.project, cwd: task.cwd, config: structuredClone(project.config),
      checkpoint: payload.checkpoint, instruction: payload.instruction, state: 'preparing', createdAt: now, updatedAt: now, reportedComplete: false, verification: null };
    this.jobs.push(job); task.jobId = job.id; task.state = 'handed_off'; this.save();
    this.event(job, 'preparing', `额度即将用尽，开始调用 ${project.config.agent}，模型：${project.config.model}`);
    let acknowledge!: () => void;
    const receipt = new Promise<void>(resolve => { acknowledge = resolve; });
    const emit = (e: AdapterEvent) => {
      if (job.state === 'cancelled') return;
      job.updatedAt = new Date().toISOString();
      if (e.kind !== 'log' && !(e.kind === 'accepted' && job.state === 'running')) job.state = e.kind;
      if (e.kind === 'accepted') { job.receipt = e.receipt; job.externalSessionId = e.sessionId; acknowledge(); }
      if (e.kind === 'ended' || e.kind === 'waiting_user') { job.result = redact(e.text); job.reportedComplete = e.reportedComplete === true; }
      this.event(job, e.kind, e.text); this.save();
    };
    try {
      const run = adapter.start(job, launch, emit); this.runs.set(job.id, run);
      const finished = run.done.catch((e: any) => {
        if (job.state !== 'cancelled') { job.state = 'failed'; job.reportedComplete = false; job.recoveryRequired = true; job.error = redact(e.message); this.event(job, 'failed', job.error!); this.save(); }
      }).finally(() => { this.runs.delete(job.id); });
      await Promise.race([receipt, finished]);
    } catch (e: any) { job.state = 'failed'; job.reportedComplete = false; job.recoveryRequired = true; job.error = redact(e.message); this.event(job, 'failed', job.error!); this.save(); }
    return job;
  }
  async stop(id: string): Promise<Job> {
    const job = this.job(id); const run = this.runs.get(id);
    if (!run) throw Error('No owned live runtime; inspect the stored result');
    job.state = 'cancelled'; this.event(job, 'cancelled', 'Stop requested for the owned process tree; process isolation is not verified. Inspect detached/background processes before recovery.'); this.save();
    job.recoveryRequired = true; this.save();
    try { await run.stop(); } catch (e: any) { job.error = redact(e.message); }
    this.save(); return job;
  }
  verify(input: any): Job {
    const job = this.job(input.jobId);
    if (job.state !== 'ended' || !Array.isArray(input.evidence) || !input.evidence.length || input.evidence.some((s: any) => typeof s !== 'string' || !s.trim())) throw Error('Verification requires an ended job and explicit evidence');
    rejectSecrets(input.evidence); job.verification = { status: 'evidence_recorded', evidence: sanitize(input.evidence) }; this.save(); return job;
  }
  recover(input: any): Job {
    const job = this.job(input.jobId);
    if (!job.recoveryRequired || this.runs.has(job.id) || typeof input.evidence !== 'string' || !input.evidence.trim()) throw Error('Recovery requires an orphaned job and user-supplied process inspection evidence');
    rejectSecrets(input.evidence); job.recoveryRequired = false;
    this.event(job, 'recovery', `User confirmed previous runtime is no longer active: ${input.evidence}`); this.save(); return job;
  }
  async hook(h: any): Promise<any> {
    const task = this.taskForSession(h.session_id, h.cwd);
    const event = h.hook_event_name;
    const tool = h.tool_name || '';
    const owner = this.jobs.find(j => pathKey(j.cwd) === pathKey(h.cwd) && (liveStates.has(j.state) || this.runs.has(j.id) || j.recoveryRequired));
    if (event === 'PreToolUse' && (owner || task?.jobId) && !safeTool(tool)) return { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: 'An external Agent owns this workspace or requires recovery inspection. Check the relay dashboard.' } };
    const project = findProject(h.cwd, this.home);
    if (!project?.config.enabled) return {};
    const output = (text: string) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
    if (!task) {
      if (['SessionStart','UserPromptSubmit'].includes(event) && h.permission_mode !== 'plan') return output(`This project enabled Codex Agent Relay. For an execution task, use the codex-agent-relay skill and relay_register with sessionId ${h.session_id}, cwd ${h.cwd}. Maintain checkpoints and mark completion; do not register casual questions. Configure target: ${project.config.agent}/${project.config.model}.`);
      return {};
    }
    if (h.permission_mode) task.mode = h.permission_mode;
    if (h.turn_id) task.lastTurnId = h.turn_id;
    if (['Interrupt','SessionEnd'].includes(event)) { if (task.state === 'active') task.state = 'paused'; this.save(); return {}; }
    if (event === 'PreToolUse') {
      if ((task.jobId || owner) && !safeTool(tool)) return { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: 'External Agent owns this task/workspace. Use relay_status and the dashboard; do not execute source task tools.' } };
      if (!safeTool(tool) && h.tool_use_id && !task.inFlight.includes(h.tool_use_id)) task.inFlight.push(h.tool_use_id);
    }
    if (event === 'PostToolUse') task.inFlight = task.inFlight.filter(id => id !== h.tool_use_id);
    if (event === 'Stop' && task.state === 'active') { task.state = 'paused'; this.save(); return { systemMessage: 'Relay task paused at end of turn. A checkpoint is retained; no idle-time handoff will occur.' }; }
    this.save();
    if (event === 'UserPromptSubmit' && ['paused','waiting_user'].includes(task.state) && task.mode !== 'plan') return output(`Relay task ${task.id} is ${task.state}. If this user message explicitly continues its execution, use relay_task_state(active), then update its checkpoint. Otherwise keep it paused.`);
    if (task.mode === 'plan' || task.state !== 'active' || task.jobId) return {};
    const left = this.quotaFor(task);
    if (left !== null && left > 0 && left <= project.config.thresholdPercent && ['PreToolUse','PostToolUse','UserPromptSubmit'].includes(event)) {
      return output(`Codex quota remaining ${left}%, threshold ${project.config.thresholdPercent}%. If the task is complete call relay_finish. Otherwise finish current file operations, update relay_checkpoint, announce 开始调用 ${project.config.agent}，模型：${project.config.model}, and call relay_handoff with taskId ${task.id} and concrete remaining instructions. Open its dashboardUrl in the Codex right browser panel. Do not keep executing the source task after handoff.`);
    }
    return {};
  }
  config(project: string, value?: any): any {
    const root = canonical(project);
    if (!this.projects().some(p => pathKey(p) === pathKey(root))) throw Error('Unknown project; use first-time setup before editing settings');
    if (value) { if (!this.adapters.has(value.agent)) throw Error('Agent adapter is not installed'); rejectSecrets(value); return saveProject(root, value, this.home); }
    return findProject(root, this.home)?.config ?? null;
  }
  projects(): string[] { return [...new Map([...projectPaths(this.home), ...this.tasks.map(t => t.project)].map(p => [pathKey(p), p])).values()]; }
  snapshot(): any { return { tasks: this.tasks.map(t => ({ ...t, remainingPercent: this.quotaFor(t) })), jobs: this.jobs, projects: this.projects(), quota: { at: this.quota.snapshot.at, error: this.quota.snapshot.error }, agents: [...this.adapters.keys()] }; }
  async close(): Promise<void> { clearInterval(this.timer); clearInterval(this.retentionTimer); await Promise.allSettled([...this.runs.values()].map(r => r.stop())); await this.quota.close(); }
}
