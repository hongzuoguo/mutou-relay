import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const output=path.join(root,'licenses','npm');fs.mkdirSync(output,{recursive:true});
const rows=[];
for(const [folder,meta] of Object.entries(lock.packages)){
  if(!folder||!folder.startsWith('node_modules/')||!meta.version)continue;
  const dir=path.join(root,folder);if(!fs.existsSync(dir))continue;
  const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const names=fs.readdirSync(dir).filter(n=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(n)&&fs.statSync(path.join(dir,n)).isFile());
  if(!names.length)throw new Error('Missing dependency license: '+pkg.name);
  const dest=pkg.name.replaceAll('/','__')+'@'+meta.version+'.txt';
  fs.writeFileSync(path.join(output,dest),names.map(n=>`File: ${n}\n\n${fs.readFileSync(path.join(dir,n),'utf8')}`).join('\n\n'));
  rows.push(`| ${pkg.name} | ${meta.version} | ${pkg.license??meta.license??'See license'} | [text](licenses/npm/${dest}) |`);
}
fs.writeFileSync(path.join(root,'THIRD-PARTY-NOTICES.md'),'# Dependency notices\n\nDependency licenses are preserved verbatim in licenses/npm. These are dependencies, not a borrowed Skill implementation.\n\n| Package | Locked version | License | Text |\n|---|---|---|---|\n'+rows.join('\n')+'\n\nThe separately downloaded official OpenAI tunnel-client package retains LICENSE, NOTICE, its Windows license inventory and SPDX file in the private bin directory. No signature verification is claimed; release ZIP SHA-256 was checked.\n');
console.log(`Preserved ${rows.length} installed package licenses.`);
