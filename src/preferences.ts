import fs from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
import { ModelPolicy, atomic, fail, hash, json } from './core.js';
import { Files } from './security.js';
import type { Store } from './store.js';
export const ProjectPreferences=z.object({schema_version:z.literal(1),model_policy:ModelPolicy.optional(),default_mode:z.enum(['plan','build','review']).optional()}).strict();
function read(store:Store){const b=store.binding();const content=new Files(b.root,store.config).read('.mutou-relay.yaml');return {value:ProjectPreferences.parse(YAML.parse(content.text)),fingerprint:content.hash,workspace_id:b.workspace_id};}
export function trustProject(store:Store,confirmed:boolean){if(!confirmed)fail('PROJECT_TRUST_REQUIRED','首次项目偏好需要本地明确确认');if(fs.existsSync(store.file('runtime.lock')))fail('INSTANCE_BUSY','停止 Runtime 后才能信任新配置');const data=read(store);atomic(store.file('trusted-project.json'),{workspace_id:data.workspace_id,fingerprint:data.fingerprint});return {trusted:true,allowed_fields:['model_policy','default_mode']};}
export function projectPreferences(store:Store){
  if(!fs.existsSync(store.file('trusted-project.json')))return {} as z.infer<typeof ProjectPreferences>;
  const trust=json<{workspace_id:string;fingerprint:string}>(store.file('trusted-project.json'));if(trust.workspace_id!==store.binding().workspace_id)return {} as z.infer<typeof ProjectPreferences>;
  const current=read(store);if(current.fingerprint!==trust.fingerprint)fail('PROJECT_TRUST_REQUIRED','项目偏好发生变化，需重新确认；没有自动扩大权限');return current.value;
}
