import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Relay } from '../src/relay.ts';
import { QuotaReader } from '../src/quota.ts';
import { saveProject, atomicJSON } from '../src/config.ts';
import { startServer, dashboard } from '../src/server.ts';

const base=resolve('.local');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'demo-'));
const project=join(dir,'project');mkdirSync(project);const home=join(dir,'relay');
saveProject(project,{version:1,enabled:true,agent:'deepseek-harness',provider:'demo-only',model:'SIMULATED-AGENT',thresholdPercent:5,quotaBucket:'codex'});
atomicJSON(join(home,'user.json'),{agents:{'deepseek-harness':{command:process.execPath,args:[fileURLToPath(new URL('../test/fixtures/fake-sdk.mjs',import.meta.url)),'--profile','sdk'],env:{RELAY_TEST_DELAY:'6000'}}}});
class DemoQuota extends QuotaReader { override async refresh(){this.snapshot={at:Date.now(),data:{rateLimitsByLimitId:{codex:{primary:{usedPercent:96}}}}};return this.snapshot}override async close(){} }
const relay=new Relay(home,new DemoQuota());const server=await startServer(relay);
const task=await relay.register({cwd:project,sessionId:'demonstration',checkpoint:{goal:'演示：修复项目测试并完成交接',completed:['检查项目与失败测试'],remaining:['修复问题并执行测试'],decisions:['This is a simulation, no provider inference.'],files:['example.ts'],tests:['示例：一个测试尚未通过'],processes:[],permissions:'Disposable demo only; no real project changes.',acceptance:['演示接收回执与实时结果']}});
console.log(JSON.stringify({demo:true,dashboardUrl:dashboard(relay),directory:dir}));
const job=await relay.handoff({taskId:task.id,instruction:'SIMULATION: show receipt, execution events and a self-reported result.'});
console.log(JSON.stringify({demo:true,jobId:job.id,dashboardUrl:dashboard(relay,job.id)}));
process.on('SIGINT',async()=>{await server.close();process.exit(0)});
