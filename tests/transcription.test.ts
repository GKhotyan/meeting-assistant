import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller } from '../src/session/controller';
import { DeepgramSettings } from '../src/integrations/deepgram';
import { Transcriptions } from '../src/transcription/service';

const response = () => Response.json({results:{channels:[{alternatives:[{transcript:'Привет, команда.'}]}],utterances:[{start:1.2,end:3.4,transcript:'Привет, команда.',speaker:0}]}});
function fixture(transport: typeof fetch = async () => response()) {
  const root = mkdtempSync(join(tmpdir(),'transcription-'));
  const dir = join(root,'recordings','Daily_test-id');
  mkdirSync(dir,{recursive:true});
  const session = {id:'test-id',meetingName:'Daily',botName:'Notes',status:'completed',createdAt:'2026-11-17T08:00:00Z',files:[{id:'audio',name:'audio.webm',kind:'audio',status:'ready',bytes:5,startedAtMs:0}]};
  writeFileSync(join(dir,'session.json'),JSON.stringify(session));
  writeFileSync(join(dir,'audio.webm'),'audio');
  const controller = new Controller(root,()=>{throw Error('no worker');});
  const settings = new DeepgramSettings(root); settings.save('fixture-secret');
  return {root,dir,controller,settings,service:new Transcriptions(controller,settings,transport)};
}
async function finished(service: Transcriptions) {
  for(let i=0;i<100;i++) {
    const state = service.get('test-id');
    if(state.status!=='processing') return state;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('job did not finish');
}

test('streams selected finalized audio with chosen options and persists normalized timestamps/speakers',async()=>{
  const f = fixture(async(url,options)=>{
    const parsed = new URL(String(url));
    assert.equal(parsed.origin+parsed.pathname,'https://api.deepgram.com/v1/listen');
    assert.equal(parsed.searchParams.get('model'),'nova-3');
    assert.equal(parsed.searchParams.get('language'),'ru');
    assert.equal(parsed.searchParams.get('utterances'),'true');
    assert.equal(parsed.searchParams.get('smart_format'),'true');
    assert.equal(parsed.searchParams.get('diarize_model'),'latest');
    assert.equal((options!.headers as any).Authorization,'Token fixture-secret');
    assert.equal(options!.method,'POST'); assert.equal(options!.redirect,'error');
    assert.ok(options!.signal);
    const chunks=[]; for await (const chunk of options!.body as any) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(),'audio');
    return response();
  });
  assert.equal(f.service.get('test-id').status,'idle');
  assert.equal(f.service.start('test-id',{audioFileId:'audio',language:'ru',diarize:true}).status,'processing');
  const result=await finished(f.service);
  assert.equal(result.status,'completed');
  assert.equal(result.transcript?.text,'Привет, команда.');
  assert.deepEqual(result.transcript?.segments,[{start:1.2,end:3.4,text:'Привет, команда.',speaker:0}]);
  assert.equal(new Transcriptions(f.controller,f.settings).get('test-id').transcript?.text,'Привет, команда.');
  assert.equal(readFileSync(join(f.dir,'transcription.json'),'utf8').includes('fixture-secret'),false);
});

test('rejects duplicate jobs and recovers interrupted state without automatic paid retry',async()=>{
  let release!:()=>void;
  const gate = new Promise<void>(resolve=>{release=resolve;});
  const f=fixture(async()=>{await gate;return response();});
  f.service.start('test-id',{});
  assert.throws(()=>f.service.start('test-id',{}),/already|progress/i);
  assert.equal(f.service.isRunning('test-id'),true);
  const restored=new Transcriptions(f.controller,f.settings);
  assert.equal(restored.get('test-id').status,'interrupted');
  assert.match(restored.get('test-id').error!,/charged|processed/i);
  release(); await finished(f.service);
  assert.equal(f.service.isRunning('test-id'),false);
});

test('rejects unsafe, absent, partial, empty, invalid options and unfinished meeting before transport',()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;return response();});
  for(const input of [null,[],{language:'invalid'},{diarize:'yes'},{audioFileId:'missing'}]) assert.throws(()=>f.service.start('test-id',input));
  assert.throws(()=>f.service.start('missing',{}));
  f.settings.remove(); assert.throws(()=>f.service.start('test-id',{}),/key/i); f.settings.save('fixture-secret');
  writeFileSync(join(f.dir,'audio.webm'),''); assert.throws(()=>f.service.start('test-id',{}));
  unlinkSync(join(f.dir,'audio.webm'));
  const external=join(f.root,'external.webm');writeFileSync(external,'secret'); symlinkSync(external,join(f.dir,'audio.webm'));
  assert.throws(()=>f.service.start('test-id',{}));
  for(const change of [{status:'recording'},{files:[{id:'audio',name:'../external.webm',kind:'audio',status:'ready'}]},{files:[{id:'audio',name:'audio.webm',kind:'audio',status:'partial'}]}]){
    const current=JSON.parse(readFileSync(join(f.dir,'session.json'),'utf8'));
    writeFileSync(join(f.dir,'session.json'),JSON.stringify({...current,...change}));
    assert.throws(()=>new Transcriptions(new Controller(f.root,()=>{throw Error();}),f.settings).start('test-id',{}));
  }
  assert.equal(calls,0);
});

test('failed retries preserve successful transcript and redact service bodies/errors',async()=>{
  let fail=false;
  const f=fixture(async()=> fail ? new Response('fixture-secret',{status:401}) : response());
  f.service.start('test-id',{}); await finished(f.service); fail=true;
  f.service.start('test-id',{});
  const state=await finished(f.service);
  assert.equal(state.status,'failed'); assert.match(state.error!,/key/i);
  assert.equal(state.transcript?.text,'Привет, команда.');
  assert.equal(JSON.stringify(state).includes('fixture-secret'),false);
});

test('rejects malformed timing and results, handles network failure and empty speech safely',async()=>{
  for(const transport of [async()=>Response.json({}),async()=>Response.json({results:{channels:[{alternatives:[{transcript:'text'}]}],utterances:[{start:-1,end:2,transcript:'bad'}]}}),async()=>{throw Error('fixture-secret');}]) {
    const f=fixture(transport); f.service.start('test-id',{});
    const state=await finished(f.service); assert.equal(state.status,'failed'); assert.equal(JSON.stringify(state).includes('fixture-secret'),false);
  }
  const f=fixture(async()=>Response.json({results:{channels:[{alternatives:[{transcript:''}]}]}}));
  f.service.start('test-id',{}); const state=await finished(f.service);
  assert.equal(state.status,'completed'); assert.equal(state.transcript?.text,''); assert.deepEqual(state.transcript?.segments,[]);
});

test('native fetch streams the audio body over HTTP with correct length',async()=>{
  const {createServer}=await import('node:http');
  let received='';
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    received=Buffer.concat(chunks).toString();
    assert.equal(req.headers['content-length'],'5');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({results:{channels:[{alternatives:[{transcript:'Native upload'}]}]}}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as any;
  try {
    const f=fixture((_url,options)=>fetch('http://127.0.0.1:'+address.port,options));
    f.service.start('test-id',{});
    assert.equal((await finished(f.service)).transcript?.text,'Native upload');
    assert.equal(received,'audio');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
