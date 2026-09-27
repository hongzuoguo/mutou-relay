import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ModelPolicy, atomic, fail, hash, id, json, now, redact, sanitize } from './core.js';
import { Store, Request } from './store.js';
import { relative } from './security.js';
import { taskChanges } from './evidence.js';
export const Observation=z.object({conversation_url:z.string().url(),surface:z.literal('chat'),selected_label:z.string().min(1),available_options:z.array(z.string()),reasoning_label:z.string().nullable(),app_available:z.boolean(),observed_at:z.iso.datetime(),verification_status:z.literal('verified'),source:z.literal('host-browser')}).strict();
export function chooseModel(policy:z.infer<typeof ModelPolicy>,current:string|null,available:string[]) {
  if(policy.mode==='current'){if(!current)fail('MODEL_SELECTION_UNVERIFIED','无法确认网页当前模型');return current;}
  const choices=policy.mode==='exact'?[policy.exact_label!]:policy.preferred_labels;
  for(const label of choices)if(available.filter(x=>x===label).length===1)return label;
  fail('MODEL_NOT_AVAILABLE','指定标签不存在或歧义；不更换账号或回退');
}
export function validConversation(url:string){const u=new URL(url);if(u.origin!=='https://chatgpt.com'||!/^\/c\/[a-zA-Z0-9-]+$/.test(u.pathname)||u.search||u.hash)fail('BROWSER_UI_CHANGED','需要明确的 ChatGPT 官方 Chat 会话 URL');}
export function prepare(store:Store,phase:'plan'|'review',raw:unknown) {return store.withLock(()=>{
  const o=Observation.parse(raw);validConversation(o.conversation_url);if(Date.now()-Date.parse(o.observed_at)>60000||Date.parse(o.observed_at)>Date.now()+5000)fail('MODEL_SELECTION_UNVERIFIED','网页观察已过期');
  const t=store.task();if(!o.app_available)fail('CHATGPT_APP_UNAVAILABLE','当前会话未确认 Mutou Relay App');
  if((phase==='plan'&&!['build','plan'].includes(t.mode))||(phase==='review'&&!['build','review'].includes(t.mode)))fail('MODE_READ_ONLY','当前模式不支持此阶段；旧模式任务须结束后以 build 新建');
  if(phase==='plan'&&!['CREATED','PRECHECK'].includes(t.state))fail('REPLY_MISMATCH','当前状态不能生成新 PLAN 请求');
  if(phase==='review'&&!(t.state==='VERIFYING'||(t.mode==='review'&&t.state==='CREATED')))fail('REPLY_MISMATCH','当前状态不能生成 REVIEW 请求');
  if(t.request&&t.request.conversation_url!==o.conversation_url)fail('WORKSPACE_MISMATCH','任务中不能更换网页会话');
  const selected=chooseModel(t.model_policy,o.selected_label,o.available_options);
  if(selected!==o.selected_label)fail('MODEL_SELECTION_UNVERIFIED','先通过网页选择策略模型，再重新观察');
  if(t.locked_model&&t.locked_model!==o.selected_label)fail('MODEL_NOT_AVAILABLE','任务中模型改变，需用户确认后新建任务');
  if(t.locked_model&&t.locked_reasoning!==o.reasoning_label)fail('MODEL_SELECTION_UNVERIFIED','任务中思考选项改变');
  if(t.model_policy.reasoning_label&&o.reasoning_label!==t.model_policy.reasoning_label)fail('MODEL_SELECTION_UNVERIFIED','思考选项未匹配');
  if(!t.cap_hash||!t.cap_expires||Date.parse(t.cap_expires)<=Date.now()||!fs.existsSync(store.file('exposure.json')))fail('AUTH_REVOKED','当前任务未取得有效暴露授权');
  const s=store.currentSnapshot(t);t.locked_model=o.selected_label;t.locked_reasoning=o.reasoning_label;
  const request:Request={session_id:t.session_id,workspace_id:t.workspace_id,binding_generation:t.generation,task_id:t.task_id,message_id:id(),phase,attempt_id:t.attempt_id,plan_id:t.plan_id,plan_hash:t.plan_hash,snapshot_id:s.id,expected_reply_marker:'MUTOU_'+id(),conversation_url:o.conversation_url,send_status:'PREPARED',created_at:now(),model_label:o.selected_label,reasoning_label:o.reasoning_label};
  t.request=request;t.state=phase==='plan'?'WAITING_PLAN':'WAITING_REVIEW';store.save(t,'request_prepared');atomic(path.join(store.taskDir(t.task_id),'request-'+request.message_id+'.json'),{request,observation:o});return request;
});}
export function markSend(store:Store,status:'SENDING'|'SENT'|'UNKNOWN',messageId:string){return store.withLock(()=>{const t=store.task();const r=t.request;if(!r||r.message_id!==messageId)fail('REPLY_MISMATCH','消息标识不匹配');if(status==='SENDING'&&r.send_status!=='PREPARED')fail('SEND_STATUS_UNKNOWN','该请求可能已发送，不得自动重发');if(status==='SENT'&&!['SENDING','UNKNOWN'].includes(r.send_status))fail('SEND_STATUS_UNKNOWN','需先登记发送意图');r.send_status=status;if(status==='UNKNOWN')t.state='NEEDS_USER';store.save(t,'send_'+status.toLowerCase());return r;});}
const Shared={schema_version:z.literal(1),session_id:z.uuid(),workspace_id:z.uuid(),binding_generation:z.number().int(),task_id:z.uuid(),message_id:z.uuid(),phase:z.enum(['plan','review']),attempt_id:z.number().int(),plan_id:z.uuid(),snapshot_id:z.string(),expected_reply_marker:z.string()};
export const Plan=z.object({...Shared,phase:z.literal('plan'),understanding:z.string().min(1),read_evidence:z.array(z.string().describe('Exact repository-relative file path successfully read with relay_read_text for THIS request, e.g. stats.js. No tool names, prose, line numbers, hashes, or citations. Put explanations in understanding.')).min(1),assumptions:z.array(z.string()),allowed_scope:z.array(z.string()).min(1),steps:z.array(z.string()).min(1),risks:z.array(z.string()),checks:z.array(z.string()).min(1),acceptance_mapping:z.array(z.object({acceptance_id:z.string(),steps:z.array(z.string()).min(1)}).strict()).min(1)}).strict();
export const Review=z.object({...Shared,phase:z.literal('review'),verdict:z.enum(['pass','changes_requested','blocked']),files:z.array(z.string()),changes_read:z.array(z.string()),checks_read:z.array(z.string()),acceptance_results:z.array(z.object({acceptance_id:z.string(),verdict:z.enum(['pass','fail','insufficient']),evidence:z.array(z.string())}).strict()),findings:z.array(z.object({severity:z.enum(['blocking','optional']),file:z.string(),description:z.string(),evidence:z.string()}).strict()),limitations:z.array(z.string())}).strict();
export function acceptReply(store:Store,input:{conversation_url:string;model_label:string;reasoning_label:string|null;text:string;source:'host-browser';completed:boolean}) {return store.withLock(()=>{
  const t=store.task(),r=t.request;if(!['build','plan','review'].includes(t.mode))fail('MODE_READ_ONLY','旧模式任务须结束后以 build 新建');if(!r||r.send_status!=='SENT'||!['WAITING_PLAN','WAITING_REVIEW'].includes(t.state))fail('REPLY_MISMATCH','没有对应的已发送请求');
  if(input.source!=='host-browser'||!input.completed||input.conversation_url!==r.conversation_url||input.model_label!==r.model_label||input.reasoning_label!==r.reasoning_label)fail('REPLY_MISMATCH','网页来源、模型、会话或完成状态不匹配');
  let parsed:unknown;try{parsed=JSON.parse(input.text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/,''));}catch{fail('REPLY_MISMATCH','回复必须为完整协议 JSON');}
  const result=(r.phase==='plan'?Plan:Review).parse(parsed);
  for(const key of ['session_id','workspace_id','binding_generation','task_id','message_id','phase','attempt_id','snapshot_id','expected_reply_marker'] as const)if(result[key]!==r[key])fail('REPLY_MISMATCH','回复关联字段不匹配：'+key);
  const current=store.currentSnapshot(t);if(current.id!==r.snapshot_id)fail('EVIDENCE_STALE','请求之后项目已改变');
  const readFile=path.join(store.taskDir(t.task_id),'reads.jsonl');const reads=fs.existsSync(readFile)?fs.readFileSync(readFile,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(x=>x.message_id===r.message_id&&x.attempt_id===r.attempt_id&&x.at>=r.created_at):[];
  const tools=new Set(reads.map(x=>x.tool));const needed=r.phase==='plan'?['relay_task_context','relay_read_text']:['relay_read_changes','relay_read_checks'];
  if(needed.some(n=>!tools.has(n)))fail('EVIDENCE_MISSING','没有对应请求的实际 MCP 读取记录');
  if(result.phase==='plan'){
    const readPaths=new Set(reads.filter(x=>x.tool==='relay_read_text').map(x=>x.relative_file));
    if(result.read_evidence.some(p=>!readPaths.has(p)))fail('EVIDENCE_MISSING','PLAN 声称读取的文件缺少实际读取记录');
    for(const p of result.allowed_scope){relative(p,true);if(!t.scope.some(s=>s===''||p===s||p.startsWith(s+'/')))fail('SCOPE_EXPANSION','模型计划扩大修改范围');}
    if(new Set(result.acceptance_mapping.map(x=>x.acceptance_id)).size!==t.acceptance_ids.length||t.acceptance_ids.some(a=>!result.acceptance_mapping.some(x=>x.acceptance_id===a)))fail('ACCEPTANCE_MISMATCH','PLAN 未精确覆盖验收 ID');
    t.plan_id=result.plan_id;t.plan_hash=hash(JSON.stringify(result));t.state=t.mode==='plan'?'DONE':'PLAN_VALIDATED';if(t.mode==='plan'){t.cap_hash=null;t.cap_expires=null;}
  }else{
    if(!reads.some(x=>x.tool==='relay_read_changes'&&x.snapshot_id===r.snapshot_id)||!reads.some(x=>x.tool==='relay_read_checks'&&x.snapshot_id===r.snapshot_id&&x.requested_attempt_id===r.attempt_id))fail('EVIDENCE_MISSING','REVIEW 没有读取当前快照差异与本轮检查');
    if(t.plan_id&&result.plan_id!==t.plan_id)fail('REPLY_MISMATCH','REVIEW 计划版本不匹配');
    if(new Set(result.acceptance_results.map(x=>x.acceptance_id)).size!==t.acceptance_ids.length||t.acceptance_ids.some(a=>!result.acceptance_results.some(x=>x.acceptance_id===a)))fail('ACCEPTANCE_MISMATCH','REVIEW 未精确覆盖验收 ID');
    if(result.verdict==='pass'){
      if(result.acceptance_results.some(x=>x.verdict!=='pass'||!x.evidence.length)||result.findings.some(x=>x.severity==='blocking')||t.blockers.length||current.truncated)fail('VERIFICATION_FAILED','REVIEW 尚有未满足验收、阻塞或不完整快照');
      if(t.mode==='build'){
        const dir=path.join(store.taskDir(t.task_id),'checks');const records=fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>json<any>(path.join(dir,n))).filter(c=>c.attempt_id===t.attempt_id):[];
        const latest=new Map<string,any>();for(const c of records.sort((a,b)=>a.started_at.localeCompare(b.started_at)))latest.set(c.check_key??c.check_id,c);const checks=[...latest.values()];
        if(!checks.length||checks.some(c=>c.status!=='passed'||c.before_snapshot!==current.id||c.after_snapshot!==current.id||c.plan_hash!==t.plan_hash))fail('VERIFICATION_FAILED','检查失败、未运行或已过期');
        for(const a of t.acceptance_ids)if(!checks.some(c=>c.acceptance_ids.includes(a)&&(c.kind!=='tests'||c.test_count>0)))fail('VERIFICATION_FAILED','验收缺乏有效检查覆盖');
      }
      if(taskChanges(store.baseline(t),current).some(c=>!t.scope.some(s=>s===''||c.path===s||c.path.startsWith(s+'/'))))fail('SCOPE_EXPANSION','存在授权范围外变化；保留现场并核实来源');
      t.review_snapshot=current.id;t.state='DONE';t.cap_hash=null;t.cap_expires=null;
    }else if(result.verdict==='changes_requested'&&t.mode==='build'){
      if(t.repair_rounds>=store.config.workflow.max_repair_rounds){t.state='NEEDS_USER';t.blockers.push('REPAIR_LIMIT_REACHED');}
      else {t.repair_rounds++;t.attempt_id++;t.state='EXECUTING';}
    }else {t.state='BLOCKED';t.blockers.push('REVIEW_BLOCKED');}
  }
  atomic(path.join(store.taskDir(t.task_id),'reply-'+r.message_id+'.json'),sanitize({received_at:now(),source:input.source,result}));store.save(t,'reply_accepted');return t;
});}
export function beginExecution(store:Store){return store.withLock(()=>{const t=store.task();if(t.mode!=='build')fail('MODE_READ_ONLY','只有 build 模式可以实施');if(t.state!=='PLAN_VALIDATED'||t.plan_executed||!t.plan_hash||!t.request)fail('PLAN_ALREADY_EXECUTED','计划不可执行或已消费');if(store.currentSnapshot(t).id!==t.request.snapshot_id)fail('EVIDENCE_STALE','PLAN 验证后项目改变');t.plan_executed=true;t.state='EXECUTING';store.save(t,'execution_started');return t;});}
export function recover(store:Store){return store.withLock(()=>{const t=store.task();const snapshot=store.currentSnapshot(t);if(t.state==='DONE'&&t.review_snapshot&&t.review_snapshot!==snapshot.id){t.state='NEEDS_USER';t.blockers.push('EVIDENCE_STALE');}else if(!['DONE','CANCELLED','FAILED'].includes(t.state)){t.state='NEEDS_USER';t.blockers.push(t.request?.send_status==='SENDING'?'SEND_STATUS_UNKNOWN':'RECOVERY_REQUIRES_INSPECTION');}store.save(t,'recovery_inspected');return {task:t,current_snapshot:snapshot.id,action:'检查原网页会话、发送记录与当前差异；不重放 PLAN、不回滚文件'};});}
