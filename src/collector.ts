import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { atomic, fail, hash, id, now, redact, sanitize } from './core.js';
import { Store } from './store.js';
import { Files, relative } from './security.js';
import { safeEnv } from './evidence.js';
export const projectDir=fileURLToPath(new URL('../../',import.meta.url));
export const repoRoot=path.basename(projectDir)==='dist'?path.dirname(projectDir):projectDir;
export interface ProcessResult {exit_code:number|null;stdout:string;stderr:string;truncated:boolean;timed_out:boolean;cancelled?:boolean;}
export async function ownedProcess(spec:{executable:string;arguments:string[];cwd:string;credential_file?:string},specPath:string,timeoutMs:number,outputLimit:number,onSpawn?:(pid:number)=>void,isCancelled?:()=>boolean):Promise<ProcessResult> {
  atomic(specPath,{schema_version:1,...spec});
  const exe=process.platform==='win32'?'pwsh':spec.executable;
  const args=process.platform==='win32'?['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(repoRoot,'scripts/run-owned.ps1'),'-SpecPath',specPath]:spec.arguments;
  return await new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{cwd:spec.cwd,env:safeEnv(),windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='',truncated=false,timedOut=false;
    child.on('spawn',()=>onSpawn?.(child.pid!));
    let cancelled=false;const cancelTimer=isCancelled?setInterval(()=>{if(isCancelled()){cancelled=true;child.kill('SIGKILL');}},250):undefined;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);timer.unref();
    child.stdout.on('data',(b:Buffer)=>{const s=b.toString();if(out.length+s.length>outputLimit)truncated=true;out=(out+s).slice(0,outputLimit);});
    child.stderr.on('data',(b:Buffer)=>{const s=b.toString();if(err.length+s.length>outputLimit)truncated=true;err=(err+s).slice(0,outputLimit);});
    child.on('error',e=>{clearTimeout(timer);clearInterval(cancelTimer);reject(e);});child.on('close',code=>{clearTimeout(timer);clearInterval(cancelTimer);resolve({exit_code:code,stdout:redact(out).text,stderr:redact(err).text,truncated,timed_out:timedOut,cancelled});});
  });
}
export const CheckInput=z.object({executable:z.string().min(1),arguments:z.array(z.string()).max(100),cwd:z.string().default(''),acceptance_ids:z.array(z.string()).min(1),timeout_seconds:z.number().int().min(1).max(3600).default(120),kind:z.enum(['tests','build','lint','custom']).default('tests')}).strict();
export async function collect(store:Store,input:unknown) {
  const spec=CheckInput.parse(input);if(redact(JSON.stringify(spec)).redacted)fail('COMMAND_SECRET_REFUSED','命令参数疑似含秘密；不要把密钥传入命令行');const task=store.task();if(!['EXECUTING','VERIFYING'].includes(task.state)||task.mode!=='build')fail('MODE_READ_ONLY','当前模式或状态不能执行检查');
  if(spec.acceptance_ids.some(a=>!task.acceptance_ids.includes(a)))fail('ACCEPTANCE_MISMATCH','检查含未授权验收 ID');
  relative(spec.cwd,true);const cwd=new Files(store.binding().root,store.config).resolve(spec.cwd,true);
  if(/\.(cmd|bat)$/i.test(spec.executable))fail('COMMAND_UNSUPPORTED','使用真实 executable 或显式 pwsh 参数数组，不隐式通过 cmd 执行');
  const before=store.currentSnapshot(task);const checkId=id();const started=now();const dir=path.join(store.taskDir(task.task_id),'checks');
  const pending={schema_version:1,check_id:checkId,check_key:hash(JSON.stringify([spec.executable,spec.arguments,spec.cwd,spec.kind,[...spec.acceptance_ids].sort()])),task_id:task.task_id,attempt_id:task.attempt_id,plan_hash:task.plan_hash,executable:spec.executable,arguments:spec.arguments,cwd:spec.cwd,acceptance_ids:spec.acceptance_ids,kind:spec.kind,source:'collector',started_at:started,ended_at:null,exit_code:null,status:'not_run',before_snapshot:before.id,after_snapshot:null,stdout:'',stderr:'',truncated:false,test_count:null};
  // Never persist raw command arguments that look like credentials.
  const safePending=sanitize(pending);atomic(path.join(dir,checkId+'.json'),safePending);
  let result:ProcessResult;
  const specFile=path.join(store.taskDir(task.task_id),'process-'+checkId+'.json');
  try{result=await ownedProcess({executable:spec.executable,arguments:spec.arguments,cwd},specFile,spec.timeout_seconds*1000,Math.floor(store.config.limits.max_response_chars/4),undefined,()=>store.task().state==='CANCELLED');}
  catch{result={exit_code:null,stdout:'',stderr:'无法创建检查进程',truncated:false,timed_out:false};}
  finally{if(fs.existsSync(specFile))fs.unlinkSync(specFile);}
  const after=store.currentSnapshot(task);const node=result.stdout.match(/(?:#|ℹ)\s+tests\s+(\d+)/);const python=result.stderr.match(/Ran (\d+) tests?/);const pytest=result.stdout.match(/(?:^|\s)(\d+) passed(?:,|\s|$)/);const count=node?.[1]??python?.[1]??pytest?.[1];
  const record={...safePending,...result,ended_at:now(),status:result.cancelled?'skipped':result.timed_out?'timeout':result.exit_code===0?'passed':result.exit_code===null?'not_run':'failed',after_snapshot:after.id,test_count:count===undefined?null:Number(count),freshness:before.id===after.id?'CURRENT':'STALE',coverage:count===undefined?'测试数量未知；不得据此宣称功能覆盖':Number(count)===0?'零测试；不能作为功能验收通过':'实际采集测试数量'};
  atomic(path.join(dir,checkId+'.json'),record);
  store.withLock(()=>{const latest=store.task();if(latest.task_id!==task.task_id||latest.attempt_id!==task.attempt_id)fail('WORKSPACE_MISMATCH','检查期间任务改变，保留证据');if(latest.state==='CANCELLED')return;latest.state=before.id===after.id?'VERIFYING':'NEEDS_USER';if(before.id!==after.id)latest.blockers.push('EVIDENCE_STALE');store.save(latest,'check_collected');});return record;
}
