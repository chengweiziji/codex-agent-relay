import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJSON, atomicJSON, findProject } from '../src/config.ts';
import { harnessEntry, saveSetup, setupInfo } from '../src/setup.ts';
import { Relay } from '../src/relay.ts';

function fixture(t:any){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'relay-setup-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const home=join(root,'state'),project=join(root,'project'),harness=join(root,'harness');
  mkdirSync(project);mkdirSync(join(harness,'node_modules','@deepseek-ai','dsh','lib'),{recursive:true});
  const entry=join(harness,'node_modules','@deepseek-ai','dsh','lib','bin.js');writeFileSync(entry,'throw Error("Setup must never execute this file");');
  const input={confirmed:true,project,agent:'deepseek-harness',harnessPath:harness,provider:'my-provider',model:'my-chosen-model',credentialEnv:'RELAY_TEST_CREDENTIAL_NOT_SET',thresholdPercent:5};
  return {root,home,project,harness,entry,input};
}
test('first-time setup separates machine configuration and makes an unregistered project editable',async t=>{
  const {home,project,entry,input}=fixture(t);const result=saveSetup(home,input);
  assert.equal(result.credentialAvailable,false);assert.equal(harnessEntry(input.harnessPath),entry);
  const config=findProject(project,home)!.config;
  assert.equal(config.model,'my-chosen-model');assert.equal(config.provider,'my-provider');assert.equal('harnessPath' in config,false);
  const user=readJSON<any>(join(home,'user.json'));assert.equal(user.agents['deepseek-harness'].args[0],entry);
  assert.deepEqual(user.agents['deepseek-harness'].envFrom,{DEEPSEEK_API_KEY:'RELAY_TEST_CREDENTIAL_NOT_SET'});
  const relay=new Relay(home);t.after(()=>relay.close());assert.equal(relay.tasks.length,0);assert.equal(relay.jobs.length,0);
  assert.equal(relay.snapshot().projects[0],project);relay.config(project,{...config,model:'second-user-choice'});
  assert.equal(findProject(project,home)!.config.model,'second-user-choice');
});
test('setup rejects missing models, invalid paths, raw keys and unimplemented agents',t=>{
  const {home,input}=fixture(t);
  assert.throws(()=>saveSetup(home,{...input,model:''}),/model/);
  assert.throws(()=>saveSetup(home,{...input,harnessPath:join(input.project,'missing')}),/not found/);
  assert.throws(()=>saveSetup(home,{...input,credentialEnv:'sk-'+'a'.repeat(24)}),/credentials/);
  assert.throws(()=>saveSetup(home,{...input,agent:'qoder-cn'}),/adapter/);
});
test('setup preserves existing Harness launch preferences and keeps projects isolated',t=>{
  const {root,home,project,input}=fixture(t);
  atomicJSON(join(home,'user.json'),{agents:{'deepseek-harness':{command:'node',args:[],env:{DSH_HOME:join(root,'existing-home')},runTimeoutMs:45000},custom:{command:'custom',args:[]}}});
  saveSetup(home,{...input,credentialEnv:''});
  const second=join(root,'second');mkdirSync(second);saveSetup(home,{...input,project:second,model:'another-choice',credentialEnv:''});
  assert.equal(findProject(project,home)!.config.model,'my-chosen-model');
  const user=readJSON<any>(join(home,'user.json'));assert.equal(user.agents.custom.command,'custom');assert.equal(user.agents['deepseek-harness'].runTimeoutMs,45000);
  assert.equal(user.agents['deepseek-harness'].env.DSH_HOME,join(root,'existing-home'));assert.equal(setupInfo(home).credentialEnv,'');
});
