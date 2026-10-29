import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJSON, readJSON, saveProject } from '../src/config.ts';
import { JsonRpc } from '../src/rpc.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
test('installed MCP and Hooks work in a path with spaces; execution survives MCP exit', {timeout:20_000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'relay installed $ fixture '));
  const destination=join(dir,'plugin copy');const home=join(dir,'state');const project=join(dir,'project');mkdirSync(project);
  let rpc:JsonRpc|undefined;
  t.after(async()=>{
    await rpc?.close();
    const endpoint=readJSON<any>(join(home,'server.json'),null);
    if(endpoint?.pid){
      if(process.platform==='win32') {try{execFileSync('taskkill',['/PID',String(endpoint.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{}}
      else {try{process.kill(endpoint.pid,'SIGTERM')}catch{}}
    }
    for(let i=0;i<30;i++){try{rmSync(dir,{recursive:true,force:true});return}catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,100))}}
  });
  execFileSync(process.execPath,[join(root,'scripts','install-local.ts'),'--destination',destination],{cwd:root,windowsHide:true});
  const config={version:1 as const,enabled:true,agent:'fixture',provider:'fixture',model:'fixture',thresholdPercent:5,quotaBucket:'codex'};
  atomicJSON(join(home,'user.json'),{
    scanner:{command:process.execPath,args:[join(destination,'test','fixtures','scanner.mjs')]},
    adapterModules:{fixture:join(destination,'test','fixtures','adapter.ts')},
    codex:{command:process.execPath,args:[join(destination,'test','fixtures','fake-codex.mjs')]},
    agents:{fixture:{command:process.execPath,args:[join(destination,'test','fixtures','fake-sdk.mjs'),'--profile','sdk'],env:{RELAY_TEST_DELAY:'1200'},runTimeoutMs:5000}},
  });
  saveProject(project,config,home);
  const env={...process.env,AGENT_RELAY_HOME:home,PLUGIN_ROOT:destination};
  // The real hook command resolves PLUGIN_ROOT inside Node, so shell expansion cannot corrupt it.
  const hooks=readJSON<any>(join(destination,'hooks','hooks.json'));
  const hook=hooks.hooks.UserPromptSubmit[0].hooks[0];
  const command=process.platform==='win32'?hook.commandWindows:hook.command;
  const pathKey=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH';
  (env as any)[pathKey]=dirname(process.execPath)+(process.platform==='win32'?';':':')+(env as any)[pathKey];
  const hookRun=spawnSync(command,{shell:true,input:JSON.stringify({cwd:project,session_id:'installed-session',hook_event_name:'UserPromptSubmit'}),env,encoding:'utf8',windowsHide:true});
  assert.equal(hookRun.status,0,hookRun.stderr);assert.match(JSON.parse(hookRun.stdout).hookSpecificOutput.additionalContext,/relay_register/);
  const launch=readJSON<any>(join(destination,'.mcp.json')).mcpServers.agent_relay;
  rpc=new JsonRpc({...launch,env:{AGENT_RELAY_HOME:home}},project);
  await rpc.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'installed-test',version:'1'}});
  const call=async(name:string,input:any)=>{const result=await rpc!.request('tools/call',{name,arguments:input});assert.equal(result.isError,false,result.content[0].text);return JSON.parse(result.content[0].text)};
  const task=await call('relay_register',{cwd:project,sessionId:'installed-session',checkpoint:{goal:'Complete an isolated fixture',completed:[],remaining:['Run the fixture'],decisions:[],files:[],tests:[],processes:[],permissions:'Only this disposable directory.',acceptance:['Fixture completes']}});
  const job=await call('relay_handoff',{taskId:task.id,instruction:'Complete the isolated fixture.'});assert.ok(job.receipt);
  await rpc.close();rpc=undefined;
  // From this point only the local daemon and fixture execute. No MCP client/model is present.
  const endpoint=readJSON<any>(join(home,'server.json'));let final:any;
  for(let i=0;i<80;i++){
    const response=await fetch(endpoint.url+'/api/status',{method:'POST',headers:{Authorization:`Bearer ${endpoint.token}`,'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id})});
    assert.equal(response.status,200);final=await response.json();if(final.job.state==='ended')break;await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(final.job.state,'ended');assert.equal(final.job.reportedComplete,true);assert.match(final.job.result,/Fixture completed/);
  assert.ok(final.events.some((e:any)=>e.kind==='ended'));assert.equal(readJSON<any>(join(home,'state.json')).jobs[0].state,'ended');
});
