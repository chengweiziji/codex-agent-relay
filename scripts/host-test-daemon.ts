// Explicit native-host acceptance fixture: simulated quota, REAL configured receiver.
// No task is submitted here. A trusted native Codex Hook/MCP chat must submit it.
import { join } from 'node:path';
import { Relay } from '../src/relay.ts';
import { QuotaReader } from '../src/quota.ts';
import { atomicJSON } from '../src/config.ts';
import { startServer } from '../src/server.ts';
import { validateHostTestScope } from './host-test-scope.ts';
import { pathKey } from '../src/config.ts';

if (process.argv[2] !== '--simulate-quota-for-host-test' || !process.argv[3]) throw Error('Explicit host-test flag and isolated relay home required');
const home = process.argv[3];
const project = validateHostTestScope(home);
function checkScope(cwd = project) {
  if (pathKey(validateHostTestScope(home)) !== pathKey(project) || pathKey(cwd) !== pathKey(project)) throw Error('Host-test project scope changed');
}
class HostTestQuota extends QuotaReader {
  override async refresh() {
    checkScope();
    this.snapshot = { at: Date.now(), data: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 96 } } } } };
    return this.snapshot;
  }
  override async close() {}
}
class HostTestRelay extends Relay {
  // The fixture must expose its simulated quota even while persisted tasks are paused.
  // Production Relay deliberately skips quota reads when there is no active task.
  override async refresh() { await this.quota.refresh(); return super.refresh(); }
  override async register(input: any) { checkScope(input.cwd); return super.register(input); }
  override async hook(input: any) { checkScope(input.cwd); return super.hook(input); }
  override async handoff(input: any) { checkScope(this.task(input.taskId).cwd); return super.handoff(input); }
}
const relay = new HostTestRelay(home, new HostTestQuota());
await relay.refresh();
await relay.loadAdapters();
const server = await startServer(relay);
atomicJSON(join(relay.home, 'server.json'), { pid: process.pid, url: server.url, token: relay.token, quotaMode: 'simulated-host-test' });
console.log('Host acceptance fixture: simulated 4% quota, real receiver. No model called until native handoff.');
process.on('SIGTERM', () => { void server.close().then(() => process.exit(0)); });
// Bound unattended test infrastructure too; the receiver has its own shorter deadline.
setTimeout(() => { void server.close().then(() => process.exit(0)); }, 3_600_000);
