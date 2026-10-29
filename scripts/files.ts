import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
export const releaseEntries = ['src','bin','public','skills','hooks','.codex-plugin','.mcp.json','test','scripts','examples','docs','.github','package.json','pnpm-lock.yaml','tsconfig.json','.gitignore','LICENSE','README.md','README.zh-CN.md'];
export function releaseFiles(root:string):string[]{
  const out:string[]=[];
  const walk=(rel:string)=>{const stat=lstatSync(join(root,rel));if(stat.isSymbolicLink())throw Error(`Refuse symlink in release: ${rel}`);if(stat.isDirectory())for(const name of readdirSync(join(root,rel)))walk(join(rel,name));else out.push(rel)};
  for(const name of releaseEntries)walk(name);
  for(const rel of out){
    if(/\.(png|jpg|webp)$/i.test(rel))continue;
    const text=readFileSync(join(root,rel),'utf8');
    if(/sk-[A-Za-z0-9_-]{20,}|[A-Z]:\\Users\\[^\s"\\]+|[A-Z]:\/Users\/[^\s"/]+|#token=[a-f0-9]{32,}/i.test(text))throw Error(`Possible private data in release file: ${rel}`);
  }
  return out;
}
