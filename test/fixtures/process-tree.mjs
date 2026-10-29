import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
writeFileSync(process.env.RELAY_CHILD_PID,String(child.pid));
setInterval(()=>{},1000);
