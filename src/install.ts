import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomic, fail, hash, json, noLinks } from './core.js';
import { repoRoot } from './collector.js';
function entries(root:string):string[]{noLinks(root);const output:string[]=[];for(const e of fs.readdirSync(root,{withFileTypes:true})){if(e.isSymbolicLink())fail('SKILL_CONFLICT','技能目录含链接');if(e.isDirectory())output.push(...entries(path.join(root,e.name)).map(p=>e.name+'/'+p));else output.push(e.name);}return output.sort();}
function verifyOwned(target:string){
  noLinks(target);const marker=path.join(target,'.mutou-relay-owned.json');if(!fs.existsSync(marker))fail('SKILL_CONFLICT','同名未知技能已存在；不会覆盖');
  const m=json<{product:string;files:Record<string,string>}>(marker);if(m.product!=='mutou-relay')fail('SKILL_CONFLICT','技能所有权不匹配');
  const actual=entries(target).filter(p=>p!=='.mutou-relay-owned.json');if(JSON.stringify(actual)!==JSON.stringify(Object.keys(m.files).sort()))fail('SKILL_CONFLICT','已安装技能含新增或缺失文件，保留用户修改');
  for(const p of actual)if(hash(fs.readFileSync(path.join(target,p)))!==m.files[p])fail('SKILL_CONFLICT','技能文件被修改，保留现场');
}
export function installSkill(skillsRoot=path.join(os.homedir(),'.agents','skills'),update=false){
  const root=path.resolve(skillsRoot);noLinks(root);fs.mkdirSync(root,{recursive:true});const target=path.join(root,'mutou-relay');
  if(fs.existsSync(target)){if(!update)fail('SKILL_CONFLICT','技能已存在；确认本产品版本后使用 --update');verifyOwned(target);}
  const source=path.join(repoRoot,'skill','mutou-relay');const sourceEntries=entries(source);
  fs.mkdirSync(target,{recursive:true});for(const p of sourceEntries){const dest=path.join(target,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,p),dest);}
  atomic(path.join(target,'runtime.json'),{schema_version:1,product:'mutou-relay',runtime_root:repoRoot});
  // Only remove files that the previous owned manifest verified and this version replaced.
  if(update){const old=json<{files:Record<string,string>}>(path.join(target,'.mutou-relay-owned.json'));for(const p of Object.keys(old.files))if(!sourceEntries.includes(p)&&p!=='runtime.json')fs.unlinkSync(path.join(target,p));}
  const files=Object.fromEntries(entries(target).filter(p=>p!=='.mutou-relay-owned.json').map(p=>[p,hash(fs.readFileSync(path.join(target,p)))]));atomic(path.join(target,'.mutou-relay-owned.json'),{schema_version:1,product:'mutou-relay',files});return {installed:target,host_discovery:'NOT_CHECKED',runtime:repoRoot};
}
export function uninstallSkill(skillsRoot=path.join(os.homedir(),'.agents','skills')){
  const root=path.resolve(skillsRoot);const target=path.join(root,'mutou-relay');noLinks(root);if(path.dirname(target)!==root)fail('WORKSPACE_UNSAFE','技能目标越界');verifyOwned(target);fs.rmSync(target,{recursive:true});return {removed:target,private_data:'PRESERVED',runtime:'PRESERVED'};
}
