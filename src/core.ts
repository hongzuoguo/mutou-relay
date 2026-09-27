import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import YAML from 'yaml';

export const hash = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export class RelayError extends Error {
  constructor(public code: string, message: string, public layer = 'local', public next = '检查配置和当前任务状态', public needsUser = false) { super(message); }
  toJSON() { return { code: this.code, layer: this.layer, reason: redact(this.message).text, completed_state: null, next: this.next, needs_user: this.needsUser }; }
}
export function fail(code: string, msg: string): never {
  const layer=/^(BROWSER|HOST_BROWSER|CHATGPT|MODEL|SEND|COMPOSER)/.test(code)?'browser':/^(TUNNEL|CREDENTIAL)/.test(code)?'connection':/^(WORKSPACE|AUTH|EXPOSURE|FILE_|CURSOR)/.test(code)?'security':'local';
  const needsUser=/CONFIRM|TRUST|PERMISSION|CREDENTIAL|MODEL|REPAIR_LIMIT|SEND_STATUS|RECOVERY|STOP_NOT|HOST_BROWSER/.test(code);
  throw new RelayError(code,msg,layer,'保留现场；查看 docs/troubleshooting.md 中对应错误与 task status',needsUser);
}
export function redact(input: string) {
  let text = input.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-(?:proj-|svcacct-)?|gh[pousr]_|github_pat_|AKIA)[A-Za-z0-9_\-]{12,}\b/g, '[REDACTED KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization|capability|runtime[_-]?key)\s*["']?\s*[:=]\s*)(?:["'][^"'\r\n]*["']|[^\s,;\r\n]+)/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bmr_cap_[A-Za-z0-9_-]+\b/g, '[REDACTED CAPABILITY]');
  return { text, redacted: text !== input };
}
export function sanitize<T>(value:T):T {
  if(typeof value==='string')return redact(value).text as T;
  if(Array.isArray(value))return value.map(sanitize) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitize(v)])) as T;
  return value;
}
export const ModelPolicy = z.object({ mode: z.enum(['current','exact','prefer']).default('current'), exact_label: z.string().min(1).nullable().default(null), preferred_labels: z.array(z.string().min(1)).max(20).default([]), reasoning_label: z.string().min(1).nullable().default(null), fallback: z.literal('block').default('block') }).strict().superRefine((v,c)=>{
  if (v.mode==='exact' && !v.exact_label) c.addIssue({code:'custom',message:'exact 需要完整模型标签'});
  if (v.mode==='prefer' && !v.preferred_labels.length) c.addIssue({code:'custom',message:'prefer 需要候选标签'});
});
export const ConfigSchema = z.object({
  schema_version:z.literal(1).default(1), product:z.literal('mutou-relay').default('mutou-relay'),
  workspace:z.object({selection:z.literal('explicit_or_codex_context').default('explicit_or_codex_context'),one_active_project:z.literal(true).default(true)}).strict().default({selection:'explicit_or_codex_context',one_active_project:true}),
  chatgpt:z.object({surface:z.literal('chat').default('chat'),app_name:z.literal('Mutou Relay').default('Mutou Relay'),model_policy:ModelPolicy.default({mode:'current',exact_label:null,preferred_labels:[],reasoning_label:null,fallback:'block'}),lock_selection_for_task:z.literal(true).default(true)}).strict().default({surface:'chat',app_name:'Mutou Relay',model_policy:{mode:'current',exact_label:null,preferred_labels:[],reasoning_label:null,fallback:'block'},lock_selection_for_task:true}),
  connection:z.object({provider:z.literal('openai-secure-tunnel').default('openai-secure-tunnel'),profile:z.literal('mutou-relay').default('mutou-relay'),transport:z.literal('stdio').default('stdio'),credentials_ref:z.literal('mutou-relay/tunnel-runtime').default('mutou-relay/tunnel-runtime'),tunnel_id:z.string().regex(/^tunnel_[a-zA-Z0-9]+$/).nullable().default(null)}).strict().default({provider:'openai-secure-tunnel',profile:'mutou-relay',transport:'stdio',credentials_ref:'mutou-relay/tunnel-runtime',tunnel_id:null}),
  workflow:z.object({default_mode:z.enum(['research','plan','build','review']).default('build'),approval_mode:z.literal('within_authorized_scope').default('within_authorized_scope'),max_repair_rounds:z.number().int().min(0).max(1).default(1)}).strict().default({default_mode:'build',approval_mode:'within_authorized_scope',max_repair_rounds:1}),
  limits:z.object({max_file_bytes:z.number().int().min(1024).max(4194304).default(1048576),max_read_lines:z.number().int().min(1).max(1000).default(200),max_search_results:z.number().int().min(1).max(500).default(100),max_response_chars:z.number().int().min(2000).max(100000).default(30000),max_tree_depth:z.number().int().min(1).max(12).default(6),tool_timeout_seconds:z.number().int().min(1).max(60).default(15),max_files:z.number().int().min(1).max(20000).default(5000),max_snapshot_bytes:z.number().int().min(1024).max(67108864).default(16777216)}).strict().default({max_file_bytes:1048576,max_read_lines:200,max_search_results:100,max_response_chars:30000,max_tree_depth:6,tool_timeout_seconds:15,max_files:5000,max_snapshot_bytes:16777216}),
  evidence:z.object({screenshots:z.literal('off').default('off'),retention_days:z.number().int().min(1).max(90).default(14)}).strict().default({screenshots:'off',retention_days:14})
}).strict();
export type Config = z.infer<typeof ConfigSchema>;
export function parseConfig(value: unknown): Config { const r=ConfigSchema.safeParse(value); if(!r.success) fail('CONFIG_INVALID','配置无效：'+r.error.issues.map(e=>e.path.join('.')+' '+e.message).join('; ')); return r.data; }
export function atomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  // MSIX can redirect a logical LocalAppData folder to another volume. Resolve the
  // existing parent before creating BOTH names so rename stays on that volume.
  noLinks(path.dirname(file));
  file=path.join(fs.realpathSync.native(path.dirname(file)),path.basename(file));
  const tmp=file+'.'+id()+'.tmp';
  try { fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file); } finally { if(fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function json<T>(file: string): T { return JSON.parse(fs.readFileSync(file,'utf8')) as T; }
export function inside(root: string, target: string) { const rel=path.relative(root,target); return rel==='' || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel)); }
export function noLinks(absolute: string) {
  const parsed=path.parse(absolute); let current=parsed.root;
  for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part); if(fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('WORKSPACE_UNSAFE','不允许符号链接或 junction');
  }
}
export function privateRoot() {
  const base=process.env.MUTOU_RELAY_HOME || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA,'MutouRelay'):null);
  if(!base || !path.isAbsolute(base)) fail('WORKSPACE_UNSAFE','需要绝对私有目录或 LOCALAPPDATA');
  let root=path.resolve(base); noLinks(root);
  if(fs.existsSync(root)){root=fs.realpathSync.native(root);noLinks(root);}
  for(let p=root;;p=path.dirname(p)) { if(fs.existsSync(path.join(p,'.git'))) fail('WORKSPACE_UNSAFE','私有证据目录不能位于 Git 仓库内'); if(p===path.dirname(p)) break; }
  if(root===path.parse(root).root || root.toLowerCase()===os.homedir().toLowerCase()) fail('WORKSPACE_UNSAFE','私有目录过宽');
  return root;
}
export function loadConfig(base=privateRoot()) { return parseConfig(YAML.parse(fs.readFileSync(path.join(base,'settings.yaml'),'utf8'))); }
export function init(base=privateRoot()) {
  fs.mkdirSync(base,{recursive:true});
  for(const d of ['sessions','artifacts','logs','bin']) fs.mkdirSync(path.join(base,d),{recursive:true});
  const file=path.join(base,'settings.yaml');
  if(!fs.existsSync(file)) fs.writeFileSync(file,YAML.stringify(parseConfig({})),{flag:'wx'});
  return {root:base,config:loadConfig(base),manual_steps:['本地安全输入 Runtime Key','配置 Tunnel ID 与工作区关联','确认浏览器会话、模型及 ChatGPT App','首次暴露明确项目需确认']};
}
