import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AISettings, checkAI } from '../src/integrations/ai';
import { CredentialStore, DeepgramSettings } from '../src/integrations/deepgram';
const root = () => mkdtempSync(join(tmpdir(), 'ai-settings-'));

test('AI provider keys coexist with legacy Deepgram credentials through updates and removal', () => {
 const dir=root(), dg=new DeepgramSettings(dir); dg.save('dg-secret');
 const ai=new AISettings(dir);
 ai.save({provider:'openai',model:'gpt-4.1',effort:'default',apiKey:'openai-secret'});
 ai.save({provider:'zai',model:'glm-4.7',effort:'default',apiKey:'zai-secret'});
 const restarted=new AISettings(dir);
 assert.equal(restarted.metadata().provider,'zai');
 assert.equal(restarted.key('openai'),'openai-secret');
 assert.equal(restarted.key('zai'),'zai-secret');
 dg.save('dg-replaced');
 assert.equal(restarted.key('openai'),'openai-secret');
 restarted.remove('zai');
 assert.equal(restarted.key('zai'),'');
 assert.equal(restarted.metadata().providers.zai.model,'glm-4.7');
 assert.equal(dg.key(),'dg-replaced');
 assert.equal(JSON.stringify(restarted.metadata()).includes('secret'),false);
 assert.equal(readFileSync(join(dir,'settings/api-keys.json'),'utf8').includes('secret'),false);
});
test('AI preferences persist independently and invalid updates cannot replace keys', () => {
 const dir=root(), ai=new AISettings(dir);
 ai.save({provider:'openai',model:'gpt-4.1',effort:'default',apiKey:'original'});
 ai.save({provider:'openai',model:'gpt-5',effort:'high'});
 assert.equal(new AISettings(dir).metadata().providers.openai.model,'gpt-5');
 assert.equal(ai.key('openai'),'original');
 for(const value of [null,[],{provider:'other',model:'x'}, {provider:'openai',model:''}, {provider:'openai',model:'x',effort:'invalid'}, {provider:'openai',model:'x',apiKey:'a\nb'}]) assert.throws(()=>ai.save(value));
 assert.equal(ai.key('openai'),'original');
 assert.equal(ai.metadata().providers.openai.model,'gpt-5');
});
test('provider checks only list models with bounded responses and sanitized failures', async () => {
 for(const provider of ['openai','zai'] as const){
  const result=await checkAI(provider,'fixture-secret',async(url,options)=>{
   assert.equal(url,provider==='openai'?'https://api.openai.com/v1/models':'https://api.z.ai/api/paas/v4/models');
   assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer fixture-secret');
   assert.equal(options?.body,undefined);assert.equal(options?.redirect,'error');assert.ok(options?.signal);
   return Response.json({data:[{id:'test-model'}]});
  });assert.equal(result.valid,true);
  for(const transport of [async()=>new Response('fixture-secret',{status:401}),async()=>Response.json({}),async()=>{throw Error('fixture-secret')},async()=>new Response('x'.repeat(1048577))]){
   const result=await checkAI(provider,'fixture-secret',transport);
   assert.equal(result.valid,false);assert.equal(JSON.stringify(result).includes('fixture-secret'),false);
  }
 }
});

test('AI updates never replace encrypted credentials after master key loss or tampering', () => {
 for(const kind of ['missing','tampered']){
  const dir=root(),ai=new AISettings(dir);
  ai.save({provider:'openai',model:'gpt-4.1',apiKey:'original'});
  const before=readFileSync(join(dir,'settings/api-keys.json'),'utf8');
  if(kind==='missing')unlinkSync(join(dir,'secrets/master.key'));
  else writeFileSync(join(dir,'settings/api-keys.json'),before.replace(/"tag":"[^"]+"/,'"tag":"AAAAAAAAAAAAAAAAAAAAAA=="'));
  const damaged=readFileSync(join(dir,'settings/api-keys.json'),'utf8');
  assert.throws(()=>ai.save({provider:'zai',model:'glm-4.7',apiKey:'replacement'}),/decrypt|encryption/i);
  assert.equal(readFileSync(join(dir,'settings/api-keys.json'),'utf8'),damaged);
 }
});

test('damaged AI preferences fail closed without deleting provider credentials', () => {
 const dir=root(),ai=new AISettings(dir),store=new CredentialStore(dir);
 ai.save({provider:'openai',model:'gpt-4.1',apiKey:'original'});
 store.write({...store.read(),ai:{provider:'unknown'}});
 const before=readFileSync(join(dir,'settings/api-keys.json'),'utf8');
 assert.throws(()=>ai.metadata(),/damaged/i);
 assert.throws(()=>ai.remove('openai'),/damaged/i);
 assert.equal(readFileSync(join(dir,'settings/api-keys.json'),'utf8'),before);
});

test('editing provider settings does not switch active provider and switching preserves both saved configurations', () => {
 const dir=root(),ai=new AISettings(dir);
 ai.save({provider:'zai',model:'glm-4.7',apiKey:'z-secret'});
 ai.save({provider:'openai',model:'gpt-5',effort:'high',apiKey:'o-secret',activate:false});
 assert.equal(ai.metadata().provider,'zai');
 const before=ai.metadata().providers;
 assert.equal(ai.select('openai').provider,'openai');
 assert.deepEqual(ai.metadata().providers,before);
 assert.equal(ai.key('openai'),'o-secret');assert.equal(ai.key('zai'),'z-secret');
 assert.equal(new AISettings(dir).metadata().provider,'openai');
 for(const activate of [null,'false',1])assert.throws(()=>ai.save({provider:'zai',model:'glm-4.7',activate}));
 assert.throws(()=>ai.select('invalid' as any));
 assert.equal(ai.metadata().provider,'openai');
});
