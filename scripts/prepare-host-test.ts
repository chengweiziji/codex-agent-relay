// Prepare an isolated native-host acceptance fixture. No model call or Hook trust.
import { mkdirSync, mkdtempSync, writeFileSync, cpSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { atomicJSON, readJSON, saveProject } from '../src/config.ts';
import { childEnv } from '../src/rpc.ts';
import { validateHostTestScope } from './host-test-scope.ts';
import type { UserConfig } from '../src/types.ts';

const arg = (key: string) => { const i=process.argv.indexOf(key); if(i<0||!process.argv[i+1]) throw Error(`Required ${key}`); return process.argv[i+1]; };
const sourceHome=resolve(arg('--source-home')), template=resolve(arg('--dsh-template'));
const provider=arg('--provider'), model=arg('--model');
const user=readJSON<UserConfig>(join(sourceHome,'user.json'));
const launch=structuredClone(user.agents['deepseek-harness']);
if(!launch || !user.scanner) throw Error('Configured Harness and scanner required');
for(const name of Object.values(launch.envFrom || {})) if(!process.env[name]) throw Error(`Missing credential environment reference: ${name}`);
const root=resolve(import.meta.dirname,'..');
mkdirSync(join(root,'.local'),{recursive:true});
const base=mkdtempSync(join(root,'.local','native-acceptance-'));
const home=join(base,'relay'),plugin=join(base,'plugin'),dsh=join(base,'dsh');
const project=mkdtempSync(join(homedir(),'relay-host-test-'));
writeFileSync(join(project,'sum.cjs'),'module.exports = (a,b) => a - b;\n');
writeFileSync(join(project,'test.cjs'),"const assert=require('node:assert/strict');assert.equal(require('./sum.cjs')(2,3),5);console.log('HOST_TEST_PASSED');\n");
cpSync(join(template,'profiles'),join(dsh,'profiles'),{recursive:true});
launch.env={...launch.env,DSH_HOME:dsh,DSH_PERMISSION_MODE:'workspace-write'};
launch.runTimeoutMs=300_000;
atomicJSON(join(home,'user.json'),{scanner:user.scanner,agents:{'deepseek-harness':launch}});
saveProject(project,{version:1,enabled:true,agent:'deepseek-harness',provider,model,thresholdPercent:5,quotaBucket:'codex'},home);
atomicJSON(join(home,'host-test.json'),{purpose:'disposable-host-acceptance',project});
validateHostTestScope(home);
execFileSync(process.execPath,[join(root,'scripts/install-local.ts'),'--destination',plugin],{stdio:'pipe',windowsHide:true});
const mcp=readJSON<any>(join(plugin,'.mcp.json'));mcp.mcpServers.agent_relay.env={AGENT_RELAY_HOME:home};atomicJSON(join(plugin,'.mcp.json'),mcp);
writeFileSync(join(plugin,'bin/host-hook.mjs'),`process.env.AGENT_RELAY_HOME=${JSON.stringify(home)};process.argv=['node','relay','hook'];await import('../src/cli.ts');\n`);
const hooks=readJSON<any>(join(plugin,'hooks/hooks.json'));
// Resolved executable avoids requiring node on the desktop host PATH.
const command=`"${process.execPath}" "${join(plugin,'bin/host-hook.mjs')}"`;
for(const groups of Object.values(hooks.hooks) as any[]) for(const group of groups) for(const hook of group.hooks){hook.command=command;hook.commandWindows=command;}
atomicJSON(join(plugin,'hooks/hooks.json'),hooks);
const marketplace=`relay-acceptance-${Date.now()}`;
const market=readJSON<any>(join(plugin,'.agents/plugins/marketplace.json'));market.name=marketplace;atomicJSON(join(plugin,'.agents/plugins/marketplace.json'),market);
const fd=openSync(join(home,'service.log'),'a');
const daemon=spawn(process.execPath,[join(plugin,'scripts/host-test-daemon.ts'),'--simulate-quota-for-host-test',home],{detached:true,windowsHide:true,stdio:['ignore',fd,fd],env:childEnv(launch)});
daemon.unref();closeSync(fd);
const info={project,home,plugin,marketplace,pid:daemon.pid,provider,model,quota:'SIMULATED 4%',expiresAfterMinutes:60};
atomicJSON(join(base,'test-info.json'),info);
console.log(JSON.stringify(info,null,2));
