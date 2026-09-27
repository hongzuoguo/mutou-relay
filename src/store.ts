import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Config, ModelPolicy, atomic, fail, hash, id, json, loadConfig, now, privateRoot, redact } from './core.js';
import { Files, relative, workspaceRoot } from './security.js';
import { Snapshot, gitInfo, saveSnapshot, snapshot } from './evidence.js';
import { projectPreferences } from './preferences.js';

export const terminal=new Set(['DONE','FAILED','CANCELLED']);
export interface Binding {schema_version:1;workspace_id:string;generation:number;root:string;alias:string;}
export interface Request {session_id:string;workspace_id:string;binding_generation:number;task_id:string;message_id:string;phase:'plan'|'review'|'research';attempt_id:number;plan_id:string|null;plan_hash:string|null;snapshot_id:string;expected_reply_marker:string;conversation_url:string;send_status:'PREPARED'|'SENDING'|'SENT'|'UNKNOWN';created_at:string;model_label:string;reasoning_label:string|null;}
export interface Task {schema_version:1;task_id:string;session_id:string;workspace_id:string;generation:number;mode:'research'|'plan'|'build'|'review';goal:string;scope:string[];acceptance_ids:string[];state:string;attempt_id:number;repair_rounds:number;baseline:string;plan_id:string|null;plan_hash:string|null;plan_executed:boolean;request:Request|null;cap_hash:string|null;cap_expires:string|null;created_at:string;updated_at:string;git:ReturnType<typeof gitInfo>;model_policy:z.infer<typeof ModelPolicy>;locked_model:string|null;locked_reasoning:string|null;review_snapshot:string|null;blockers:string[];}
export interface Exposure {schema_version:1;workspace_id:string;generation:number;task_id:string;config_hash:string;confirmed_at:string;}
export class Store {
  base:string; config:Config;
  constructor(base=privateRoot()) {this.base=fs.realpathSync.native(base);this.config=loadConfig(this.base);}
  file(name:string){return path.join(this.base,name);}
  binding() {const b=json<Binding>(this.file('binding.json')); if(workspaceRoot(b.root,this.base)!==b.root)fail('WORKSPACE_MISMATCH','项目真实路径已改变');return b;}
  task() {const active=json<{task_id:string}>(this.file('active.json')); if(!z.uuid().safeParse(active.task_id).success)fail('STATE_INVALID','任务标识无效'); return json<Task>(path.join(this.taskDir(active.task_id),'task.json'));}
  taskDir(taskId:string) {if(!z.uuid().safeParse(taskId).success)fail('STATE_INVALID','任务 ID 无效');return this.file(path.join('sessions',taskId));}
  withLock<T>(fn:()=>T) {
    const lock=this.file('control.lock');let fd:number;try{fd=fs.openSync(lock,'wx');}catch{fail('INSTANCE_BUSY','另一个本地写操作正在进行；中断后请执行 recover');}
    try{return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  save(t:Task,event:string) {t.updated_at=now();atomic(path.join(this.taskDir(t.task_id),'task.json'),t);fs.appendFileSync(this.file('logs/audit.jsonl'),JSON.stringify({at:now(),task_id:t.task_id,state:t.state,event,attempt_id:t.attempt_id})+'\n');}
  select(input:string) {return this.withLock(()=>{
    if(fs.existsSync(this.file('runtime.lock'))||fs.existsSync(this.file('exposure.json')))fail('INSTANCE_BUSY','先停止旧实例');
    if(fs.existsSync(this.file('active.json'))&&!terminal.has(this.task().state))fail('WORKSPACE_MISMATCH','先完成或取消当前任务');
    const root=workspaceRoot(input,this.base); const prior=fs.existsSync(this.file('binding.json'))?json<Binding>(this.file('binding.json')):null;
    const b:Binding={schema_version:1,workspace_id:id(),generation:(prior?.generation??0)+1,root,alias:path.basename(root)};atomic(this.file('binding.json'),b);return b;
  });}
  create(value:unknown) {return this.withLock(()=>{
    const parsed=z.object({goal:z.string().min(1).max(12000),scope:z.array(z.string()).min(1).max(100),acceptance_ids:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(100),mode:z.enum(['research','plan','build','review']).optional(),model_policy:ModelPolicy.optional()}).strict().parse(value);
    const preferences=projectPreferences(this);const input={...parsed,mode:parsed.mode??preferences.default_mode??this.config.workflow.default_mode,model_policy:parsed.model_policy??preferences.model_policy??this.config.chatgpt.model_policy};
    if(fs.existsSync(this.file('runtime.lock'))||fs.existsSync(this.file('exposure.json')))fail('INSTANCE_BUSY','创建新任务前先停止旧实例');
    if(fs.existsSync(this.file('active.json'))&&!terminal.has(this.task().state))fail('TASK_ACTIVE','已有活动任务');
    if(input.mode==='research')fail('MODE_RESEARCH','research 使用 Skill 的纯网页路径，不创建项目 Runtime 任务');
    input.scope.forEach(p=>relative(p,true));const b=this.binding();const s=snapshot(new Files(b.root,this.config));
    const task:Task={schema_version:1,task_id:id(),session_id:id(),workspace_id:b.workspace_id,generation:b.generation,mode:input.mode,goal:redact(input.goal).text,scope:input.scope,acceptance_ids:input.acceptance_ids,state:'CREATED',attempt_id:1,repair_rounds:0,baseline:s.id,plan_id:null,plan_hash:null,plan_executed:false,request:null,cap_hash:null,cap_expires:null,created_at:now(),updated_at:now(),git:gitInfo(b.root),model_policy:input.model_policy??this.config.chatgpt.model_policy,locked_model:null,locked_reasoning:null,review_snapshot:null,blockers:[]};
    saveSnapshot(this.taskDir(task.task_id),s);this.save(task,'created');atomic(this.file('active.json'),{task_id:task.task_id});return task;
  });}
  currentSnapshot(t=this.task()) {const b=this.binding();if(b.workspace_id!==t.workspace_id||b.generation!==t.generation)fail('WORKSPACE_MISMATCH','任务绑定代次不匹配'); const s=snapshot(new Files(b.root,this.config));saveSnapshot(this.taskDir(t.task_id),s);return s;}
  baseline(t=this.task()) {return json<Snapshot>(path.join(this.taskDir(t.task_id),'snapshots',t.baseline+'.json'));}
  grant(confirmed:boolean,minutes=30) {return this.withLock(()=>{
    if(!confirmed)fail('EXPOSURE_CONFIRMATION_REQUIRED','用户需明确同意当前项目内容经 Tunnel 送至 ChatGPT');
    if(!Number.isInteger(minutes)||minutes<1||minutes>120)fail('AUTH_INVALID','授权有效期为 1–120 分钟');
    const t=this.task();if(terminal.has(t.state))fail('AUTH_REVOKED','任务已结束'); const token='mr_cap_'+randomBytes(32).toString('base64url');t.cap_hash=hash(token);t.cap_expires=new Date(Date.now()+minutes*60000).toISOString();this.save(t,'read_grant_created');return {capability:token,expires_at:t.cap_expires};
  });}
  authorize(token:string,workspaceId:string,generation:number,taskId:string) {
    const b=this.binding();const t=this.task();const e=json<Exposure>(this.file('exposure.json'));
    if(t.task_id!==taskId||t.workspace_id!==workspaceId||b.workspace_id!==workspaceId||t.generation!==generation||b.generation!==generation||e.task_id!==taskId||e.workspace_id!==workspaceId||e.generation!==generation)fail('WORKSPACE_MISMATCH','旧任务或旧绑定无权读取');
    if(e.config_hash!==hash(JSON.stringify(loadConfig(this.base))))fail('WORKSPACE_MISMATCH','运行中配置已变更，请停止并重新确认');
    const digest=hash(token);if(terminal.has(t.state)||!t.cap_hash||!t.cap_expires||Date.parse(t.cap_expires)<Date.now()||!timingSafeEqual(Buffer.from(digest),Buffer.from(t.cap_hash)))fail('AUTH_REVOKED','读取授权无效或已过期');return t;
  }
  expose(confirmed:boolean) {if(!confirmed)fail('EXPOSURE_CONFIRMATION_REQUIRED','需要本地 --confirm-exposure');const b=this.binding(),t=this.task();if(!t.cap_hash||!t.cap_expires||Date.parse(t.cap_expires)<Date.now()||terminal.has(t.state))fail('AUTH_REVOKED','先为当前任务建立有效限时授权');const e:Exposure={schema_version:1,workspace_id:b.workspace_id,generation:b.generation,task_id:t.task_id,config_hash:hash(JSON.stringify(this.config)),confirmed_at:now()};atomic(this.file('exposure.json'),e);return e;}
  cancel() {return this.withLock(()=>{const t=this.task();t.state='CANCELLED';t.cap_hash=null;t.cap_expires=null;this.save(t,'cancelled');return t;});}
  revoke() {return this.withLock(()=>{if(fs.existsSync(this.file('active.json'))){const t=this.task();t.cap_hash=null;t.cap_expires=null;this.save(t,'read_grant_revoked');}if(fs.existsSync(this.file('exposure.json')))fs.unlinkSync(this.file('exposure.json'));});}
}
