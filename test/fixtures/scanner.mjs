// Protocol fixture only; not a secret scanner. Production defaults to gitleaks.
import { writeFileSync, existsSync } from 'node:fs';
if (process.argv.includes('stdin')) {
  let input=''; for await (const chunk of process.stdin) input+=chunk;
  if(process.env.RELAY_SCAN_CAPTURE)writeFileSync(process.env.RELAY_SCAN_CAPTURE,input);
}
if(process.argv.includes('dir')&&process.env.RELAY_SCAN_SIGNAL){
  writeFileSync(process.env.RELAY_SCAN_SIGNAL,'ready');
  const deadline=Date.now()+10000;
  while(!existsSync(process.env.RELAY_SCAN_RELEASE)){
    if(Date.now()>deadline)process.exit(2);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
process.exit(process.env.RELAY_TEST_SCAN_FAIL === '1' ? 23 : 0);
