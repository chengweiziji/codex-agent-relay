import { join } from 'node:path';
import { atomicJSON } from '../../src/config.ts';
import { Relay } from '../../src/relay.ts';
import { QuotaReader } from '../../src/quota.ts';
import { startServer } from '../../src/server.ts';

class SimulatedQuota extends QuotaReader {
  override async refresh() {
    this.snapshot = { at: Date.now(), data: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 96 } } } } };
    return this.snapshot;
  }
  override async close() {}
}

const home = process.argv[2];
const relay = new Relay(home, new SimulatedQuota());
await relay.loadAdapters();
const server = await startServer(relay);
atomicJSON(join(home, 'server.json'), { pid: process.pid, url: server.url, token: relay.token });
process.on('SIGTERM', () => { void server.close().then(() => process.exit(0)); });
setInterval(() => {}, 1 << 30);
