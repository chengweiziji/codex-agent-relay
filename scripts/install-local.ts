import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJSON, readJSON } from '../src/config.ts';
import { releaseFiles } from './files.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const at=process.argv.indexOf('--destination');if(at<0||!process.argv[at+1])throw Error('Use --destination with a new installation directory');
const destination=resolve(process.argv[at+1]);if(existsSync(destination))throw Error('Destination must not already exist; keep existing installations intact');
const files=releaseFiles(root);mkdirSync(destination,{recursive:true});
for(const rel of files){mkdirSync(dirname(join(destination,rel)),{recursive:true});copyFileSync(join(root,rel),join(destination,rel))}
atomicJSON(join(destination,'.mcp.json'),{mcpServers:{agent_relay:{command:process.execPath,args:[join(destination,'src','cli.ts'),'mcp'],startup_timeout_sec:15,tool_timeout_sec:90}}});
const hooks=readJSON<any>(join(destination,'hooks','hooks.json'));
// Resolve the plugin root inside Node, avoiding shell expansion of paths containing spaces or $.
const launch='node -e "process.argv=[\'node\',\'relay\',\'hook\'];import(require(\'node:url\').pathToFileURL(require(\'node:path\').join(process.env.PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT,\'src\',\'cli.ts\')).href)"';
for(const groups of Object.values(hooks.hooks) as any[])for(const group of groups)for(const h of group.hooks){h.command=launch;h.commandWindows=launch}
atomicJSON(join(destination,'hooks','hooks.json'),hooks);
atomicJSON(join(destination,'.agents','plugins','marketplace.json'),{name:'codex-agent-relay-local',interface:{displayName:'Codex Agent Relay'},plugins:[{name:'codex-agent-relay',source:{source:'local',path:'./'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]});
console.log(JSON.stringify({installedFiles:files.length,destination,next:`codex plugin marketplace add "${destination}"`,note:'Install from the desktop Plugins page, then review/trust hooks. No user/global settings were edited.'},null,2));
