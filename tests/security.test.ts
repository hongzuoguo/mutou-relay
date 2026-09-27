import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../src/collector.js';
import { parseConfig, redact, privateRoot } from '../src/core.js';
import { Files, relative, workspaceRoot } from '../src/security.js';
import { fixture } from './helpers.js';
import { trustProject } from '../src/preferences.js';

test('S01 rejects traversal, drives, UNC, ADS, aliases and device names',()=>{
  for(const value of ['../outside','a/../../x','a\\..\\x','C:\\x','D:relative','/absolute','\\\\server\\share','\\\\?\\C:\\x','file:secret','folder./a','folder /a','PROGRA~1/a','NUL.txt','x//y','x\u0000y'])assert.throws(()=>relative(value),value);
  assert.equal(relative('src/token.ts'),'src/token.ts');assert.equal(relative('中文 空格 (&)/file.ts'),'中文 空格 (&)/file.ts');
});
test('S01 broad roots, home, system and overlapping evidence refused',()=>{const f=fixture();try{for(const p of [path.parse(f.project).root,os.homedir(),process.env.SystemRoot!,f.parent])assert.throws(()=>workspaceRoot(p,f.base));}finally{f.cleanup();}});
test('S02 Windows junction and hard-link files refused',()=>{const f=fixture();try{
  const outside=path.join(f.parent,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'secret.txt'),'outside');fs.symlinkSync(outside,path.join(f.project,'jump'),'junction');fs.linkSync(path.join(outside,'secret.txt'),path.join(f.project,'hard.txt'));
  const files=new Files(f.project,f.store.config);assert.throws(()=>files.read('jump/secret.txt'));assert.throws(()=>files.read('hard.txt'));assert(!files.inventory().files.includes('jump/secret.txt'));
}finally{f.cleanup();}});

test('S02 real Windows unknown name-surrogate reparse point refuses content reads',()=>{
  const f=fixture(),file=path.join(f.project,'unknown-reparse.txt');let tagged=false;
  const native=(action:string)=>spawnSync('pwsh',['-NoProfile','-NonInteractive','-File',path.join(repoRoot,'tests/fixtures/native-reparse.ps1'),'-Path',file,'-Action',action],{windowsHide:true,encoding:'utf8'});
  try{
    fs.writeFileSync(file,'owned harmless fixture');const result=native('set');assert.equal(result.status,0,result.stderr);tagged=true;
    assert.throws(()=>new Files(f.project,f.store.config).read('unknown-reparse.txt'));
  }finally{if(tagged){const result=native('remove');assert.equal(result.status,0,result.stderr);}f.cleanup();}
});
test('S03 excludes secrets without blocking token.ts; rejects binary, malformed UTF8, and oversize',()=>{const f=fixture();try{
  const files=new Files(f.project,f.store.config);assert.throws(()=>files.read('.env'));assert.match(files.read('token.ts').text,/safe name/);
  fs.writeFileSync(path.join(f.project,'secret-code.ts'),'const api_key="sk-proj-FAKESECRETFORTESTING123456789";');assert(!files.read('secret-code.ts').text.includes('FAKESECRET'));
  fs.writeFileSync(path.join(f.project,'bad.txt'),Buffer.from([0xff,0xfe]));assert.throws(()=>files.read('bad.txt'));
  fs.writeFileSync(path.join(f.project,'binary.txt'),Buffer.from([1,0,2]));assert.throws(()=>files.read('binary.txt'));
  fs.writeFileSync(path.join(f.project,'large.txt'),'a'.repeat(1048577));assert.throws(()=>files.read('large.txt'));
}finally{f.cleanup();}});

test('S02 controlled real file races reject pre-open replacement and post-read mutation',()=>{
  const f=fixture(),originalOpen=fs.openSync,originalRead=fs.readSync;try{
    const target=path.join(f.project,'race.txt'),replacement=path.join(f.project,'replacement.txt');
    fs.writeFileSync(target,'safe fixture');fs.writeFileSync(replacement,'replacement canary');
    const files=new Files(f.project,f.store.config);let replaced=false;
    fs.openSync=((file:any,...args:any[])=>{if(file===target&&!replaced){replaced=true;fs.renameSync(target,target+'.old');fs.renameSync(replacement,target);}return (originalOpen as any)(file,...args);}) as typeof fs.openSync;
    assert.throws(()=>files.read('race.txt'),(e:any)=>e.code==='EVIDENCE_STALE');assert(replaced);fs.openSync=originalOpen;
    let mutated=false;
    fs.readSync=((...args:any[])=>{const n=(originalRead as any)(...args);if(!mutated){mutated=true;fs.appendFileSync(target,'changed during read');}return n;}) as typeof fs.readSync;
    assert.throws(()=>files.read('race.txt'),(e:any)=>e.code==='EVIDENCE_STALE');assert(mutated);
  }finally{fs.openSync=originalOpen;fs.readSync=originalRead;f.cleanup();}
});
test('S03 redacts private keys, bearer tokens, assignments and capabilities',()=>{
  const value='password="hidden"\nAuthorization: Bearer abcdefghijklmnop\n-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\nmr_cap_ABCDEFGHIJ';const r=redact(value);assert(r.redacted);for(const secret of ['hidden','abcdefghijklmnop','SECRET\n','ABCDEFGHIJ'])assert(!r.text.includes(secret));
});
test('S05 config rejects unknown fields, unsafe providers, relaxation and unsupported versions',()=>{
  assert.throws(()=>parseConfig({schema_version:2}));assert.throws(()=>parseConfig({root:'C:/'}));assert.throws(()=>parseConfig({connection:{provider:'public'}}));assert.throws(()=>parseConfig({limits:{max_read_lines:0}}));assert.throws(()=>parseConfig({chatgpt:{model_policy:{mode:'exact'}}}));
  assert.equal(parseConfig({}).workflow.max_repair_rounds,1);
});
test('S06 depth and file count truncation is explicit',()=>{const f=fixture();try{fs.mkdirSync(path.join(f.project,'deep'));fs.writeFileSync(path.join(f.project,'deep','x.txt'),'hello');const config=parseConfig({limits:{max_files:1}});assert(new Files(f.project,config).inventory().truncated);assert(new Files(f.project,f.store.config).inventory('',0).truncated);}finally{f.cleanup();}});
test('S05 project preferences require local trust and cannot widen authority',()=>{const f=fixture();try{fs.writeFileSync(path.join(f.project,'.mutou-relay.yaml'),'schema_version: 1\ndefault_mode: review\n');assert.throws(()=>trustProject(f.store,false));trustProject(f.store,true);f.store.cancel();assert.equal(f.store.create({goal:'read',scope:['main.js'],acceptance_ids:['A']}).mode,'review');f.store.cancel();fs.writeFileSync(path.join(f.project,'.mutou-relay.yaml'),'schema_version: 1\nroot: C:/\n');assert.throws(()=>trustProject(f.store,true));assert.throws(()=>f.store.create({goal:'read',scope:['main.js'],acceptance_ids:['A']}));}finally{f.cleanup();}});
