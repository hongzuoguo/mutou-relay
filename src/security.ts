import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Config, fail, hash, inside, noLinks, redact } from './core.js';

const excludedDirs=new Set(['.git','.svn','.hg','node_modules','vendor','.venv','venv','__pycache__','.cache','cache','caches','dist','build','coverage','.next','.nuxt','.ssh','.aws','.azure','.config','.codex','.agents','appdata','browser','profiles','sessions']);
export function allowed(rel: string) {
  const parts=rel.replaceAll('\\','/').toLowerCase().split('/');
  if(parts.some(p=>excludedDirs.has(p))) return false;
  const name=parts.at(-1)!;
  if(name==='.env' || (name.startsWith('.env.')&&!['.env.example','.env.sample','.env.template'].includes(name))) return false;
  if(/(?:^id_(?:rsa|ed25519|ecdsa)|\.(?:pem|key|pfx|p12|kdbx|keystore|sqlite|db|exe|dll|vmdk|zip|rar|7z|mp4|mov|png|jpg|pdf)$|^(?:credentials|secrets?|auth|cookies|login data)(?:\.|$))/i.test(name)) return false;
  return true;
}
export function relative(input: string, empty=false) {
  if((!input&&!empty)||input.length>512||/[\x00-\x1f:*?"<>|~]/.test(input)||/^[\\/]/.test(input)) fail('WORKSPACE_UNSAFE','不支持的相对路径');
  const parts=input.replaceAll('\\','/').split('/');
  if(parts.some(p=>p==='..'||p==='.'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)||(!p && input!==''))) fail('WORKSPACE_UNSAFE','路径包含别名或越界分量');
  return parts.join('/');
}
export function workspaceRoot(input: string, evidenceRoot: string) {
  if(!path.isAbsolute(input)||/^(\\\\|\\\?\\)/.test(input)||input.slice(path.parse(input).root.length).includes(':')) fail('WORKSPACE_UNSAFE','需要本地绝对项目目录');
  const candidate=path.resolve(input); noLinks(candidate); const root=fs.realpathSync.native(candidate);
  const banned=[path.parse(root).root,os.homedir(),process.env.SystemRoot,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.APPDATA,process.env.LOCALAPPDATA].filter((x):x is string=>!!x);
  if(banned.some(x=>root.toLowerCase()===path.resolve(x).toLowerCase()) || (process.env.SystemRoot && inside(process.env.SystemRoot,root))) fail('WORKSPACE_UNSAFE','项目范围过宽或位于系统目录');
  if(inside(root,evidenceRoot)||inside(evidenceRoot,root)) fail('WORKSPACE_UNSAFE','项目与私有证据目录必须分离');
  if(!fs.statSync(root).isDirectory()) fail('WORKSPACE_UNSAFE','项目必须是目录');
  return root;
}
export class Files {
  constructor(public root: string, public config: Config) {}
  resolve(input: string, directory=false) {
    const rel=relative(input,directory); if(!allowed(rel)) fail('FILE_EXCLUDED','文件被安全排除');
    const target=path.resolve(this.root,rel); if(!inside(this.root,target)) fail('WORKSPACE_UNSAFE','路径越界'); noLinks(target);
    const real=fs.realpathSync.native(target); if(!inside(this.root,real)) fail('WORKSPACE_UNSAFE','真实路径越界'); return real;
  }
  read(input: string) {
    const filename=this.resolve(input); const before=fs.lstatSync(filename);
    if(!before.isFile()||before.nlink!==1) fail('WORKSPACE_UNSAFE','只允许普通单链接文件');
    if(before.size>this.config.limits.max_file_bytes) fail('FILE_TOO_LARGE','文件超过 max_file_bytes；请显式缩小文件或调整本地限制');
    const fd=fs.openSync(filename,'r');
    try {
      const opened=fs.fstatSync(fd); if(opened.ino!==before.ino||opened.dev!==before.dev||opened.nlink!==1) fail('EVIDENCE_STALE','打开文件期间发生替换');
      const buffer=Buffer.alloc(this.config.limits.max_file_bytes+1); const size=fs.readSync(fd,buffer,0,buffer.length,0);
      const after=fs.fstatSync(fd); const post=fs.lstatSync(filename); noLinks(filename);
      if(size>this.config.limits.max_file_bytes) fail('FILE_TOO_LARGE','读取期间文件增长超过限制');
      if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs||post.ino!==opened.ino||post.nlink!==1||fs.realpathSync.native(filename)!==filename) fail('EVIDENCE_STALE','读取期间文件变化，保留现场');
      const bytes=buffer.subarray(0,size); if(bytes.includes(0)) fail('ENCODING_UNSUPPORTED','二进制或不支持的编码');
      let raw:string; try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{fail('ENCODING_UNSUPPORTED','仅支持可验证 UTF-8/BOM，不静默替换字符');}
      const result=redact(raw); return {...result,hash:hash(bytes),bytes:size};
    } finally { fs.closeSync(fd); }
  }
  inventory(scope='',depth=this.config.limits.max_tree_depth) {
    const start=this.resolve(scope,true); if(!fs.statSync(start).isDirectory()) fail('WORKSPACE_UNSAFE','范围必须是目录');
    const files:string[]=[]; const omitted:string[]=[]; let truncated=false; let entries=0; const deadline=Date.now()+this.config.limits.tool_timeout_seconds*1000;
    const walk=(dir:string,level:number)=>{
      if(Date.now()>deadline) fail('TOOL_TIMEOUT','目录扫描超时；请缩小范围');
      noLinks(dir); const handle=fs.opendirSync(dir);
      try { for(let entry=handle.readSync();entry;entry=handle.readSync()) {
        if(++entries>this.config.limits.max_files*4||files.length>=this.config.limits.max_files) {truncated=true;break;}
        const full=path.join(dir,entry.name); const rel=path.relative(this.root,full).replaceAll('\\','/');
        if(!allowed(rel)||entry.isSymbolicLink()) {if(omitted.length<100) omitted.push(rel);continue;}
        try{relative(rel);}catch{if(omitted.length<100)omitted.push('[unsupported path]');continue;}
        if(entry.isDirectory()){ if(level<depth) walk(full,level+1);else {truncated=true;if(omitted.length<100)omitted.push(rel+'/');} }
        else if(entry.isFile()) files.push(rel);
      }}finally{handle.closeSync();}
    }; walk(start,0); return {files:files.sort(),omitted,truncated,coverage:'排除目录、链接、非文本及超限文件不在内容覆盖内'};
  }
}
