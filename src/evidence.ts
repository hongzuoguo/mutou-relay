import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Config, RelayError, atomic, fail, hash, now, redact } from './core.js';
import { Files, allowed, relative } from './security.js';

export interface Snapshot { id:string; observed_at:string; files:Record<string,{hash:string;text:string;redacted:boolean}>; omitted:string[]; truncated:boolean; }
export function snapshot(files:Files): Snapshot {
  const list=files.inventory(); const found:Snapshot['files']={}; let total=0; let truncated=list.truncated; const omitted=[...list.omitted];
  for(const p of list.files) {
    try { const r=files.read(p); total+=r.bytes; if(total>files.config.limits.max_snapshot_bytes){truncated=true;break;} found[p]={hash:r.hash,text:r.text,redacted:r.redacted}; }
    catch(e){if(e instanceof RelayError && ['FILE_TOO_LARGE','FILE_EXCLUDED','ENCODING_UNSUPPORTED','WORKSPACE_UNSAFE'].includes(e.code)){if(omitted.length<100)omitted.push(p);continue;}throw e;}
  }
  const fingerprint=hash(JSON.stringify(Object.entries(found).map(([p,v])=>[p,v.hash]))+JSON.stringify(omitted)+String(truncated));
  return {id:fingerprint,observed_at:now(),files:found,omitted,truncated};
}
export function safeEnv() {
  const out:NodeJS.ProcessEnv={};
  for(const k of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','LOCALAPPDATA','USERPROFILE','APPDATA','COMSPEC','NUMBER_OF_PROCESSORS']) if(process.env[k])out[k]=process.env[k];
  return out;
}
export function git(root:string, args:string[]) {
  const r=spawnSync('git',['--no-pager','--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath=NUL','-c','diff.external=','-c','core.pager=cat',...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:2*1024*1024,env:{...safeEnv(),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_LITERAL_PATHSPECS:'1',GIT_OPTIONAL_LOCKS:'0'}});
  if(r.error) fail('GIT_READ_FAILED','Git 读取失败或超时');
  return {code:r.status,text:r.stdout,stderr:r.stderr};
}
export function gitInfo(root:string) {
  if(!fs.existsSync(path.join(root,'.git'))) return {available:false,head:null,branch:null,status:null};
  const head=git(root,['rev-parse','--verify','HEAD']); const branch=git(root,['symbolic-ref','--short','HEAD']);
  const state=git(root,['status','--porcelain=v1','-z','--untracked-files=normal']);
  const safeStatus:string[]=[];const entries=state.text.split('\0');for(let i=0;i<entries.length;i++){const entry=entries[i]!;if(entry.length<4)continue;const rel=entry.slice(3);if(entry.slice(0,2).includes('R')||entry.slice(0,2).includes('C'))i++;try{if(allowed(relative(rel)))safeStatus.push(entry);}catch{}}
  return {available:true,head:head.code===0?head.text.trim():null,branch:branch.code===0?branch.text.trim():null,status:redact(safeStatus.join('\n')).text};
}
export function taskChanges(base:Snapshot,current:Snapshot) {
  const result:{path:string;kind:string;before:string|null;after:string|null}[]=[];
  for(const p of [...new Set([...Object.keys(base.files),...Object.keys(current.files)])].sort()) {
    const b=base.files[p],a=current.files[p]; if(b?.hash===a?.hash)continue;
    result.push({path:p,kind:!b?'added':!a?'deleted':'modified',before:b?.text??null,after:a?.text??null});
  }
  return result;
}
export function gitChanges(files:Files,kind:'working'|'staged',p:string) {
  relative(p); if(!allowed(p))fail('FILE_EXCLUDED','路径被安全排除');
  // Require a readable current file, or a safe parent for deletion. Never expose an excluded historical blob.
  if(fs.existsSync(path.join(files.root,p)))files.read(p);else files.resolve(path.posix.dirname(p)==='.'?'':path.posix.dirname(p),true);
  if(!gitInfo(files.root).available)fail('GIT_UNAVAILABLE','非 Git 项目只能比较 task 快照');
  const r=git(files.root,['diff','--no-ext-diff','--no-textconv','--no-color','--no-renames','--unified=3',...(kind==='staged'?['--cached']:[]),'--',p]);
  if(r.code!==0)fail('GIT_READ_FAILED','Git diff 未成功');
  return redact(r.text);
}
export function saveSnapshot(dir:string,s:Snapshot) { const dest=path.join(dir,'snapshots',s.id+'.json'); if(!fs.existsSync(dest))atomic(dest,s); }
