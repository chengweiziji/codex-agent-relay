import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Relay } from '../src/relay.ts';
import { QuotaReader } from '../src/quota.ts';
import { atomicJSON, saveProject } from '../src/config.ts';
import { startServer, dashboard } from '../src/server.ts';

if(!process.env.RELAY_REAL_DSH_BIN || !process.env.DEEPSEEK_API_KEY)throw Error('Set RELAY_REAL_DSH_BIN and DEEPSEEK_API_KEY. This test makes a real, small provider call.');
const base=resolve('.local');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'real-'));
const project=join(dir,'project');mkdirSync(project);const home=join(dir,'relay');
const model=process.env.RELAY_REAL_MODEL||'deepseek-v4-flash';
saveProject(project,{version:1,enabled:true,agent:'deepseek-harness',provider:'deepseek-official',model,thresholdPercent:5,quotaBucket:'codex'});
writeFileSync(join(project,'sum.cjs'),'module.exports = (a, b) => a - b;\n');
writeFileSync(join(project,'test.cjs'),"const assert=require('node:assert/strict'); assert.equal(require('./sum.cjs')(2,3),5); console.log('SUM_TEST_PASSED');\n");
atomicJSON(join(home,'user.json'),{agents:{'deepseek-harness':{command:process.execPath,args:[process.env.RELAY_REAL_DSH_BIN,'--profile','sdk'],env:{DSH_HOME:join(dir,'dsh'),DSH_MAX_TOKENS_AS_SUCCESS:'false'},envFrom:{DEEPSEEK_API_KEY:'DEEPSEEK_API_KEY'},initializeTimeoutMs:60000,receiptTimeoutMs:30000,runTimeoutMs:240000}}});
class SmokeQuota extends QuotaReader { override async refresh(){this.snapshot={at:Date.now(),data:{rateLimitsByLimitId:{codex:{primary:{usedPercent:96}}}}};return this.snapshot}override async close(){} }
const relay=new Relay(home,new SmokeQuota());const server=await startServer(relay);
console.log(JSON.stringify({kind:'real-harness-with-simulated-quota',dashboardUrl:dashboard(relay),directory:dir,model}));
try{
  const task=await relay.register({cwd:project,sessionId:'real-smoke',checkpoint:{goal:'Fix sum.cjs so the existing test passes',completed:['Created a disposable two-file arithmetic fixture'],remaining:['Change subtraction to addition in sum.cjs','Run node test.cjs'],decisions:['Only modify sum.cjs; leave test.cjs unchanged'],files:['sum.cjs','test.cjs'],tests:['Expected sum(2,3) to equal 5; currently it returns -1'],processes:[],permissions:'Read/write only this disposable project. No network, package installation, other files or background jobs. Use existing local tools.',acceptance:['node test.cjs exits 0','test.cjs stays unchanged']}});
  const originalTest=readFileSync(join(project,'test.cjs'),'utf8');
  const job=await relay.handoff({taskId:task.id,instruction:'Fix the one-line addition bug, run node test.cjs, and report evidence. Be concise.'});
  while(relay.runs.has(job.id))await new Promise(r=>setTimeout(r,250));
  const check=spawnSync(process.execPath,['test.cjs'],{cwd:project,encoding:'utf8',windowsHide:true});
  const passed=job.state==='ended'&&check.status===0&&readFileSync(join(project,'test.cjs'),'utf8')===originalTest;
  if(job.state==='ended')relay.verify({jobId:job.id,passed,evidence:[`Independent node test.cjs exit: ${check.status}`,`Test file unchanged: ${readFileSync(join(project,'test.cjs'),'utf8')===originalTest}`]});
  const summary={kind:'real-harness-with-simulated-quota',model,jobId:job.id,state:job.state,receipt:!!job.receipt,reportedComplete:job.reportedComplete,passed,testOutput:check.stdout.trim(),error:job.error||null};
  atomicJSON(join(dir,'verification.json'),summary);console.log(JSON.stringify(summary));
  if(!passed)process.exitCode=1;
}finally{await server.close()}
