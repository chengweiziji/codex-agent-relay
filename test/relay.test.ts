import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DshTransport } from '../src/adapters/dsh.ts';
import { Relay } from '../src/relay.ts';
import { QuotaReader, remaining } from '../src/quota.ts';
import { saveProject, atomicJSON, readJSON, findProject, validateCheckpoint, redact, rejectSecrets } from '../src/config.ts';
import { startServer } from '../src/server.ts';
import { JsonRpc } from '../src/rpc.ts';
import type { ProjectConfig, Checkpoint, QuotaSnapshot } from '../src/types.ts';

const fixture=fileURLToPath(new URL('./fixtures/fake-sdk.mjs',import.meta.url));
const baseConfig:ProjectConfig={version:1,enabled:true,agent:'deepseek-harness',provider:'deepseek-official',model:'fixture',thresholdPercent:5,quotaBucket:'codex'};
const checkpoint:Checkpoint={goal:'Fix the disposable project',completed:['Inspected source'],remaining:['Fix tests'],decisions:[],files:[],tests:[],processes:[],permissions:'Edit only this disposable workspace; no external publishing.',acceptance:['Tests pass']};
class FakeQuota extends QuotaReader { override async refresh(){return this.snapshot} override async close(){} }
function quota(used:number):QuotaSnapshot{return {at:Date.now(),data:{rateLimitsByLimitId:{codex:{primary:{usedPercent:used},secondary:{usedPercent:10}}}}}}
async function setup(t:any,model='fixture'){
  const dir=mkdtempSync(join(tmpdir(),'relay-test-'));const project=join(dir,'project');mkdirSync(project);
  const home=join(dir,'home');const count=join(dir,'count.txt');
  atomicJSON(join(home,'user.json'),{scanner:{command:process.execPath,args:[fileURLToPath(new URL('./fixtures/scanner.mjs',import.meta.url))]},agents:{'deepseek-harness':{command:process.execPath,args:[fixture,'--profile','sdk'],env:{RELAY_TEST_COUNT:count},initializeTimeoutMs:1000,receiptTimeoutMs:250,runTimeoutMs:1500}}});
  saveProject(project,{...baseConfig,model},home);
  const q=new FakeQuota();q.snapshot=quota(96);const relay=new Relay(home,q);relay.adapters.set('deepseek-harness',new DshTransport());
  t.after(async()=>{await relay.close();rmSync(dir,{recursive:true,force:true})});
  const task=await relay.register({cwd:project,sessionId:'test-session',checkpoint});
  return {relay,task,project,home,q,count,dir};
}
async function settle(relay:Relay,id:string){for(let i=0;i<1200;i++){if(!relay.runs.has(id))return relay.job(id);await new Promise(r=>setTimeout(r,10))}throw Error('Job did not finish')}
test('quota uses relevant bucket and the most constrained live window',()=>{
  const s=quota(60);s.data.rateLimitsByLimitId.codex.secondary.usedPercent=99;
  assert.equal(remaining(s,'codex'),1);assert.equal(remaining(s,'missing'),null);
  s.data.rateLimitsByLimitId.codex.secondary.resetsAt=Math.floor(Date.now()/1000)-1;assert.equal(remaining(s,'codex'),40);
  assert.equal(remaining({...s,at:0},'codex'),null);assert.equal(remaining({at:Date.now(),error:'offline'},'codex'),null);
});
test('quota RPC refresh is shared across simultaneous callers and cached',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'relay-quota-'));const count=join(dir,'calls');
  const q=new QuotaReader({command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-codex.mjs',import.meta.url))],env:{RELAY_TEST_COUNT:count}});
  t.after(async()=>{await q.close();rmSync(dir,{recursive:true,force:true})});
  await Promise.all([q.refresh(),q.refresh(),q.refresh()]);await q.refresh();
  assert.equal(readFileSync(count,'utf8').split('account/rateLimits/read').length-1,1);assert.equal(remaining(q.snapshot,'codex'),4);
});
test('threshold crossing causes hook instruction, never launches by itself',async t=>{
  const {relay,task,q}=await setup(t);q.snapshot=quota(90);
  const h={cwd:task.cwd,session_id:task.sessionId,hook_event_name:'PostToolUse',tool_use_id:'x'};
  assert.deepEqual(await relay.hook(h),{});q.snapshot=quota(96);
  assert.match((await relay.hook(h)).hookSpecificOutput.additionalContext,/relay_handoff/);assert.equal(relay.jobs.length,0);
});
test('handoff delivers exactly once under concurrent duplicate calls',async t=>{
  const {relay,task,count}=await setup(t);
  const [a,b]=await Promise.all([relay.handoff({taskId:task.id,instruction:'Finish tests.'}),relay.handoff({taskId:task.id,instruction:'Finish tests.'})]);
  assert.equal(a.id,b.id);assert.ok(a.receipt);const job=await settle(relay,a.id);
  assert.equal(job.state,'ended');assert.equal(job.reportedComplete,true);assert.equal(job.verification,null);
  assert.equal(readFileSync(count,'utf8').trim(),'prompt');
  assert.equal((await relay.handoff({taskId:task.id,instruction:'Repeat'})).id,a.id);
});
for(const state of ['paused','waiting_user','completed'] as const)test(`${state} task cannot hand off`,async t=>{
  const {relay,task}=await setup(t);relay.setState(task.id,state);
  await assert.rejects(relay.handoff({taskId:task.id,instruction:'Continue'}),/active/);
});
test('Plan mode and completed checkpoints never hand off',async t=>{
  const {relay,task}=await setup(t);task.mode='plan';await assert.rejects(relay.handoff({taskId:task.id,instruction:'Continue'}),/active/);
  task.mode='default';task.checkpoint.remaining=[];await assert.rejects(relay.handoff({taskId:task.id,instruction:'Continue'}),/unfinished/);
});
test('unknown quota does not mean zero; exhausted quota preserves checkpoint',async t=>{
  const {relay,task,q}=await setup(t);q.snapshot={at:Date.now(),error:'offline'};
  await assert.rejects(relay.handoff({taskId:task.id,instruction:'Continue'}),/unknown/);assert.equal(task.state,'active');
  q.snapshot=quota(100);await relay.refresh();assert.equal(task.state,'handoff_failed');assert.ok(task.checkpoint.remaining.length);assert.equal(relay.jobs.length,0);
});
test('pending operations block transfer; explicit background evidence can release them',async t=>{
  const {relay,task}=await setup(t);await relay.hook({cwd:task.cwd,session_id:task.sessionId,hook_event_name:'PreToolUse',tool_name:'Bash',tool_use_id:'tool-1'});
  await assert.rejects(relay.handoff({taskId:task.id,instruction:'Continue'}),/operations/);
  assert.throws(()=>relay.checkpoint({taskId:task.id,checkpoint,backgroundToolIds:['tool-1']}),/process/);
  await relay.hook({cwd:task.cwd,session_id:task.sessionId,hook_event_name:'PostToolUse',tool_name:'Bash',tool_use_id:'tool-1'});
  assert.equal(task.inFlight.length,0);
});
test('source tools are blocked after dispatch while status stays available',async t=>{
  const {relay,task}=await setup(t);await relay.handoff({taskId:task.id,instruction:'Continue'});
  const h={cwd:task.cwd,session_id:task.sessionId,hook_event_name:'PreToolUse',tool_use_id:'next'};
  assert.equal((await relay.hook({...h,tool_name:'apply_patch'})).hookSpecificOutput.permissionDecision,'deny');
  assert.deepEqual(await relay.hook({...h,tool_name:'mcp__agent_relay__relay_status'}),{});
});
test('same workspace cannot run two external owners',async t=>{
  const {relay,task,project}=await setup(t,'hang');const other=await relay.register({cwd:project,sessionId:'other',checkpoint});
  const first=await relay.handoff({taskId:task.id,instruction:'Continue'});
  await assert.rejects(relay.handoff({taskId:other.id,instruction:'Continue'}),/busy/);await relay.stop(first.id);
});
test('workspace ownership also fences unregistered chats and disabled projects',async t=>{
  const {relay,task,project}=await setup(t,'hang');const job=await relay.handoff({taskId:task.id,instruction:'Continue'});
  saveProject(project,{...baseConfig,enabled:false},relay.home);
  const h={cwd:project,session_id:'unregistered',hook_event_name:'PreToolUse',tool_name:'apply_patch'};
  assert.equal((await relay.hook(h)).hookSpecificOutput.permissionDecision,'deny');
  assert.equal((await relay.hook({...h,session_id:task.sessionId})).hookSpecificOutput.permissionDecision,'deny');
  await relay.stop(job.id);
});
for(const change of ['pause','disable','operation'] as const)test(`handoff rechecks ${change} after quota await`,async t=>{
  const {relay,task,project,q}=await setup(t);
  let release!:()=>void; q.refresh=async()=>{await new Promise<void>(r=>{release=r});return q.snapshot};
  const pending=relay.handoff({taskId:task.id,instruction:'Continue'});
  if(change==='pause')relay.setState(task.id,'paused');
  if(change==='disable')saveProject(project,{...baseConfig,enabled:false},relay.home);
  if(change==='operation')task.inFlight.push('new-operation');
  release();await assert.rejects(pending,/active|disabled|operations/);assert.equal(relay.jobs.length,0);
});
for(const [model,pattern] of [['invalid',/Unavailable/],['no-receipt',/timeout/],['crash',/exited/],['hang',/deadline/],['wrong-route',/provider\/model/],['no-route',/provider\/model/],['child-route',/provider\/model/],['child-attest',/provider\/model/],['danger',/sandbox mode/],['bad-policy',/approval policy/]] as const)test(`${model} is a failed handoff or run, not success`,async t=>{
  const {relay,task}=await setup(t,model);const job=await relay.handoff({taskId:task.id,instruction:'Continue'});await settle(relay,job.id);
  assert.equal(job.state,'failed');assert.match(job.error!,pattern);assert.equal(job.reportedComplete,false);
});
test('waiting-user result is explicit',async t=>{const {relay,task}=await setup(t,'waiting');const job=await relay.handoff({taskId:task.id,instruction:'Continue'});await settle(relay,job.id);assert.equal(job.state,'waiting_user');assert.equal(job.reportedComplete,false)});
test('model config updates affect only the next job and remain project-local',async t=>{
  const {relay,task,project,dir}=await setup(t);const job=await relay.handoff({taskId:task.id,instruction:'Continue'});
  relay.config(project,{...baseConfig,model:'next-model'});assert.equal(job.config.model,'fixture');
  const second=join(dir,'other');mkdirSync(second);saveProject(second,{...baseConfig,model:'other-model'},relay.home);
  assert.equal(findProject(second,relay.home)!.config.model,'other-model');
});
test('restart retains receipts and never resends or resumes tasks',async t=>{
  const {relay,task,home,q}=await setup(t);const job=await relay.handoff({taskId:task.id,instruction:'Continue'});await settle(relay,job.id);
  const restarted=new Relay(home,q);t.after(()=>restarted.close());assert.equal(restarted.job(job.id).receipt,job.receipt);assert.equal(restarted.runs.size,0);
});
test('history remains readable after a former workspace is removed',async t=>{
  const {relay,task,project}=await setup(t);const job=await relay.handoff({taskId:task.id,instruction:'Continue'});await settle(relay,job.id);
  rmSync(project,{recursive:true});
  assert.equal(relay.snapshot().jobs[0].receipt,job.receipt);assert.equal(relay.snapshot().tasks[0].remainingPercent,null);
  assert.deepEqual(await relay.hook({cwd:project,session_id:'other',hook_event_name:'UserPromptSubmit'}),{});
});
test('interrupted runtime remains fenced on restart until explicit recovery evidence',async t=>{
  const {relay,task,home,q,project}=await setup(t,'hang');const job=await relay.handoff({taskId:task.id,instruction:'Continue'});
  const restarted=new Relay(home,q);restarted.adapters.set('deepseek-harness',new DshTransport());t.after(()=>restarted.close());
  assert.equal(restarted.job(job.id).recoveryRequired,true);
  assert.equal((await restarted.hook({cwd:project,session_id:'new',hook_event_name:'PreToolUse',tool_name:'Bash'})).hookSpecificOutput.permissionDecision,'deny');
  const next=await restarted.register({cwd:project,sessionId:'new',checkpoint});
  await assert.rejects(restarted.handoff({taskId:next.id,instruction:'Continue'}),/busy/);
  assert.throws(()=>restarted.recover({jobId:job.id,evidence:''}),/evidence/);
  await relay.stop(job.id);restarted.recover({jobId:job.id,evidence:'Test stopped the owned fixture runtime and confirmed exit.'});
  assert.equal(restarted.job(job.id).recoveryRequired,false);assert.equal(restarted.runs.size,0);
});
test('interrupt and Stop pause task instead of starting idle-time work',async t=>{
  const {relay,task}=await setup(t);await relay.hook({cwd:task.cwd,session_id:task.sessionId,hook_event_name:'Interrupt'});assert.equal(task.state,'paused');
  relay.setState(task.id,'active');await relay.hook({cwd:task.cwd,session_id:task.sessionId,hook_event_name:'Stop'});assert.equal(task.state,'paused');assert.equal(relay.jobs.length,0);
});
test('checkpoint credentials are rejected and diagnostics redacted',()=>{
  const value='sk-'+'a'.repeat(24);assert.throws(()=>rejectSecrets({note:value}),/credentials/);assert.equal(redact(value),'[REDACTED]');
  assert.throws(()=>validateCheckpoint({...checkpoint,acceptance:[]}),/acceptance/);
});
test('HTTP authentication, origin protection, persistent SSE replay and independent status',async t=>{
  const {relay,task}=await setup(t);const server=await startServer(relay);t.after(()=>server.close());
  assert.equal((await fetch(server.url+'/health')).status,401);
  const headers={Authorization:`Bearer ${relay.token}`,'Content-Type':'application/json'};
  assert.equal((await fetch(server.url+'/api/status',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:'{}'})).status,400);
  const job=await relay.handoff({taskId:task.id,instruction:'Continue'});await settle(relay,job.id);
  const r=await fetch(server.url+'/api/status',{method:'POST',headers,body:JSON.stringify({jobId:job.id})});assert.equal((await r.json() as any).job.reportedComplete,true);
  const abort=new AbortController();const events=await fetch(server.url+`/events?job=${job.id}&after=1`,{headers,signal:abort.signal});
  const reader=events.body!.getReader();const value=await reader.read();const text=new TextDecoder().decode(value.value);assert.match(text,/id: 2/);assert.doesNotMatch(text,/id: 1\n/);abort.abort();
  assert.match((await fetch(server.url)).headers.get('Content-Security-Policy')!,/script-src 'self'/);
});
test('MCP server exposes tools with valid schemas',async t=>{
  const rpc=new JsonRpc({command:process.execPath,args:[fileURLToPath(new URL('../src/cli.ts',import.meta.url)),'mcp']});t.after(()=>rpc.close());
  const init=await rpc.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}});assert.equal(init.serverInfo.name,'codex-agent-relay');
  const tools=await rpc.request('tools/list');assert.ok(tools.tools.some((x:any)=>x.name==='relay_handoff'));assert.ok(tools.tools.some((x:any)=>x.name==='relay_setup'));assert.equal(tools.tools.length,8);
});

test('idle before turn/end completes without timing out',async t=>{const {relay,task}=await setup(t,'idle-first');const job=await relay.handoff({taskId:task.id,instruction:'Continue'});await settle(relay,job.id);assert.equal(job.state,'ended')});

for(const change of ['checkpoint','empty-remaining','instruction','launch'] as const)test(`preflight rejects ${change} changes after the payload scan`,async t=>{
  const {relay,task,home,project,dir,count}=await setup(t);
  const user=readJSON<any>(join(home,'user.json'));
  const signal=join(dir,'scan-ready'),release=join(dir,'scan-release'),capture=join(dir,'scanned.json');
  user.scanner.env={RELAY_SCAN_SIGNAL:signal,RELAY_SCAN_RELEASE:release,RELAY_SCAN_CAPTURE:capture};
  atomicJSON(join(home,'user.json'),user);saveProject(project,baseConfig,home);
  const input={taskId:task.id,instruction:'Original instruction'};
  const pending=relay.handoff(input).then(job=>({job,error:undefined}),error=>({job:undefined,error}));
  try{
    for(let i=0;i<500&&!existsSync(signal);i++)await new Promise(r=>setTimeout(r,10));
    assert.ok(existsSync(signal),'scanner reached the directory phase');
    if(change==='checkpoint')relay.checkpoint({taskId:task.id,checkpoint:{...checkpoint,decisions:['unscanned replacement']}});
    if(change==='empty-remaining')relay.checkpoint({taskId:task.id,checkpoint:{...checkpoint,remaining:[]}});
    if(change==='instruction')input.instruction='unscanned replacement';
    if(change==='launch'){
      user.agents['deepseek-harness'].runTimeoutMs=5000;atomicJSON(join(home,'user.json'),user);saveProject(project,baseConfig,home);
    }
  }finally{writeFileSync(release,'continue')}
  const result=await pending;assert.match(result.error?.message||'',/changed during secret scan/);
  assert.equal(relay.jobs.length,0);assert.equal(task.jobId,undefined);assert.equal(existsSync(count),false);
  assert.ok(!readFileSync(capture,'utf8').includes('unscanned replacement'));
});
