import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { atomic, fail, hash, id, json, now, redact, noLinks } from './core.js';
import { Store } from './store.js';
import { repoRoot } from './collector.js';
import { safeEnv } from './evidence.js';

export const tunnelVersion='0.0.15';
export const tunnelZipHash='3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1';
export function releaseOwnedMcpLock(store:Store,instance:string){
  const file=store.file('mcp.lock');if(!fs.existsSync(file))return true;
  noLinks(file);const lock=json<{pid:number;instance?:string}>(file);
  if(lock.instance!==instance)return false;
  try{process.kill(lock.pid,0);return false;}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')return false;}
  fs.unlinkSync(file);return true;
}
export function tunnelExe(store:Store){return store.file('bin/tunnel-client-v'+tunnelVersion+'/tunnel-client.exe');}
export function doctor(store:Store){
  const probe=(exe:string,args:string[])=>{const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:15000,env:safeEnv()});return {status:r.status===0?'PASS':'BLOCKED',version:(r.stdout||'').trim().slice(0,250)};};
  return {local:{platform:process.platform,node:process.version,powershell:probe('pwsh',['-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()']),git:probe('git',['--version']),rg:probe('rg',['--version']),tunnel:probe(tunnelExe(store),['--version'])},config:{status:'PASS',schema_version:store.config.schema_version},workspace:fs.existsSync(store.file('binding.json'))?{status:'SELECTED',alias:store.binding().alias}:{status:'NOT_SELECTED'},credential:fs.existsSync(store.file('tunnel-runtime.dpapi'))?'PRESENT_NOT_DECRYPTED':'CREDENTIAL_MISSING',tunnel_id:store.config.connection.tunnel_id?'CONFIGURED':'MISSING',runtime:runtimeStatus(store),web:{browser:'NOT_CHECKED',account:'NOT_CHECKED',model:'NOT_CHECKED',app:'NOT_CHECKED',end_to_end:'E2E_NOT_VALIDATED'}};
}
export function runtimeStatus(store:Store){if(!fs.existsSync(store.file('runtime.lock')))return {running:false,ready:false,connection:'STOPPED'};const lock=json<any>(store.file('runtime.lock'));let alive=false;try{process.kill(lock.pid,0);alive=true;}catch{}const status=fs.existsSync(store.file('runtime-status.json'))?json<any>(store.file('runtime-status.json')):{};const current=alive&&status.instance===lock.instance&&Date.now()-Date.parse(status.observed_at)<10000;return {...(current?status:{}),running:alive,ready:current&&status.ready===true,connection:!alive?'STALE_LOCK':current?status.connection:'PROCESS_PRESENT_NOT_READY',identity_requires_verification:true};}
export async function protocolProbe(store:Store){
  const client=new Client({name:'mutou-relay-local-probe',version:'0.1.0'});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(repoRoot,'dist/src/cli.js'),'mcp'],env:{...safeEnv(),MUTOU_RELAY_HOME:store.base} as Record<string,string>,stderr:'pipe'});
  try{await client.connect(transport);const result=await client.listTools();if(result.tools.length!==7||result.tools.some(t=>t.annotations?.readOnlyHint!==true))fail('TUNNEL_NOT_READY','本地 MCP 工具清单不符合预期');return {protocol:'PASS',tool_count:result.tools.length,scope:'local stdio only'};}finally{await client.close();}
}
export async function start(store:Store,confirmed:boolean){
  if(!confirmed)fail('EXPOSURE_CONFIRMATION_REQUIRED','首次项目暴露需要 --confirm-exposure');
  if(!store.config.connection.tunnel_id)fail('TUNNEL_PERMISSION_DENIED','尚未配置经用户确认的 Tunnel ID');
  if(!fs.existsSync(tunnelExe(store)))fail('DEPENDENCY_MISSING','尚未安装锁定版本官方 Tunnel 客户端');
  const manifestPath=path.join(path.dirname(tunnelExe(store)),'mutou-install.json');if(!fs.existsSync(manifestPath))fail('TUNNEL_INTEGRITY_FAILED','缺少官方发行包校验记录');
  const manifest=json<any>(manifestPath);if(manifest.version!==tunnelVersion||manifest.zip_sha256!==tunnelZipHash||manifest.executable_sha256!==hash(fs.readFileSync(tunnelExe(store))))fail('TUNNEL_INTEGRITY_FAILED','客户端与锁定版本校验不匹配');
  if(!fs.existsSync(store.file('tunnel-runtime.dpapi')))fail('CREDENTIAL_MISSING','请运行 credentials set 安全输入 Runtime Key');
  store.binding();store.task();
  const instance=id();let fd:number;try{fd=fs.openSync(store.file('runtime.lock'),'wx');}catch{fail('INSTANCE_BUSY','已有实例或待核查的中断锁');}
  fs.writeFileSync(fd,JSON.stringify({schema_version:1,instance,pid:process.pid,started_at:now(),workspace_id:store.binding().workspace_id,config_hash:hash(JSON.stringify(store.config))}));fs.closeSync(fd);
  let globalLockPath:string|undefined;let child:ReturnType<typeof spawn>|undefined;let stopRequested=false;const stop=()=>{stopRequested=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const healthFile=store.file('artifacts/health-'+instance+'.url');const cfgFile=store.file('artifacts/tunnel-'+instance+'.yaml');const specFile=store.file('artifacts/tunnel-'+instance+'.json');
  try{
    if(!process.env.LOCALAPPDATA)fail('DEPENDENCY_MISSING','Windows LOCALAPPDATA 不可用');
    const globalDir=path.join(process.env.LOCALAPPDATA,'MutouRelay','tunnel-locks');noLinks(globalDir);fs.mkdirSync(globalDir,{recursive:true});
    const globalLock=path.join(globalDir,hash(store.config.connection.tunnel_id!)+'.lock');
    try{fs.writeFileSync(globalLock,JSON.stringify({instance,pid:process.pid,started_at:now(),data_root:store.base}),{flag:'wx'});}catch{fail('INSTANCE_BUSY','同一 Tunnel ID 已有实例或待核查的中断锁');}
    globalLockPath=globalLock;
    store.expose(true);const local=await protocolProbe(store);
    const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
    const command='& '+quote(path.join(repoRoot,'scripts/mcp-entry.ps1'))+' -DataRoot '+quote(store.base)+' -Node '+quote(process.execPath)+' -Entry '+quote(path.join(repoRoot,'dist/src/cli.js'))+' -Instance '+quote(instance);
    const config={config_version:1,control_plane:{base_url:'https://api.openai.com',tunnel_id:store.config.connection.tunnel_id,api_key:'env:CONTROL_PLANE_API_KEY'},health:{listen_addr:'127.0.0.1:0',url_file:healthFile},admin_ui:{open_browser:false},log:{level:'info',format:'json'},mcp:{commands:[{channel:'main',command:'pwsh -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+Buffer.from(command,'utf16le').toString('base64')} ]}};
    fs.writeFileSync(cfgFile,YAML.stringify(config));atomic(specFile,{schema_version:1,executable:tunnelExe(store),arguments:['run','--config',cfgFile],cwd:store.base,credential_file:store.file('tunnel-runtime.dpapi')});
    child=spawn('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(repoRoot,'scripts/run-owned.ps1'),'-SpecPath',specFile],{env:safeEnv(),windowsHide:true,stdio:['ignore','pipe','pipe']});let ended=false;let exitCode:number|null=null;let spawnError=false;
    child.on('error',()=>{spawnError=true;ended=true;});child.on('exit',c=>{exitCode=c;ended=true;});
    for(const stream of [child.stdout,child.stderr]){let pending='';stream?.on('data',(b:Buffer)=>{pending+=b.toString();const lines=pending.split('\n');pending=lines.pop()!.slice(-10000);for(const line of lines)fs.appendFileSync(store.file('logs/tunnel.jsonl'),redact(line).text.slice(0,10000)+'\n');});}
    process.stderr.write('Mutou Relay 前台运行；Ctrl+C 或 relay stop 停止。正在确认连接。\n');
    while(!ended&&!stopRequested){
      if(fs.existsSync(store.file('stop-request.json'))){const request=json<any>(store.file('stop-request.json'));if(request.instance===instance)stopRequested=true;}
      if(hash(JSON.stringify(store.config))!==hash(JSON.stringify(new Store(store.base).config))){stopRequested=true;}
      let health=false,ready=false;if(fs.existsSync(healthFile)){
        try{const url=fs.readFileSync(healthFile,'utf8').trim();const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.protocol!=='http:')fail('TUNNEL_NOT_READY','健康检查地址非 loopback');health=(await fetch(new URL('/healthz',u),{signal:AbortSignal.timeout(2000),redirect:'error'})).ok;ready=(await fetch(new URL('/readyz',u),{signal:AbortSignal.timeout(2000),redirect:'error'})).ok;}catch{}
      }
      atomic(store.file('runtime-status.json'),{instance,pid:process.pid,observed_at:now(),running:true,healthy:health,ready,local_protocol:local.protocol,remote_mcp:'NOT_CHECKED',connection:ready?'TUNNEL_READY_WEB_NOT_VALIDATED':'TUNNEL_NOT_READY'});
      if(!stopRequested)await new Promise(r=>setTimeout(r,1000));
    }
    if(stopRequested&&child&&!ended){child.kill('SIGTERM');await new Promise<void>(r=>{child!.once('exit',()=>r());setTimeout(r,5000).unref();});if(child.exitCode===null)child.kill('SIGKILL');}
    if(!stopRequested&&(spawnError||exitCode!==0))fail('TUNNEL_NOT_READY','Tunnel 进程未成功运行；查看脱敏日志');
  }finally{
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);if(child&&child.exitCode===null)child.kill('SIGKILL');
    // Windows Job termination bypasses Node's exit handlers. Only release our
    // own nonce-tagged MCP lock, and only after its process is confirmed gone.
    for(let i=0;i<20&&!releaseOwnedMcpLock(store,instance);i++)await new Promise(r=>setTimeout(r,100));
    store.revoke();for(const f of [healthFile,cfgFile,specFile,store.file('runtime.lock'),store.file('stop-request.json'),...(globalLockPath?[globalLockPath]:[])])if(fs.existsSync(f))fs.unlinkSync(f);
    atomic(store.file('runtime-status.json'),{running:false,ready:false,connection:'STOPPED',observed_at:now()});
  }
}
export async function stopRuntime(store:Store){
  if(!fs.existsSync(store.file('runtime.lock'))){store.revoke();return {connection:'STOPPED'};}
  const lock=json<any>(store.file('runtime.lock'));atomic(store.file('stop-request.json'),{instance:lock.instance,requested_at:now()});
  for(let i=0;i<50;i++){if(!fs.existsSync(store.file('runtime.lock')))return {connection:'STOPPED'};await new Promise(r=>setTimeout(r,200));}
  store.revoke();fail('STOP_NOT_CONFIRMED','已撤销项目读取，但进程未确认退出；保留锁，不按名称或不明 PID 杀进程');
}
