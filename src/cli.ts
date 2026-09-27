import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { z } from 'zod';
import { RelayError, atomic, fail, init, json, loadConfig, noLinks, now, privateRoot, redact } from './core.js';
import { Store, terminal } from './store.js';
import { serve } from './mcp.js';
import { acceptReply, beginExecution, markSend, prepare, recover } from './protocol.js';
import { collect, repoRoot } from './collector.js';
import { configureBrowser, runBrowser } from './browser.js';
import { doctor, protocolProbe, runtimeStatus, start, stopRuntime } from './runtime.js';
import { installSkill, uninstallSkill } from './install.js';
import { trustProject } from './preferences.js';

const args=process.argv.slice(2);const command=args.shift();
function opt(key:string){const index=args.indexOf('--'+key);if(index<0)return undefined;const value=args[index+1];if(!value||value.startsWith('--'))fail('ARGUMENT_INVALID','参数需要值：'+key);args.splice(index,2);return value;}
function flag(key:string){const index=args.indexOf('--'+key);if(index<0)return false;args.splice(index,1);return true;}
function need(key:string){const value=opt(key);if(value===undefined)fail('ARGUMENT_INVALID','缺少 --'+key);return value;}
function done(){if(args.length)fail('ARGUMENT_INVALID','未知参数');}
function print(x:unknown){process.stdout.write(JSON.stringify(x,null,2)+'\n');}
function input(){return json<unknown>(path.resolve(need('file')));}
async function main(){
  if(!command||command==='help'){print({product:'Mutou Relay · 木头接力',commands:['init','doctor','workspace select --path <project>','connection configure --tunnel-id <id> --confirm','credentials set|test|remove','task create --file <task.json>','task grant --confirm-exposure','start --confirm-exposure','status','task status|execute|cancel|recover','task prepare --phase plan|review --file <observation.json>','task accept --file <browser-reply.json>','check --file <check.json>','browser configure --file <selectors.json> --confirm-session','browser <operation> [--capability-file <private file>]','config show --redacted','probe','stop','cleanup [--apply]'],warning:'远程内容需要显式当前任务授权；未完成真实网页闭环时为 E2E_NOT_VALIDATED'});return;}
  if(command==='init'){done();if(Number(process.versions.node.split('.')[0])!==24)fail('DEPENDENCY_MISSING','此版本验证于 Node.js 24 LTS，请使用该主版本');if(spawnSync('git',['--version'],{windowsHide:true}).status!==0)fail('DEPENDENCY_MISSING','需要 Git');const r=init();const result=spawnSync('pwsh',['-NoProfile','-File',path.join(repoRoot,'scripts/protect-data.ps1'),'-DataRoot',r.root],{encoding:'utf8',windowsHide:true});if(result.status!==0)fail('PRIVATE_ACL_FAILED','无法设置私有目录访问控制');print(r);return;}
  if(command==='skill'){const action=args.shift();const root=opt('skills-root');const update=flag('update');done();if(action==='install')print(installSkill(root,update));else if(action==='uninstall')print(uninstallSkill(root));else fail('ARGUMENT_INVALID','skill install/uninstall');return;}
  const store=new Store();
  if(command==='mcp'){
    done();if(!fs.existsSync(store.file('exposure.json')))fail('AUTH_REVOKED','未确认当前项目暴露');
    let fd:number;try{fd=fs.openSync(store.file('mcp.lock'),'wx');}catch{fail('INSTANCE_BUSY','已有 stdio MCP 实例');}fs.writeFileSync(fd,JSON.stringify({pid:process.pid,started_at:now(),instance:process.env.MUTOU_RELAY_INSTANCE??null}));fs.closeSync(fd);
    const release=()=>{try{const owner=json<{pid:number}>(store.file('mcp.lock'));if(owner.pid===process.pid)fs.unlinkSync(store.file('mcp.lock'));}catch{}};
    process.once('exit',release);process.once('SIGTERM',()=>process.exit(0));process.once('SIGINT',()=>process.exit(0));await serve(store);return;
  }
  if(command==='doctor'){done();print(doctor(store));return;}
  if(command==='status'){done();print(runtimeStatus(store));return;}
  if(command==='probe'){done();print(await protocolProbe(store));return;}
  if(command==='start'){const confirmed=flag('confirm-exposure');done();await start(store,confirmed);return;}
  if(command==='stop'){done();print(await stopRuntime(store));return;}
  if(command==='workspace'&&args.shift()==='select'){const p=need('path');done();const b=store.select(p);print({workspace_id:b.workspace_id,binding_generation:b.generation,alias:b.alias});return;}
  if(command==='project'&&args.shift()==='trust'){const confirmed=flag('confirm');done();print(trustProject(store,confirmed));return;}
  if(command==='config'&&args.shift()==='show'){flag('redacted');done();const c=structuredClone(store.config);if(c.connection.tunnel_id)c.connection.tunnel_id='[configured]';print(c);return;}
  if(command==='connection'&&args.shift()==='configure'){const tid=need('tunnel-id'),confirmed=flag('confirm');done();if(!confirmed)fail('EXPOSURE_CONFIRMATION_REQUIRED','需要用户确认 Tunnel 身份及工作区关联');if(fs.existsSync(store.file('runtime.lock')))fail('INSTANCE_BUSY','先停止 Runtime');if(!/^tunnel_[a-zA-Z0-9]+$/.test(tid))fail('CONFIG_INVALID','Tunnel ID 格式错误');store.config.connection.tunnel_id=tid;fs.writeFileSync(store.file('settings.yaml'),YAML.stringify(store.config));print({configured:true});return;}
  if(command==='credentials'){const action=args.shift();done();if(!['set','test','remove'].includes(action??''))fail('ARGUMENT_INVALID','凭证操作必须 set/test/remove');const r=spawnSync('pwsh',['-NoProfile','-File',path.join(repoRoot,'scripts/credential.ps1'),'-Action',action!,'-DataRoot',store.base],{stdio:'inherit'});process.exitCode=r.status??1;return;}
  if(command==='check'){const value=input();done();print(await collect(store,value));return;}
  if(command==='task'){
    const action=args.shift();
    if(action==='create'){const value=input();done();print(store.create(value));return;}
    if(action==='status'){done();let t=store.task();if(t.state==='DONE'&&t.review_snapshot&&store.currentSnapshot(t).id!==t.review_snapshot)t=recover(store).task;print({...t,cap_hash:t.cap_hash?'[set]':null,web_end_to_end:t.state==='DONE'?'RECORDED':'E2E_NOT_VALIDATED'});return;}
    if(action==='grant'){const confirmed=flag('confirm-exposure');const minutes=Number(opt('minutes')??30);done();print(store.grant(confirmed,minutes));return;}
    if(action==='cancel'){done();print(store.cancel());return;}
    if(action==='execute'){done();print(beginExecution(store));return;}
    if(action==='recover'){done();print(recover(store));return;}
    if(action==='prepare'){const phase=z.enum(['plan','review']).parse(need('phase'));const value=input();done();print(prepare(store,phase,value));return;}
    if(action==='accept'){const value=z.object({conversation_url:z.string(),model_label:z.string(),reasoning_label:z.string().nullable(),text:z.string().max(200000),source:z.literal('host-browser'),completed:z.boolean()}).strict().parse(input());done();print(acceptReply(store,value));return;}
    if(action==='send-state'){const status=z.enum(['SENDING','SENT','UNKNOWN']).parse(need('status'));const message=need('message-id');done();print(markSend(store,status,message));return;}
  }
  if(command==='browser'){
    const action=args.shift();if(action==='configure'){const value=input(),confirmed=flag('confirm-session');done();print(configureBrowser(store,value,confirmed));return;}
    const capFile=opt('capability-file');done();let cap:string|undefined;
    if(capFile){const full=path.resolve(capFile);noLinks(full);if(path.dirname(full)!==store.base)fail('WORKSPACE_UNSAFE','限时授权文件必须直接位于私有目录');cap=json<{capability:string}>(full).capability;}
    print(runBrowser(store,action??'',cap));return;
  }
  if(command==='cleanup'){
    const apply=flag('apply');done();if(fs.existsSync(store.file('runtime.lock')))fail('INSTANCE_BUSY','清理前先停止实例');
    const cutoff=Date.now()-store.config.evidence.retention_days*86400000;const selected:string[]=[];const active=fs.existsSync(store.file('active.json'))?json<{task_id:string}>(store.file('active.json')).task_id:null;
    for(const name of fs.readdirSync(store.file('sessions'))){if(name===active||!z.uuid().safeParse(name).success)continue;const dir=store.taskDir(name);noLinks(dir);const file=path.join(dir,'task.json');if(!fs.existsSync(file))continue;const t=json<any>(file);if(t.schema_version!==1||t.task_id!==name||!terminal.has(t.state)||Date.parse(t.updated_at)>=cutoff)continue;
      const queue=[dir];while(queue.length){const d=queue.pop()!;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isSymbolicLink())fail('WORKSPACE_UNSAFE','证据区含链接，拒绝递归清理');if(e.isDirectory())queue.push(path.join(d,e.name));}}
      selected.push(name);if(apply)fs.rmSync(dir,{recursive:true});
    }print({applied:apply,expired_terminal_task_ids:selected});return;
  }
  fail('ARGUMENT_INVALID','未知命令；运行 help');
}
main().catch(e=>{const error=e instanceof RelayError?e:new RelayError('LOCAL_ERROR',e instanceof z.ZodError?'输入 schema 验证失败':'本地操作失败；检查配置、文件与依赖');process.stderr.write(JSON.stringify(error.toJSON())+'\n');process.exitCode=1;});
