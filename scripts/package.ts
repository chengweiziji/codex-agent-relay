import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { releaseFiles } from './files.ts';

const root=resolve('.'),version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const files=releaseFiles(root);const output=join(root,'dist');mkdirSync(output,{recursive:true});
const archiveName=`codex-agent-relay-${version}-source.tar.gz`,archive=join(output,archiveName);
const tar=spawnSync('tar',['-czf',`dist/${archiveName}`,...files.map(f=>f.replaceAll('\\','/'))],{cwd:root,encoding:'utf8',windowsHide:true});
if(tar.status!==0)throw Error(tar.stderr||'tar packaging failed');
writeFileSync(join(output,'SHA256SUMS'),createHash('sha256').update(readFileSync(archive)).digest('hex')+'  '+archive.split(/[\\/]/).at(-1)+'\n');
const manifest=files.map(file=>({file:file.replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(join(root,file))).digest('hex')}));
writeFileSync(join(output,'release-manifest.json'),JSON.stringify({version,files:manifest},null,2)+'\n');
console.log(JSON.stringify({archive,files:files.length,manifest:join(output,'release-manifest.json')},null,2));
