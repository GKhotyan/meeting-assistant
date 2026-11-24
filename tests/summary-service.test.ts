import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller } from '../src/session/controller';
import { DeepgramSettings } from '../src/integrations/deepgram';
import { AISettings } from '../src/integrations/ai';
import { Transcriptions } from '../src/transcription/service';
import { Summaries, transcriptFingerprint } from '../src/summary/service';
const response=()=>Response.json({choices:[{message:{content:'## Решения\nВыпустить обновление.'},finish_reason:'stop'}]});
function fixture(transport: typeof fetch=async()=>response()) {
 const root=mkdtempSync(join(tmpdir(),'summary-')),dir=join(root,'recordings','Daily_test-id');mkdirSync(dir,{recursive:true});
 const session={id:'test-id',meetingName:'Daily',botName:'Notes',status:'completed',createdAt:'2026-11-17T08:00:00Z',summaryPrompt:'Только решения',summaryPromptSource:'custom',files:[]};
 const transcript={audioFileId:'audio',audioFile:'audio.webm',language:'ru',diarize:false,model:'nova-3' as const,createdAt:'2026-11-17T09:00:00Z',text:'Выпустить обновление.',segments:[]};
 writeFileSync(join(dir,'session.json'),JSON.stringify(session));writeFileSync(join(dir,'transcription.json'),JSON.stringify({status:'completed',transcript}));
 const controller=new Controller(root,()=>{throw Error();}),ai=new AISettings(root);ai.save({provider:'openai',model:'gpt-4.1',apiKey:'fixture-secret'});
 const transcriptions=new Transcriptions(controller,new DeepgramSettings(root));
 return {root,dir,controller,ai,transcriptions,transcript,service:new Summaries(controller,transcriptions,ai,transport)};
}
async function finish(service: Summaries) { for(let i=0;i<100;i++) { if(!service.isRunning('test-id'))return service.get('test-id');await new Promise(r=>setTimeout(r,5)); }throw Error('job did not finish'); }

test('snapshots input and preferences, atomically persists successful result and never generates on read',async()=>{
 let calls=0,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const f=fixture(async(_url,options)=>{calls++;await gate;const body=JSON.parse(options!.body as string);assert.equal(body.model,'gpt-4.1');assert.match(body.messages[0].content,/Только решения/);return response();});
 assert.equal(f.service.get('test-id').status,'idle');assert.equal(calls,0);
 assert.equal(f.service.start('test-id',{}).status,'processing');
 f.ai.save({provider:'zai',model:'glm-4.7'});assert.throws(()=>f.service.start('test-id',{}),/progress/i);
 release();const state=await finish(f.service);
 assert.equal(state.status,'completed');assert.equal(state.result?.provider,'openai');assert.equal(state.result?.prompt,'Только решения');
 assert.equal(state.result?.transcriptHash,transcriptFingerprint(f.transcript));assert.equal(state.result?.requests,1);
 assert.match(state.result?.text!,/Выпустить/);assert.equal(state.stale,false);
 assert.equal(new Summaries(f.controller,f.transcriptions,f.ai).get('test-id').result?.text,state.result?.text);
 assert.equal(readFileSync(join(f.dir,'summary.json'),'utf8').includes('fixture-secret'),false);
 assert.equal(calls,1);
});

test('requires explicit regeneration confirmation and preserves earlier result on failure and interruption',async()=>{
 let fail=false;const f=fixture(async()=>fail?new Response('fixture-secret',{status:401}):response());
 f.service.start('test-id',{});const first=await finish(f.service);
 assert.throws(()=>f.service.start('test-id',{}),/confirm|again/i);
 fail=true;f.service.start('test-id',{regenerate:true});const failed=await finish(f.service);
 assert.equal(failed.status,'failed');assert.deepEqual(failed.result,first.result);assert.equal(JSON.stringify(failed).includes('fixture-secret'),false);
 writeFileSync(join(f.dir,'summary.json'),JSON.stringify({...failed,status:'processing'}));
 const restored=new Summaries(f.controller,f.transcriptions,f.ai);assert.equal(restored.get('test-id').status,'interrupted');assert.match(restored.get('test-id').error!,/charged/i);assert.deepEqual(restored.get('test-id').result,first.result);
});

test('rejects incomplete, empty and invalid input before generation and reports stale transcript',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return response();});
 for(const input of [null,[],{regenerate:'yes'},{unexpected:true}])assert.throws(()=>f.service.start('test-id',input));
 assert.throws(()=>f.service.start('missing',{}));
 f.ai.remove('openai');assert.throws(()=>f.service.start('test-id',{}),/key/i);f.ai.save({provider:'openai',model:'gpt-4.1',apiKey:'fixture-secret'});
 for(const value of [{status:'processing',transcript:f.transcript},{status:'failed',transcript:f.transcript},{status:'completed',transcript:{...f.transcript,text:'  '}}]) {
  writeFileSync(join(f.dir,'transcription.json'),JSON.stringify(value));assert.throws(()=>f.service.start('test-id',{}));
 }
 assert.equal(calls,0);writeFileSync(join(f.dir,'transcription.json'),JSON.stringify({status:'completed',transcript:f.transcript}));
 f.service.start('test-id',{});await finish(f.service);
 writeFileSync(join(f.dir,'transcription.json'),JSON.stringify({status:'completed',transcript:{...f.transcript,text:'Другое решение.'}}));
 assert.equal(f.service.get('test-id').stale,true);
});

test('legacy recordings use default instructions without altering session metadata',async()=>{
 const f=fixture();const path=join(f.dir,'session.json'),value=JSON.parse(readFileSync(path,'utf8'));delete value.summaryPrompt;delete value.summaryPromptSource;writeFileSync(path,JSON.stringify(value));
 const controller=new Controller(f.root,()=>{throw Error();});const service=new Summaries(controller,new Transcriptions(controller,new DeepgramSettings(f.root)),f.ai,async()=>response());
 service.start('test-id',{});const state=await finish(service);assert.match(state.result?.prompt!,/Action items/);assert.equal(state.result?.promptSource,'default');assert.equal(JSON.parse(readFileSync(path,'utf8')).summaryPrompt,undefined);
});

test('summary storage refuses symlinks and malformed saved results',()=>{
 const f=fixture(),path=join(f.dir,'summary.json');
 writeFileSync(path,JSON.stringify({status:'completed',result:{text:42}}));assert.throws(()=>f.service.get('test-id'),/saved summary/i);
 unlinkSync(path);const target=join(f.root,'outside.json');writeFileSync(target,'{"status":"idle"}');symlinkSync(target,path);assert.throws(()=>f.service.get('test-id'),/saved summary/i);
});

test('summary source preserves diarized speaker turns alongside all transcript text',async()=>{
 const f=fixture(async(_url,options)=>{
  const source=JSON.parse(options!.body as string).messages[1].content;
  assert.ok(source.includes('I will send it Friday. I disagree. Final text not present in segments.'));
  assert.match(source,/Speaker 1.*I will send it Friday\./);
  assert.match(source,/Speaker 2.*I disagree\./);
  assert.match(source,/anonymous|identif/i);
  return response();
 });
 const transcript={...f.transcript,diarize:true,text:'I will send it Friday. I disagree. Final text not present in segments.',segments:[{start:1,end:3,text:'I will send it Friday.',speaker:0},{start:3,end:5,text:'I disagree.',speaker:1}]};
 writeFileSync(join(f.dir,'transcription.json'),JSON.stringify({status:'completed',transcript}));
 f.service.start('test-id',{});assert.equal((await finish(f.service)).status,'completed');
});

test('generation uses current linked schedule instructions, detects prompt changes and keeps in-flight/result provenance',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let seen='';
 const f=fixture();
 const schedules=[{id:'schedule-daily',name:'Daily renamed',summaryPrompt:'## Основные итоги: без имён',lastRun:{sessionId:'test-id'}}];
 const service=new Summaries(f.controller,f.transcriptions,f.ai,async(_url,options)=>{seen=JSON.parse(options!.body as string).messages[0].content;await gate;return response();},()=>schedules);
 const idle=service.get('test-id');assert.equal(idle.instructions?.prompt,schedules[0].summaryPrompt);assert.equal(idle.instructions?.promptOrigin,'schedule');
 service.start('test-id',{});schedules[0].summaryPrompt='New instructions after launch';release();
 const first=await finish(service);assert.equal(first.status,'completed');assert.match(seen,/без имён/);assert.equal(first.result?.prompt,'## Основные итоги: без имён');assert.equal(first.result?.scheduleId,'schedule-daily');assert.equal(first.instructionsChanged,true);assert.equal(first.stale,true);
 service.start('test-id',{regenerate:true});const next=await finish(service);assert.equal(next.result?.prompt,'New instructions after launch');assert.equal(next.instructionsChanged,false);assert.equal(next.stale,false);
});

test('explicit schedule identity survives rename and never guesses a replacement after deletion',async()=>{
 const f=fixture();f.controller.associateSchedule('test-id','source-schedule');
 const restored=new Controller(f.root,()=>{throw Error();});assert.equal(restored.getSession('test-id')?.scheduleId,'source-schedule');
 let schedules=[{id:'source-schedule',name:'Renamed',summaryPrompt:'Latest instructions'}];
 const service=new Summaries(restored,f.transcriptions,f.ai,async()=>response(),()=>schedules);
 assert.equal(service.get('test-id').instructions?.prompt,'Latest instructions');
 schedules=[{id:'other-schedule',name:'Daily',summaryPrompt:'Must not use'}];
 assert.equal(service.get('test-id').instructions?.prompt,'Только решения');assert.equal(service.get('test-id').instructions?.promptOrigin,'recording');
});
