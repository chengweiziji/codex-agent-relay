import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, JsonRpc } from '../src/rpc.ts';
import { findProject, saveProject, atomicJSON, readJSON, projectFingerprint } from '../src/config.ts';
import { persistedState, scanSecrets } from '../src/privacy.ts';
import { DshAdapter } from '../src/adapters/dsh.ts';
import { windowsWorkspaceAcl } from '../src/acl.ts';
import { Relay } from '../src/relay.ts';
import { QuotaReader } from '../src/quota.ts';
import { saveSetup } from '../src/setup.ts';
import { action } from '../src/server.ts';
import type { Checkpoint, ProjectConfig, Job, Task } from '../src/types.ts';

const config:ProjectConfig={version:1,enabled:true,agent:'deepseek-harness',provider:'chosen',model:'chosen',thresholdPercent:5,quotaBucket:'codex'};
const cp:Checkpoint={goal:'Small task',completed:['private work details'],remaining:['private remaining instructions'],decisions:[],files:[],tests:[],processes:[],permissions:'text is not enforcement',acceptance:['test']};
function fixture(t:any){const root=mkdtempSync(join(tmpdir(),'relay-security-'));const home=join(root,'home'),project=join(root,'project');mkdirSync(project);t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,home,project}}
test('receiver environment excludes unrelated secrets and injection variables',()=>{
  process.env.RELAY_UNRELATED_SECRET='must-not-inherit';process.env.RELAY_SELECTED_KEY='chosen';
  try{const env=childEnv({command:'node',args:[],envFrom:{DEEPSEEK_API_KEY:'RELAY_SELECTED_KEY'}});assert.equal(env.RELAY_UNRELATED_SECRET,undefined);assert.equal(env.RELAY_SELECTED_KEY,undefined);assert.equal(env.DEEPSEEK_API_KEY,'chosen');assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.HOME,undefined);assert.equal(env.USERPROFILE,undefined);assert.throws(()=>childEnv({command:'node',args:[],env:{NODE_OPTIONS:'--inspect'}}),/Unsafe/)}
  finally{delete process.env.RELAY_UNRELATED_SECRET;delete process.env.RELAY_SELECTED_KEY}
});
test('repo and parent configuration never grant trust; user launch edits revoke approval',t=>{
  const {home,project}=fixture(t);atomicJSON(join(project,'.agent-relay.json'),config);assert.equal(findProject(project,home),null);
  saveProject(project,config,home);assert.equal(findProject(project,home)?.config.model,'chosen');
  const child=join(project,'nested');mkdirSync(child);assert.equal(findProject(child,home),null);
  atomicJSON(join(project,'.agent-relay.json'),{...config,model:'attacker'});assert.equal(findProject(project,home)?.config.model,'chosen');
  atomicJSON(join(home,'user.json'),{agents:{'deepseek-harness':{command:'different',args:[]}}});assert.equal(findProject(project,home),null);
  saveProject(project,{...config,model:'approved-new'},home);assert.equal(findProject(project,home)?.config.model,'approved-new');
  assert.equal(Object.keys(readJSON<any>(join(home,'trusted-projects.json')))[0],projectFingerprint(project));
});
test('setup and config mutation require explicit confirmation',async t=>{
  const {home,project}=fixture(t);assert.throws(()=>saveSetup(home,{project}),/confirm/);
  const relay=new Relay(home);t.after(()=>relay.close());await assert.rejects(action(relay,'config',{project,config}),/confirmation/);
});
test('built-in adapter accepts only the workspace-write receiver mode',()=>{
  const launch={command:process.execPath,args:['unused','--profile','sdk']};
  assert.doesNotThrow(()=>new DshAdapter().validate(config,launch));
  assert.throws(()=>new DshAdapter().validate(config,{...launch,env:{DSH_PERMISSION_MODE:'danger-full-access'}}),/DSH_PERMISSION_MODE/);
});
test('windows ACL preflight accepts a private workspace and is read-only',{skip:process.platform!=='win32'},t=>{
  const {project}=fixture(t);
  assert.equal(windowsWorkspaceAcl(project).ok,true);
  assert.doesNotThrow(()=>new DshAdapter().preflight(project));
});
test('persisted state omits full instructions and checkpoints, redacts nested evidence',()=>{
  const task={id:'t',checkpoint:cp} as Task;
  const job={checkpoint:cp,instruction:'full private instruction',result:'api_key=example-private-value',verification:{status:'evidence_recorded',evidence:['password=private-value']}} as Job;
  const serialized=JSON.stringify(persistedState([task],[job]));
  for(const raw of ['full private instruction','private work details','private remaining instructions','example-private-value','password=private-value'])assert.ok(!serialized.includes(raw));
  assert.match(serialized,/instructionHash/);assert.match(serialized,/REDACTED/);
});
test('manual evidence cannot claim verification passed, including legacy passed input',async t=>{
  const {home}=fixture(t);const relay=new Relay(home);t.after(()=>relay.close());
  const job={id:'b'.repeat(36),state:'ended',checkpoint:cp,instruction:'x',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} as Job;relay.jobs.push(job);
  relay.verify({jobId:job.id,passed:true,evidence:['Someone says passed']});assert.equal(job.verification?.status,'evidence_recorded');assert.equal((job.verification as any).passed,undefined);
});
test('retention removes expired content but keeps unresolved ownership fence',async t=>{
  const {home,project}=fixture(t);const relay=new Relay(home);t.after(()=>relay.close());
  const job={id:'b'.repeat(36),cwd:project,state:'failed',recoveryRequired:true,checkpoint:cp,instruction:'old private content',result:'old result',updatedAt:new Date(0).toISOString()} as Job;relay.jobs.push(job);
  const event=join(home,'events',job.id+'.jsonl');writeFileSync(event,'private old log');relay.save();assert.equal(existsSync(event),false);assert.equal(job.result,undefined);assert.equal(job.recoveryRequired,true);assert.equal(relay.jobs.length,1);
});
test('restart requires a new checkpoint; stored summaries cannot resume execution',async t=>{
  const {home,project}=fixture(t);saveProject(project,config,home);
  atomicJSON(join(home,'state.json'),{tasks:[{id:'t',sessionId:'s',cwd:project,project,state:'active',mode:'default',checkpoint:cp,updatedAt:new Date().toISOString(),inFlight:[]}],jobs:[]});
  const relay=new Relay(home);t.after(()=>relay.close());relay.setState('t','active');await assert.rejects(relay.handoff({taskId:'t',instruction:'continue'}),/fresh checkpoint/);
  assert.ok(!readFileSync(join(home,'state.json'),'utf8').includes('private remaining instructions'));
});
test('scanner missing or findings blocks dispatch without exposing findings',async t=>{
  const {project}=fixture(t);await assert.rejects(scanSecrets(project,{}, {command:join(project,'missing'),args:[]}),/unavailable/);
  await assert.rejects(scanSecrets(project,{}, {command:process.execPath,args:[fileURLToPath(new URL('./fixtures/scanner.mjs',import.meta.url))],env:{RELAY_TEST_SCAN_FAIL:'1'}}),/sensitive content/);
});
test('stop terminates a receiver and its ordinary child process',async t=>{
  const {project}=fixture(t);const pidFile=join(project,'child.pid');
  const rpc=new JsonRpc({command:process.execPath,args:[fileURLToPath(new URL('./fixtures/process-tree.mjs',import.meta.url))],env:{RELAY_CHILD_PID:pidFile}});t.after(()=>rpc.close());
  for(let i=0;i<200&&!existsSync(pidFile);i++)await new Promise(r=>setTimeout(r,20));
  const pid=Number(readFileSync(pidFile,'utf8'));await rpc.close();
  let alive=true;for(let i=0;i<100;i++){try{process.kill(pid,0)}catch{alive=false;break}await new Promise(r=>setTimeout(r,20))}
  assert.equal(alive,false,'owned descendant survived stop');
});

for(const stalledQuota of [false,true])test(`retention timer expires data with ${stalledQuota?'stalled quota':'no active task'}`,async t=>{
  const {home,project}=fixture(t);
  class StalledQuota extends QuotaReader{override async refresh():Promise<any>{return new Promise(()=>{})}override async close(){}}
  const relay=new Relay(home,new StalledQuota());t.after(()=>relay.close());
  const job={id:'c'.repeat(36),cwd:project,state:'ended',checkpoint:cp,instruction:'old',updatedAt:new Date(0).toISOString()} as Job;
  relay.jobs.push(job);const event=join(home,'events',job.id+'.jsonl');writeFileSync(event,'expired log');
  if(stalledQuota)relay.tasks.push({id:'active',state:'active',mode:'default',checkpoint:cp,updatedAt:new Date().toISOString()} as Task);
  t.mock.timers.enable({apis:['setInterval']});relay.startMonitor();t.mock.timers.tick(30000);
  assert.equal(existsSync(event),false);assert.equal(relay.jobs.length,0);
  assert.equal(readJSON<any>(join(home,'state.json')).jobs.length,0);
});

test('Windows ACL denies TakeOwnership and preserves the descriptor', {skip:process.platform!=='win32'}, t=>{
 const {project}=fixture(t);
 const ps=(script:string)=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,RELAY_ACL_TEST:project},encoding:'utf8',windowsHide:true});
 const original=ps("[System.IO.Directory]::GetAccessControl($env:RELAY_ACL_TEST).GetSecurityDescriptorSddlForm('Access')").trim();
 try{
 ps(`$p=$env:RELAY_ACL_TEST; $a=[System.IO.Directory]::GetAccessControl($p); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $r=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,'TakeOwnership','Deny'); $a.AddAccessRule($r); [System.IO.Directory]::SetAccessControl($p,$a)`);
 const before=ps("[System.IO.Directory]::GetAccessControl($env:RELAY_ACL_TEST).GetSecurityDescriptorSddlForm('Access')").trim();
 assert.equal(windowsWorkspaceAcl(project).ok,false);
 assert.equal(ps("[System.IO.Directory]::GetAccessControl($env:RELAY_ACL_TEST).GetSecurityDescriptorSddlForm('Access')").trim(),before);
 }finally{ps(`$a=[System.IO.Directory]::GetAccessControl($env:RELAY_ACL_TEST); $a.SetSecurityDescriptorSddlForm('${original}',[System.Security.AccessControl.AccessControlSections]::Access); [System.IO.Directory]::SetAccessControl($env:RELAY_ACL_TEST,$a)`)}
});
