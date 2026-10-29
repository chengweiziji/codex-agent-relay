import { JsonRpc } from './rpc.ts';
import type { LaunchConfig, QuotaSnapshot } from './types.ts';

export function remaining(snapshot: QuotaSnapshot, bucket: string, now = Date.now()): number | null {
  if (!snapshot.data || snapshot.error || now - snapshot.at > 65_000) return null;
  const data = snapshot.data;
  const rate = data.rateLimitsByLimitId ? data.rateLimitsByLimitId[bucket] :
    ((!data.rateLimits?.limitId && bucket === 'codex') || data.rateLimits?.limitId === bucket ? data.rateLimits : undefined);
  if (!rate) return null;
  const values = [rate.primary, rate.secondary].filter(w => w && typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent) &&
    (!w.resetsAt || w.resetsAt * 1000 > now)).map(w => Math.max(0, Math.min(100, 100 - w.usedPercent)));
  return values.length ? Math.min(...values) : null;
}
export class QuotaReader {
  snapshot: QuotaSnapshot = { at: 0, error: 'Not yet read' };
  pending?: Promise<QuotaSnapshot>;
  rpc?: JsonRpc;
  config: LaunchConfig;
  constructor(config?: LaunchConfig) { this.config = config || { command: 'codex', args: ['app-server', '--stdio'] }; }
  async refresh(force = false): Promise<QuotaSnapshot> {
    if (this.pending) return this.pending;
    if (!force && Date.now() - this.snapshot.at < 30_000) return this.snapshot;
    this.pending = this.read();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  async read(): Promise<QuotaSnapshot> {
    try {
      if (!this.rpc || this.rpc.closed) {
        this.rpc = new JsonRpc(this.config);
        await this.rpc.request('initialize', { clientInfo: { name: 'codex_agent_relay', title: 'Codex Agent Relay', version: '0.1.0' } });
        this.rpc.notify('initialized');
      }
      const data = await this.rpc.request('account/rateLimits/read');
      this.snapshot = { at: Date.now(), data };
    } catch (e: any) { this.snapshot = { at: Date.now(), error: e.message }; if (this.rpc) await this.rpc.close(); }
    return this.snapshot;
  }
  async close(): Promise<void> { if (this.rpc) await this.rpc.close(); }
}
