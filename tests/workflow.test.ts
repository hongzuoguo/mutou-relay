import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './helpers.js';
import { Files } from '../src/security.js';
import { snapshot, taskChanges, gitChanges } from '../src/evidence.js';
import { collect } from '../src/collector.js';
import { acceptReply, beginExecution, chooseModel, markSend, prepare } from '../src/protocol.js';
import { ModelPolicy, id, now, parseConfig } from '../src/core.js';
import { ProjectPreferences } from '../src/preferences.js';

const observation=()=>({conversation_url:'https://chatgpt.com/c/fixture-only',surface:'chat',selected_label:'Visible test model',available_options:['Visible test model'],reasoning_label:null,app_available:true,observed_at:now(),verification_status:'verified',source:'host-browser'});
test('Build is the default; retired modes fail across config, preferences and task input',()=>{
  assert.equal(parseConfig({}).workflow.default_mode,'build');
  const f=fixture();try{
    f.store.cancel();
    const input={goal:'generic fixture',scope:['main.js'],acceptance_ids:['A']};
    for(const mode of ['code','hybrid']){
      assert.throws(()=>parseConfig({workflow:{default_mode:mode}}));
      assert.equal(ProjectPreferences.safeParse({schema_version:1,default_mode:mode}).success,false);
      assert.throws(()=>f.store.create({...input,mode}));
    }
    assert.equal(f.store.create(input).mode,'build');f.store.cancel();
    for(const mode of ['plan','build','review']){
      assert.equal(parseConfig({workflow:{default_mode:mode}}).workflow.default_mode,mode);
      assert.equal(ProjectPreferences.parse({schema_version:1,default_mode:mode}).default_mode,mode);
      assert.equal(f.store.create({...input,mode}).mode,mode);f.store.cancel();
    }
    assert.equal(parseConfig({workflow:{default_mode:'research'}}).workflow.default_mode,'research');
    assert.throws(()=>f.store.create({...input,mode:'research'}),/纯网页路径/);
  }finally{f.cleanup();}
});

test('Plan and review cannot become build; historical modes cannot resume execution',()=>{
  const f=fixture();try{
    f.store.cancel();f.store.create({goal:'plan only',scope:['main.js'],acceptance_ids:['A-empty','A-normal'],mode:'plan'});
    planned(f);assert.equal(f.store.task().state,'DONE');assert.throws(()=>beginExecution(f.store),/只有 build/);
    f.store.revoke();f.store.create({goal:'review only',scope:['main.js'],acceptance_ids:['A'],mode:'review'});
    f.store.grant(true);f.store.expose(true);
    assert.throws(()=>prepare(f.store,'plan',observation()),/当前模式不支持/);
    assert.equal(prepare(f.store,'review',observation()).phase,'review');
    for(const mode of ['code','hybrid']){
      const task=f.store.task();(task as any).mode=mode;task.state='PLAN_VALIDATED';f.store.save(task,'historical-fixture');
      assert.throws(()=>beginExecution(f.store),/只有 build/);
      assert.throws(()=>prepare(f.store,'plan',observation()),/当前模式不支持/);
      assert.throws(()=>prepare(f.store,'review',observation()),/当前模式不支持/);
      assert.throws(()=>acceptReply(f.store,{conversation_url:observation().conversation_url,model_label:'Visible test model',reasoning_label:null,text:'{}',source:'host-browser',completed:true}),/旧模式任务/);
    }
  }finally{f.cleanup();}
});
function planned(f:ReturnType<typeof fixture>){
  f.store.grant(true);f.store.expose(true);const r=prepare(f.store,'plan',observation());markSend(f.store,'SENDING',r.message_id);markSend(f.store,'SENT',r.message_id);
  // Controlled protocol simulation, never a real ChatGPT claim.
  fs.appendFileSync(path.join(f.store.taskDir(r.task_id),'reads.jsonl'),['relay_task_context','relay_read_text'].map(tool=>JSON.stringify({tool,message_id:r.message_id,attempt_id:1,relative_file:tool==='relay_read_text'?'main.js':null,at:now()})).join('\n')+'\n');
  const fields={schema_version:1,session_id:r.session_id,workspace_id:r.workspace_id,binding_generation:r.binding_generation,task_id:r.task_id,message_id:r.message_id,phase:'plan',attempt_id:1,plan_id:id(),snapshot_id:r.snapshot_id,expected_reply_marker:r.expected_reply_marker};
  const plan={...fields,understanding:'Fix empty sum',read_evidence:['main.js'],assumptions:[],allowed_scope:['main.js'],steps:['return zero'],risks:[],checks:['node --test'],acceptance_mapping:['A-empty','A-normal'].map(acceptance_id=>({acceptance_id,steps:['test']}))};
  acceptReply(f.store,{conversation_url:r.conversation_url,model_label:r.model_label,reasoning_label:null,text:JSON.stringify(plan),source:'host-browser',completed:true});return plan;
}
test('A04 task diff preserves pre-existing Git edits and redacts deleted lines',()=>{const f=fixture();try{
  const run=(...args:string[])=>{const r=spawnSync('git',args,{cwd:f.project,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};run('init');run('add','main.js','user.txt');run('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');fs.writeFileSync(path.join(f.project,'user.txt'),'existing uncommitted user edit');
  const files=new Files(f.project,f.store.config),base=snapshot(files);fs.writeFileSync(path.join(f.project,'main.js'),'export const total = values => values.reduce((a,b)=>a+b,0);\n');const changes=taskChanges(base,snapshot(files));assert.equal(changes.length,1);assert.equal(changes[0]!.path,'main.js');assert.equal(fs.readFileSync(path.join(f.project,'user.txt'),'utf8'),'existing uncommitted user edit');
  fs.writeFileSync(path.join(f.project,'settings.ts'),'const api_key="sk-proj-FAKESECRETABC123456789012";');run('add','settings.ts');run('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fake fixture only');fs.writeFileSync(path.join(f.project,'settings.ts'),'const api_key="";');assert(!gitChanges(files,'working','settings.ts').text.includes('FAKESECRET'));
}finally{f.cleanup();}});
test('A05 non-Git snapshots include additions, deletions and rename-as-delete/add',()=>{const f=fixture();try{const files=new Files(f.project,f.store.config),base=snapshot(files);fs.renameSync(path.join(f.project,'user.txt'),path.join(f.project,'renamed.txt'));const changes=taskChanges(base,snapshot(files));assert.deepEqual(changes.map(x=>x.kind).sort(),['added','deleted']);assert.throws(()=>gitChanges(files,'working','main.js'));}finally{f.cleanup();}});
test('A06-A09 model policies reject missing, ambiguous and unavailable selections',()=>{
  assert.equal(chooseModel(ModelPolicy.parse({}), 'Current',[]),'Current');assert.throws(()=>chooseModel(ModelPolicy.parse({}),null,[]));assert.throws(()=>chooseModel(ModelPolicy.parse({mode:'exact',exact_label:'Wanted'}),'Other',['Other']));assert.throws(()=>chooseModel(ModelPolicy.parse({mode:'exact',exact_label:'Wanted'}),'Other',['Wanted','Wanted']));assert.equal(chooseModel(ModelPolicy.parse({mode:'prefer',preferred_labels:['B','A']}),'A',['A','B']),'B');
});
test('R01/R03 send intent cannot replay; PLAN can execute only once; cancellation preserves code',()=>{const f=fixture();try{planned(f);assert.throws(()=>markSend(f.store,'SENDING',f.store.task().request!.message_id));beginExecution(f.store);assert.throws(()=>beginExecution(f.store));const before=fs.readFileSync(path.join(f.project,'main.js'),'utf8');f.store.cancel();assert.equal(fs.readFileSync(path.join(f.project,'main.js'),'utf8'),before);}finally{f.cleanup();}});
test('R02 rejects reply mismatch and missing MCP reads',()=>{const f=fixture();try{f.store.grant(true);f.store.expose(true);const r=prepare(f.store,'plan',observation());markSend(f.store,'SENDING',r.message_id);markSend(f.store,'SENT',r.message_id);assert.throws(()=>acceptReply(f.store,{conversation_url:r.conversation_url,model_label:r.model_label,reasoning_label:null,text:'{}',source:'host-browser',completed:true}));assert.equal(f.store.task().state,'WAITING_PLAN');}finally{f.cleanup();}});
test('A11/R04 real Node and Python checks record failure, success, zero tests and timeout',async()=>{const f=fixture();try{
  planned(f);beginExecution(f.store);
  fs.writeFileSync(path.join(f.project,'tests.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {total} from './main.js';test('empty',()=>assert.equal(total([]),0));test('normal',()=>assert.equal(total([1,2]),3));");
  const spec={executable:process.execPath,arguments:['--test','tests.js'],acceptance_ids:['A-empty','A-normal'],timeout_seconds:20};
  const failed=await collect(f.store,spec);assert.equal(failed.status,'failed');assert.equal(failed.test_count,2);
  fs.writeFileSync(path.join(f.project,'main.js'),'export const total = values => values.reduce((a,b)=>a+b,0);\n');
  const passed=await collect(f.store,spec);assert.equal(passed.status,'passed');assert.equal(passed.test_count,2);assert.equal(passed.before_snapshot,passed.after_snapshot);
  const zero=await collect(f.store,{...spec,arguments:['-e',"console.log('# tests 0')"]});assert.equal(zero.test_count,0);
  const timeout=await collect(f.store,{...spec,arguments:['-e','setInterval(()=>{},1000)'],timeout_seconds:2});assert.equal(timeout.status,'timeout');
  fs.writeFileSync(path.join(f.project,'test_math.py'),'import unittest\nclass T(unittest.TestCase):\n def test_sum(self): self.assertEqual(sum([1,2]),3)\nif __name__ == "__main__": unittest.main()\n');
  const py=await collect(f.store,{...spec,executable:'python',arguments:['test_math.py']});assert.equal(py.status,'passed');assert.equal(py.test_count,1);
}finally{f.cleanup();}});
test('R05 source drift during checks is marked STALE',async()=>{const f=fixture();try{planned(f);beginExecution(f.store);const result=await collect(f.store,{executable:process.execPath,arguments:['-e',"require('fs').appendFileSync('main.js','// concurrent edit')"],acceptance_ids:['A-empty'],timeout_seconds:20});assert.equal(result.freshness,'STALE');assert.equal(f.store.task().state,'NEEDS_USER');}finally{f.cleanup();}});
test('A13 review mode cannot run collector; R08 cancellation never replays changes',async()=>{const f=fixture();try{f.store.cancel();f.store.create({goal:'review',scope:['main.js'],acceptance_ids:['A'],mode:'review'});await assert.rejects(collect(f.store,{executable:process.execPath,arguments:['-e','process.exit(0)'],acceptance_ids:['A']}));}finally{f.cleanup();}});

function reviewReply(f:ReturnType<typeof fixture>,verdict:'pass'|'changes_requested'){
  const r=prepare(f.store,'review',observation());markSend(f.store,'SENDING',r.message_id);markSend(f.store,'SENT',r.message_id);
  fs.appendFileSync(path.join(f.store.taskDir(r.task_id),'reads.jsonl'),['relay_read_changes','relay_read_checks'].map(tool=>JSON.stringify({tool,message_id:r.message_id,attempt_id:r.attempt_id,requested_attempt_id:r.attempt_id,snapshot_id:r.snapshot_id,at:now()})).join('\n')+'\n');
  return {conversation_url:r.conversation_url,model_label:r.model_label,reasoning_label:null,source:'host-browser' as const,completed:true,text:JSON.stringify({schema_version:1,session_id:r.session_id,workspace_id:r.workspace_id,binding_generation:r.binding_generation,task_id:r.task_id,message_id:r.message_id,phase:'review',attempt_id:r.attempt_id,plan_id:r.plan_id,snapshot_id:r.snapshot_id,expected_reply_marker:r.expected_reply_marker,verdict,files:['main.js'],changes_read:['task'],checks_read:['collector'],acceptance_results:['A-empty','A-normal'].map(acceptance_id=>({acceptance_id,verdict:'pass',evidence:['fixture checks']})),findings:[],limitations:['SIMULATION ONLY']})};
}
test('P3/P4 SIMULATED protocol with real check: DONE revokes grant and detects later drift',async()=>{const f=fixture();try{
  fs.writeFileSync(path.join(f.project,'tests.js'),"import test from 'node:test';import assert from 'node:assert/strict';import {total} from './main.js';test('empty',()=>assert.equal(total([]),0));test('normal',()=>assert.equal(total([1,2]),3));");
  planned(f);beginExecution(f.store);const spec={executable:process.execPath,arguments:['--test','tests.js'],acceptance_ids:['A-empty','A-normal'],timeout_seconds:20};
  assert.equal((await collect(f.store,spec)).status,'failed');fs.writeFileSync(path.join(f.project,'main.js'),'export const total = values => values.reduce((a,b)=>a+b,0);');assert.equal((await collect(f.store,spec)).status,'passed');
  const done=acceptReply(f.store,reviewReply(f,'pass'));assert.equal(done.state,'DONE');assert.equal(done.cap_hash,null);
  fs.appendFileSync(path.join(f.project,'main.js'),'// later change');assert.notEqual(f.store.currentSnapshot().id,done.review_snapshot);
}finally{f.cleanup();}});
test('A15 controlled repair cap counts one repair after initial implementation',async()=>{const f=fixture();try{planned(f);beginExecution(f.store);const spec={executable:process.execPath,arguments:['-e','process.exit(0)'],acceptance_ids:['A-empty','A-normal'],kind:'custom',timeout_seconds:20};await collect(f.store,spec);assert.equal(acceptReply(f.store,reviewReply(f,'changes_requested')).repair_rounds,1);assert.equal(f.store.task().attempt_id,2);await collect(f.store,spec);const result=acceptReply(f.store,reviewReply(f,'changes_requested'));assert.equal(result.state,'NEEDS_USER');assert(result.blockers.includes('REPAIR_LIMIT_REACHED'));}finally{f.cleanup();}});
test('R05 rejects REVIEW for old snapshot despite a pass verdict',async()=>{const f=fixture();try{planned(f);beginExecution(f.store);await collect(f.store,{executable:process.execPath,arguments:['-e','process.exit(0)'],acceptance_ids:['A-empty','A-normal'],kind:'custom',timeout_seconds:20});const reply=reviewReply(f,'pass');fs.appendFileSync(path.join(f.project,'main.js'),'// changed after review request');assert.throws(()=>acceptReply(f.store,reply),/项目已改变/);}finally{f.cleanup();}});
test('R08 cancelling a running check stops its owned process and preserves source',async()=>{const f=fixture();try{planned(f);beginExecution(f.store);const before=fs.readFileSync(path.join(f.project,'main.js'),'utf8');const pending=collect(f.store,{executable:process.execPath,arguments:['-e','setInterval(()=>{},1000)'],acceptance_ids:['A-empty'],timeout_seconds:20});const timer=setTimeout(()=>f.store.cancel(),1500);const result=await pending;clearTimeout(timer);assert.equal(result.status,'skipped');assert(result.cancelled);assert.equal(f.store.task().state,'CANCELLED');assert.equal(fs.readFileSync(path.join(f.project,'main.js'),'utf8'),before);}finally{f.cleanup();}});
