// Explicit native-host acceptance fixture: simulated quota, REAL configured receiver.
// No task is submitted here. A trusted native Codex Hook/MCP chat must submit it.
import { join } from 'node:path';
import { Relay } from '../src/relay.ts';
import { QuotaReader } from '../src/quota.ts';
import { atomicJSON } from '../src/config.ts';
import { startServer } from '../src/server.ts';

if (process.argv[2] !== '--simulate-quota-for-host-test' || !process.argv[3]) throw Error('Explicit host-test flag and isolated relay home required');
class HostTestQuota extends QuotaReader {
  override async refresh() {
    this.snapshot = { at: Date.now(), data: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 96 } } } } };
    return this.snapshot;
  }
  override async close() {}
}
const relay = new Relay(process.argv[3], new HostTestQuota());
await relay.loadAdapters();
const server = await startServer(relay);
atomicJSON(join(relay.home, 'server.json'), { pid: process.pid, url: server.url, token: relay.token });
console.log('Host acceptance fixture: simulated 4% quota, real receiver. No model called until native handoff.');
process.on('SIGTERM', () => { void server.close().then(() => process.exit(0)); });
// Bound unattended test infrastructure too; the receiver has its own shorter deadline.
setTimeout(() => { void server.close().then(() => process.exit(0)); }, 3_600_000);
