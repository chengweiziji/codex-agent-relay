import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { atomicJSON, saveProject, pathKey } from '../src/config.ts';
import { validateHostTestScope } from '../scripts/host-test-scope.ts';

test('host simulation rejects production home before reading any state',()=>{
  assert.throws(()=>validateHostTestScope(join(homedir(),'.codex-agent-relay')),/Production/);
});
test('host simulation requires marker, one exact project and isolated history', t=>{
  const dir=mkdtempSync(join(tmpdir(),'relay-host-scope-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const home=join(dir,'home'),project=join(dir,'project'),other=join(dir,'other');mkdirSync(project);mkdirSync(other);
  assert.throws(()=>validateHostTestScope(home),/marker/);
  atomicJSON(join(home,'host-test.json'),{purpose:'disposable-host-acceptance',project});
  assert.throws(()=>validateHostTestScope(home),/exactly one/);
  const config={version:1,enabled:true,agent:'fixture',provider:'fixture',model:'fixture',thresholdPercent:5,quotaBucket:'codex'};
  saveProject(project,config,home);
  assert.equal(pathKey(validateHostTestScope(home)),pathKey(project));
  atomicJSON(join(home,'state.json'),{tasks:[{cwd:other}],jobs:[]});
  assert.throws(()=>validateHostTestScope(home),/history/);
  atomicJSON(join(home,'state.json'),{tasks:[],jobs:[]});
  saveProject(other,config,home);
  assert.throws(()=>validateHostTestScope(home),/exactly one/);
});
