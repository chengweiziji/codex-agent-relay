import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { atomicJSON } from '../src/config.ts';
import { ensureServer } from '../src/client.ts';

test('acceptance client never falls back to a normal quota daemon', async t => {
  const home=mkdtempSync(join(tmpdir(),'relay-client-host-'));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  atomicJSON(join(home,'host-test.json'),{purpose:'disposable-host-acceptance'});
  await assert.rejects(ensureServer(home),/fallback is disabled/);
  assert.equal(existsSync(join(home,'service.log')),false);
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({pid:process.pid}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise<void>(r=>server.close(()=>r())));
  const address=server.address() as {port:number};
  const endpoint={pid:process.pid,url:`http://127.0.0.1:${address.port}`,token:'test-only'};
  atomicJSON(join(home,'server.json'),endpoint);
  await assert.rejects(ensureServer(home),/not using simulated quota/);
  atomicJSON(join(home,'server.json'),{...endpoint,quotaMode:'simulated-host-test'});
  assert.equal((await ensureServer(home)).pid,process.pid);
});
