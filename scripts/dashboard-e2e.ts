// Real browser, simulated quota/receiver. No provider calls.
// Install Playwright separately, or set RELAY_PLAYWRIGHT to its index.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Relay } from '../src/relay.ts';
import { QuotaReader } from '../src/quota.ts';
import { atomicJSON, saveProject, findProject } from '../src/config.ts';
import { startServer, dashboard } from '../src/server.ts';

const moduleName = process.env.RELAY_PLAYWRIGHT ? pathToFileURL(process.env.RELAY_PLAYWRIGHT).href : 'playwright';
const { chromium } = await import(moduleName);
const root = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'relay-browser-'));
const home = join(dir, 'home'), project = join(dir, 'project'); mkdirSync(project);
atomicJSON(join(home, 'user.json'), {
  scanner: { command: process.execPath, args: [join(root, 'test/fixtures/scanner.mjs')] },
  adapterModules: { fixture: join(root, 'test/fixtures/adapter.ts') },
  agents: { fixture: { command: process.execPath, args: [join(root, 'test/fixtures/fake-sdk.mjs'), '--profile', 'sdk'], env: { RELAY_TEST_DELAY: '4000' }, runTimeoutMs: 30000 } },
});
saveProject(project, { version: 1, enabled: true, agent: 'fixture', provider: 'fixture', model: 'fixture', thresholdPercent: 5, quotaBucket: 'codex' }, home);
class SimulatedQuota extends QuotaReader {
  override async refresh() { this.snapshot = { at: Date.now(), data: { rateLimitsByLimitId: { codex: { primary: { usedPercent: 96 } } } } }; return this.snapshot; }
  override async close() {}
}
const relay = new Relay(home, new SimulatedQuota());
let browser: any, server: Awaited<ReturnType<typeof startServer>> | undefined;
try {
  await relay.loadAdapters(); server = await startServer(relay);
  browser = await chromium.launch({ headless: true, ...(process.env.RELAY_BROWSER_CHANNEL ? { channel: process.env.RELAY_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ acceptDownloads: true });
  let streamRequests = 0;
  await page.route('**/events?*', async (route: any) => {
    streamRequests++;
    if (streamRequests === 1) await route.fulfill({ contentType: 'text/event-stream', body: '' });
    else await route.continue();
  });
  const task = await relay.register({ cwd: project, sessionId: 'browser-fixture', checkpoint: { goal: 'Browser fixture', completed: [], remaining: ['Simulated work'], decisions: [], files: [], tests: [], processes: [], permissions: 'Simulation', acceptance: ['Fixture completion'] } });
  const job = await relay.handoff({ taskId: task.id, instruction: 'Simulation only' });
  await page.goto(dashboard(relay, job.id));
  await page.locator('#stream-state').filter({ hasText: '实时连接' }).waitFor();
  // The timeline is populated only by SSE, never by status polling.
  await page.locator('#events li').filter({ hasText: 'ended' }).waitFor({ timeout: 20000 });
  assert.ok(streamRequests >= 2, 'SSE must reconnect after the first connection ends');
  await page.locator('#result').filter({ hasText: 'Fixture completed' }).waitFor();
  const count = await page.locator('#events li').count();
  await page.context().setOffline(true); await page.waitForTimeout(200); await page.context().setOffline(false);
  await page.reload();
  await page.locator('#events li').filter({ hasText: 'ended' }).waitFor();
  assert.equal(await page.locator('#events li').count(), count);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download-result').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), `relay-result-${job.id}.md`);
  assert.match(readFileSync(await download.path(), 'utf8'), /Fixture completed/);
  page.on('dialog', (dialog: any) => dialog.accept());
  await page.locator('#settings-tab').click(); await page.locator('#threshold').fill('7');
  await page.locator('#config-form button[type=submit]').click();
  await page.locator('#saved').filter({ hasText: '已保存' }).waitFor();
  assert.equal(findProject(project, home)?.config.thresholdPercent, 7);
  console.log('PASS browser SSE timeline, refresh replay, Markdown download and confirmed settings persistence');
} finally {
  await browser?.close(); await server?.close(); await relay.close();
  rmSync(dir, { recursive: true, force: true });
}
