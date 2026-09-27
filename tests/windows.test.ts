import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fixture } from './helpers.js';
import { installSkill, uninstallSkill } from '../src/install.js';
import { ownedProcess, repoRoot } from '../src/collector.js';
import { atomic } from '../src/core.js';
import { releaseOwnedMcpLock } from '../src/runtime.js';

test('A01 installer/update/uninstall preserve unknown skills and edited files',()=>{const f=fixture();try{
  const root=path.join(f.parent,'技能 空格 (&)');installSkill(root);assert(fs.existsSync(path.join(root,'mutou-relay','SKILL.md')));assert.throws(()=>installSkill(root));installSkill(root,true);
  fs.appendFileSync(path.join(root,'mutou-relay','SKILL.md'),'\nuser customization');assert.throws(()=>uninstallSkill(root));assert.throws(()=>installSkill(root,true));
  const other=path.join(f.parent,'clean');installSkill(other);uninstallSkill(other);assert(!fs.existsSync(path.join(other,'mutou-relay')));
  const conflict=path.join(f.parent,'unknown');fs.mkdirSync(path.join(conflict,'mutou-relay'),{recursive:true});fs.writeFileSync(path.join(conflict,'mutou-relay','SKILL.md'),'unknown skill');assert.throws(()=>installSkill(conflict,true));assert.equal(fs.readFileSync(path.join(conflict,'mutou-relay','SKILL.md'),'utf8'),'unknown skill');
}finally{f.cleanup();}});
test('A02 native PowerShell CLI handles Chinese, spaces and ampersands without shell interpolation',()=>{const f=fixture();try{
  const r=spawnSync('pwsh',['-NoProfile','-File',path.join(repoRoot,'scripts/relay.ps1'),'task','status'],{env:{...process.env,MUTOU_RELAY_HOME:f.base},encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).state,'CREATED');
}finally{f.cleanup();}});
test('S09 timeout kills owned Windows descendants and leaves unrelated Node alive',async()=>{const f=fixture();const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});try{
  const marker=path.join(f.project,'should-not-exist.txt');const childCode=`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),4000);setInterval(()=>{},1000)`;
  const parentCode=`require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit',windowsHide:true});setInterval(()=>{},1000)`;
  const r=await ownedProcess({executable:process.execPath,arguments:['-e',parentCode],cwd:f.project},path.join(f.base,'process.json'),2000,1000);assert(r.timed_out);await new Promise(r=>setTimeout(r,4500));assert(!fs.existsSync(marker));assert.doesNotThrow(()=>process.kill(unrelated.pid!,0));
}finally{unrelated.kill();await new Promise(r=>setTimeout(r,100));f.cleanup();}});
test('S03/R07 MCP entry strips inherited runtime and unrelated secret environment',()=>{const f=fixture();try{
  const script=path.join(f.parent,'probe-env.cjs');fs.writeFileSync(script,"console.log(JSON.stringify({runtime:!!process.env.CONTROL_PLANE_API_KEY,other:!!process.env.UNRELATED_SECRET,home:!!process.env.MUTOU_RELAY_HOME}))");
  const r=spawnSync('pwsh',['-NoProfile','-File',path.join(repoRoot,'scripts/mcp-entry.ps1'),'-DataRoot',f.base,'-Node',process.execPath,'-Entry',script],{encoding:'utf8',windowsHide:true,env:{...process.env,CONTROL_PLANE_API_KEY:'FAKE-NOT-A-REAL-KEY',UNRELATED_SECRET:'FAKE'}});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{runtime:false,other:false,home:true});
}finally{f.cleanup();}});
test('Windows redirected LocalAppData atomic writes use the canonical parent for both names',()=>{
  const logical=fs.mkdtempSync(path.join(process.env.LOCALAPPDATA!,'mutou-relay-atomic-test-'));
  const file=path.join(logical,'atomic-regression-'+process.pid+'.json');const real=path.join(fs.realpathSync.native(logical),path.basename(file));
  try{atomic(file,{version:1});atomic(file,{version:2});assert.equal(JSON.parse(fs.readFileSync(real,'utf8')).version,2);assert(!fs.readdirSync(path.dirname(real)).some(n=>n.startsWith(path.basename(file)+'.')));}finally{if(fs.existsSync(real))fs.unlinkSync(real);fs.rmdirSync(path.dirname(real));}
});

test('S09 Windows Job cleanup releases only the exited MCP instance lock',async()=>{
  const f=fixture();const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  try{
    const file=f.store.file('mcp.lock');atomic(file,{pid:child.pid,instance:'owned'});
    assert.equal(releaseOwnedMcpLock(f.store,'owned'),false);assert(fs.existsSync(file));
    const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await exited;
    assert.equal(releaseOwnedMcpLock(f.store,'other'),false);assert(fs.existsSync(file));
    assert.equal(releaseOwnedMcpLock(f.store,'owned'),true);assert(!fs.existsSync(file));
  }finally{child.kill();f.cleanup();}
});

test('Owned Windows process preserves exact stdout and stderr without PowerShell task results',async()=>{
  const f=fixture();try{
    const result=await ownedProcess({executable:process.execPath,arguments:['-e','process.stdout.write("fixture-out");process.stderr.write("fixture-err")'],cwd:f.project},path.join(f.base,'process-output.json'),10000,1000);
    assert.equal(result.stdout,'fixture-out');assert.equal(result.stderr,'fixture-err');assert.equal(result.exit_code,0);
  }finally{f.cleanup();}
});
