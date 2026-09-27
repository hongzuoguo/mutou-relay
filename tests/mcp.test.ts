import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.js';
import { repoRoot } from '../src/collector.js';
import { safeEnv } from '../src/evidence.js';

test('P2 real stdio MCP has seven strict read-only tools; grants, cursor, filtering and revocation',async()=>{
  const f=fixture();const grant=f.store.grant(true);f.store.expose(true);const task=f.store.task();
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(repoRoot,'dist/src/cli.js'),'mcp'],env:{...safeEnv(),MUTOU_RELAY_HOME:f.base} as Record<string,string>,stderr:'pipe'});const client=new Client({name:'fixture-client',version:'1'});
  try{
    await client.connect(transport);const tools=await client.listTools();assert.equal(tools.tools.length,7);assert(tools.tools.every(x=>x.annotations?.readOnlyHint));assert(tools.tools.every(x=>x.outputSchema));
    const second=new Client({name:'second-fixture',version:'1'});const secondTransport=new StdioClientTransport({command:process.execPath,args:[path.join(repoRoot,'dist/src/cli.js'),'mcp'],env:{...safeEnv(),MUTOU_RELAY_HOME:f.base} as Record<string,string>,stderr:'pipe'});try{await assert.rejects(second.connect(secondTransport));}finally{await second.close();}
    const auth={capability:grant.capability,workspace_id:task.workspace_id,binding_generation:task.generation,task_id:task.task_id};
    const call=(name:string,args:object={})=>client.callTool({name,arguments:{...auth,...args}});
    const info=await call('relay_project_info');assert(!info.isError);assert(!JSON.stringify(info).includes(f.project));
    const read=await call('relay_read_text',{file:'token.ts'});assert(!read.isError);assert(JSON.stringify(read).includes('safe name'));
    fs.writeFileSync(path.join(f.project,'settings.ts'),'const api_key="sk-proj-FAKESECRETABC123456789012";');const hidden=await call('relay_read_text',{file:'settings.ts'});assert(!hidden.isError);assert(!JSON.stringify(hidden).includes('FAKESECRET'));
    assert((await call('relay_read_text',{file:'.env'})).isError);assert((await call('relay_read_text',{file:'../outside'})).isError);assert((await call('relay_read_text',{file:'token.ts',unexpected:'x'})).isError);
    const list=await call('relay_list_paths',{count:1});const data:any=list.structuredContent;assert(data.next_cursor);assert(data.truncated);
    const next=await call('relay_list_paths',{count:1,cursor:data.next_cursor});assert(!next.isError);
    assert((await call('relay_list_paths',{directory:'different',count:1,cursor:data.next_cursor})).isError);
    fs.writeFileSync(path.join(f.project,'new.ts'),'new');assert((await call('relay_list_paths',{count:1,cursor:data.next_cursor})).isError);
    const search=await call('relay_find_text',{query:'user edits'});assert(!search.isError);assert(JSON.stringify(search).includes('user.txt'));
    const changes=await call('relay_read_changes',{comparison:'task'});assert(!changes.isError);assert(JSON.stringify(changes).includes('new.ts'));
    assert(!(await call('relay_read_checks',{attempt_id:1})).isError);assert(!(await call('relay_task_context')).isError);
    f.store.cancel();assert((await call('relay_project_info')).isError);
  }finally{await client.close();await new Promise(r=>setTimeout(r,100));f.cleanup();}
});
test('S07 previous task grants cannot read new binding',()=>{const f=fixture();try{const t=f.store.task();const grant=f.store.grant(true);f.store.expose(true);f.store.cancel();f.store.revoke();const other=path.join(f.parent,'Python 另一个');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'main.py'),'print(1)');f.store.select(other);f.store.create({goal:'review',scope:['main.py'],acceptance_ids:['A'],mode:'review'});f.store.grant(true);f.store.expose(true);assert.throws(()=>f.store.authorize(grant.capability,t.workspace_id,t.generation,t.task_id));}finally{f.cleanup();}});
