import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { atomicJSON, readJSON, redact } from './config.ts';
import { Relay } from './relay.ts';
import { setupInfo, saveSetup } from './setup.ts';

export async function action(relay: Relay, name: string, input: any): Promise<any> {
  let result: any;
  switch (name) {
    case 'setup': return { dashboardUrl: dashboard(relay) + '&view=settings' + (input.cwd ? '&project=' + encodeURIComponent(input.cwd) : ''), note: 'Choose the project, Agent and model in this local setup page. Saving does not start a model call.' };
    case 'setup_info': return setupInfo(relay.home);
    case 'setup_save': return saveSetup(relay.home, input);
    case 'register': result = await relay.register(input); break;
    case 'checkpoint': result = relay.checkpoint(input); break;
    case 'handoff': result = await relay.handoff(input); break;
    case 'status': return input.jobId ? { job: relay.job(input.jobId), events: relay.events(input.jobId), dashboardUrl: dashboard(relay, input.jobId) } : relay.snapshot();
    case 'finish': result = relay.setState(input.taskId, 'completed'); break;
    case 'task_state': result = relay.setState(input.taskId, input.state); break;
    case 'verify': result = relay.verify(input); break;
    case 'stop': result = await relay.stop(input.jobId); break;
    case 'recover': result = relay.recover(input); break;
    case 'hook': return relay.hook(input);
    case 'config': return relay.config(input.project, input.config);
    default: throw Error('Unknown action');
  }
  return { ...result, dashboardUrl: dashboard(relay, result.taskId ? result.id : undefined) };
}
export function dashboard(relay: Relay, jobId?: string): string {
  return `${relay.baseUrl}/#token=${relay.token}${jobId ? `&job=${jobId}` : ''}`;
}
async function body(req: IncomingMessage): Promise<any> {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 300_000) throw Error('Request too large'); }
  return JSON.parse(text || '{}');
}
export async function startServer(relay: Relay, port = 0): Promise<{ close(): Promise<void>; url: string }> {
  relay.token = randomBytes(32).toString('hex');
  const ui = readFileSync(new URL('../public/index.html', import.meta.url));
  const script = readFileSync(new URL('../public/app.js', import.meta.url));
  const css = readFileSync(new URL('../public/style.css', import.meta.url));
  const streams = new Set<ServerResponse>();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url || '/', relay.baseUrl || 'http://127.0.0.1');
      if (req.headers.host !== new URL(relay.baseUrl).host) throw Error('Invalid Host');
      if (req.headers.origin && req.headers.origin !== relay.baseUrl) throw Error('Cross-origin request denied');
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        res.setHeader('Content-Type', url.pathname === '/' ? 'text/html; charset=utf-8' : url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css');
        res.end(url.pathname === '/' ? ui : url.pathname.endsWith('.js') ? script : css); return;
      }
      const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
      const expected = Buffer.from(relay.token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end('Unauthorized'); return; }
      if (req.method === 'GET' && url.pathname === '/health') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok: true, pid: process.pid, version: '0.1.0' })); return; }
      if (req.method === 'GET' && url.pathname === '/events') {
        const id = url.searchParams.get('job') || ''; relay.job(id);
        let cursor = Number(url.searchParams.get('after') || 0);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        const send = () => {
          for (const e of relay.events(id)) if (e.seq > cursor) { res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`); cursor = e.seq; }
        };
        send(); streams.add(res);
        const onEvent = (jobId: string) => { if (jobId === id) send(); };
        relay.on('event', onEvent);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
        req.on('close', () => { clearInterval(heartbeat); relay.off('event', onEvent); streams.delete(res); }); return;
      }
      if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
      const result = await action(relay, url.pathname.slice(5), await body(req));
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (e: any) { if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: redact(e.message) })); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No listening address');
  relay.baseUrl = `http://127.0.0.1:${address.port}`;
  relay.startMonitor();
  return { url: relay.baseUrl, close: async () => {
    for (const res of streams) res.end(); server.closeAllConnections();
    await relay.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
export async function serve(home: string): Promise<void> {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const lock = join(home, 'server.lock');
  try { mkdirSync(lock); } catch (e: any) {
    if (e.code !== 'EEXIST') throw e;
    const owner = readJSON<{ pid: number }>(join(lock, 'owner.json'), { pid: 0 });
    if (!owner.pid) throw Error('Another server may be starting; retry shortly');
    try { process.kill(owner.pid, 0); throw Error('Relay server is already running'); }
    catch (err: any) { if (err.code !== 'ESRCH') throw err; }
    rmSync(lock, { recursive: true }); mkdirSync(lock);
  }
  atomicJSON(join(lock, 'owner.json'), { pid: process.pid });
  const relay = new Relay(home);
  let server: Awaited<ReturnType<typeof startServer>>;
  try { await relay.loadAdapters(); server = await startServer(relay); }
  catch (e) { await relay.close(); rmSync(lock, { recursive: true, force: true }); throw e; }
  atomicJSON(join(home, 'server.json'), { pid: process.pid, url: server.url, token: relay.token });
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true; await server.close();
    rmSync(join(home, 'server.json'), { force: true }); rmSync(lock, { recursive: true, force: true }); process.exit(0);
  };
  process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
}
