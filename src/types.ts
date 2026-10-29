export interface ProjectConfig {
  version: 1;
  enabled: boolean;
  agent: string;
  provider: string;
  model: string;
  thresholdPercent: number;
  quotaBucket: string;
}
export interface LaunchConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  envFrom?: Record<string, string>;
  initializeTimeoutMs?: number;
  receiptTimeoutMs?: number;
  runTimeoutMs?: number;
}
export interface UserConfig {
  codex?: LaunchConfig;
  agents: Record<string, LaunchConfig>;
  adapterModules?: Record<string, string>;
  scanner?: LaunchConfig;
  retentionDays?: number;
}
export interface Checkpoint {
  goal: string;
  completed: string[];
  remaining: string[];
  decisions: string[];
  files: string[];
  tests: string[];
  processes: string[];
  permissions: string;
  acceptance: string[];
}
export type TaskState = 'active' | 'waiting_user' | 'paused' | 'completed' | 'handed_off' | 'handoff_failed';
export interface Task {
  id: string;
  sessionId: string;
  project: string;
  cwd: string;
  state: TaskState;
  mode: string;
  checkpoint: Checkpoint;
  updatedAt: string;
  inFlight: string[];
  checkpointFresh?: boolean;
  lastTurnId?: string;
  jobId?: string;
  handoffError?: string;
}
export type JobState = 'preparing' | 'accepted' | 'running' | 'waiting_user' | 'ended' | 'failed' | 'cancelled';
export interface Job {
  id: string;
  taskId: string;
  project: string;
  cwd: string;
  config: ProjectConfig;
  checkpoint: Checkpoint;
  instruction: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  receipt?: string;
  externalSessionId?: string;
  result?: string;
  error?: string;
  recoveryRequired?: boolean;
  reportedComplete: boolean;
  verification: { status: 'evidence_recorded'; evidence: string[] } | null;
}
export interface RelayEvent { seq: number; at: string; kind: string; text: string }
export interface QuotaSnapshot { at: number; data?: any; error?: string }
export interface AdapterEvent { kind: 'accepted' | 'running' | 'waiting_user' | 'log' | 'ended'; text: string; receipt?: string; sessionId?: string; reportedComplete?: boolean }
export interface AgentRun { done: Promise<void>; stop(): Promise<void> }
export interface AgentAdapter {
  validate(config: ProjectConfig, launch: LaunchConfig): void;
  preflight?(cwd: string): void;
  start(job: Job, launch: LaunchConfig, emit: (event: AdapterEvent) => void): AgentRun;
}
