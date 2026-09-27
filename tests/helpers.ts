import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, noLinks } from '../src/core.js';
import { Store } from '../src/store.js';
export function fixture(){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'mutou-test-'));const project=path.join(parent,'中文 项目 (&)');const base=path.join(parent,'私有 数据 (&)');fs.mkdirSync(project);init(base);
  fs.writeFileSync(path.join(project,'main.js'),'export const total = values => values.reduce((a,b)=>a+b);\n');
  fs.writeFileSync(path.join(project,'user.txt'),'user edits already here\n');
  fs.writeFileSync(path.join(project,'.env'),'API_KEY=sk-proj-FAKESECRETFORTESTING123456789\n');
  fs.writeFileSync(path.join(project,'token.ts'),'export const tokenType = "safe name";\n');
  const store=new Store(base);store.select(project);store.create({goal:'修复空数组求和',scope:['main.js','tests.js'],acceptance_ids:['A-empty','A-normal'],mode:'build'});
  return {parent,project,base,store,cleanup(){noLinks(parent);if(!path.basename(parent).startsWith('mutou-test-'))throw new Error('unsafe cleanup');fs.rmSync(parent,{recursive:true,force:true});}};
}
