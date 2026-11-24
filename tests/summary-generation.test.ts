import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelPolicy, splitText } from '../src/summary/model';
import { generateSummary } from '../src/summary/generate';

const reply = (text = '## Decisions\n- Выпустить обновление.', reason = 'stop') => Response.json({ choices: [{ message: { content: text }, finish_reason: reason }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
const base = { provider: 'openai' as const, model: 'gpt-4.1', effort: 'default', apiKey: 'fixture-secret', prompt: 'Решения и задачи', transcript: 'Команда решила выпустить обновление.' };

test('sends transcript and instructions to fixed provider endpoint with bounded output and no retries', async () => {
  let calls = 0;
  const result = await generateSummary(base, async (url, options) => {
    calls++; assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    assert.equal((options!.headers as any).Authorization, 'Bearer fixture-secret');
    assert.equal(options!.redirect, 'error'); assert.ok(options!.signal);
    const body = JSON.parse(options!.body as string);
    assert.equal(body.model, 'gpt-4.1'); assert.equal(body.max_completion_tokens, 8192);
    assert.equal(body.reasoning_effort, undefined); assert.equal(body.stream, false);
    assert.ok(body.messages[0].content.includes(base.prompt));
    assert.ok(body.messages[1].content.includes(base.transcript));
    return reply();
  });
  assert.equal(calls, 1); assert.match(result.text, /Выпустить/); assert.equal(result.requests, 1);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 });
});

test('uses model-specific effort parameters and rejects unsupported preferences before paid calls', async () => {
  assert.deepEqual(modelPolicy('openai','gpt-5','high').parameters, { reasoning_effort: 'high' });
  assert.deepEqual(modelPolicy('zai','glm-4.7','high').parameters, { thinking: { type: 'enabled' } });
  assert.deepEqual(modelPolicy('zai','glm-5.3','max').parameters, { thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  assert.equal(modelPolicy('openai','gpt-4.1','default').contextTokens, 1047576);
  assert.equal(modelPolicy('openai','gpt-5','default').contextTokens, 400000);
  assert.equal(modelPolicy('zai','glm-4.7','default').contextTokens, 200000);
  assert.equal(modelPolicy('zai','glm-5.3','default').contextTokens, 1000000);
  let calls=0;
  for (const input of [{model:'gpt-4.1',effort:'high'}, {provider:'zai' as const,model:'glm-4.7',effort:'max'}, {model:'custom-model',effort:'low'}])
    await assert.rejects(generateSummary({...base,...input},async()=>{calls++;return reply();}), /effort|preference/i);
  assert.equal(calls,0);
  await generateSummary({...base,provider:'zai',model:'glm-5.3',effort:'low'},async(url,options)=>{
    assert.equal(String(url),'https://api.z.ai/api/paas/v4/chat/completions');
    const body=JSON.parse(options!.body as string);assert.equal(body.max_tokens,65536);assert.equal(body.max_completion_tokens,undefined);assert.equal(body.reasoning_effort,'low');return reply();
  });
});

test('Unicode splitting preserves every character and respects UTF-8 byte bounds including long lines', () => {
  for (const text of ['Привет мир!\n'.repeat(100), '🦉漢字'.repeat(500), 'x'.repeat(5000), '  a  \n\n b \t ']) {
    const chunks=splitText(text,127);
    assert.equal(chunks.join(''),text);assert.ok(chunks.every(chunk=>Buffer.byteLength(chunk)<=127 && chunk.length>0));
    assert.ok(chunks.every(chunk=>!chunk.includes('\ufffd')));
  }
});

test('long meetings process all chunks in order then merge, reserving context for output and instructions', async () => {
  const transcript='Начало встречи. '.repeat(1200)+'КОНЕЦ: Иван отправит отчёт в пятницу.';
  let calls=0; const chunkInputs: string[]=[]; const progress: any[]=[];
  const result=await generateSummary({...base,model:'custom-model',transcript},async(_url,options)=>{
    calls++;const body=JSON.parse(options!.body as string);
    const input=body.messages.map((m:any)=>m.content).join('');
    assert.ok(Buffer.byteLength(input)+body.max_completion_tokens+2048+64<=16384);
    if(body.messages[1].content.startsWith('TRANSCRIPT PART:\n')) { chunkInputs.push(body.messages[1].content.slice('TRANSCRIPT PART:\n'.length));return reply('Часть '+calls+'; Иван отправит отчёт в пятницу.'); }
    assert.match(body.messages[1].content,/Иван отправит/);return reply('Иван отправит отчёт в пятницу.');
  }, value=>progress.push(value));
  assert.equal(chunkInputs.join(''),transcript);assert.ok(calls>2);assert.equal(result.requests,calls);
  assert.equal(result.contextFallback,true);assert.ok(progress.some(value=>value.stage==='merging'));
});

test('recursive merging reduces oversized notes without truncating or exceeding the request limit', async () => {
  let count=0;
  const result=await generateSummary({...base,model:'custom-model',transcript:'x'.repeat(24000)},async(_url,options)=>{
    const input=JSON.parse(options!.body as string).messages[1].content;
    count++;return reply(input.startsWith('TRANSCRIPT PART:')?'a'.repeat(5000):'Merged notes.');
  });
  assert.ok(count>=6);assert.equal(result.text,'Merged notes.');
  await assert.rejects(generateSummary({...base,model:'custom-model',transcript:'x'.repeat(24000)},async()=>reply('x'.repeat(11000))),/reduce|context|limit/i);
});

test('empty, truncated, refused, malformed, oversized and external errors never become successful summaries or leak secrets', async () => {
  for (const transport of [async()=>reply(''),async()=>reply('partial','length'),async()=>reply('filtered','content_filter'),async()=>Response.json({choices:[{message:{content:'text',refusal:'secret'},finish_reason:'stop'}]}),async()=>Response.json({}),async()=>new Response('fixture-secret',{status:401}),async()=>new Response('fixture-secret',{status:429}),async()=>{throw Error('fixture-secret');},async()=>reply('x'.repeat(2*1024*1024+1))]) {
    let calls=0;
    await assert.rejects(generateSummary(base,async()=>{calls++;return transport();}), error => {
      assert.equal(String(error).includes('fixture-secret'),false); return true;
    });
    assert.equal(calls,1);
  }
  let calls=0;
  await assert.rejects(generateSummary({...base,transcript:'x'.repeat(8*1024*1024+1)},async()=>{calls++;return reply();}),/large|limit/i);
  assert.equal(calls,0);
});


test('oversized instructions or too many chunks fail before any paid request', async () => {
  let calls=0;
  const transport:typeof fetch=async()=>{calls++;return reply();};
  await assert.rejects(generateSummary({...base,model:'custom-model',prompt:'x'.repeat(16000)},transport),/instructions|context/i);
  await assert.rejects(generateSummary({...base,model:'custom-model',transcript:'x'.repeat(800000)},transport),/too many|limit/i);
  assert.equal(calls,0);
});

test('GLM-5 through 5.2 use their documented context and thinking switch without unsupported reasoning depth', () => {
 for(const [model,context] of [['glm-5',200000],['glm-5.1',200000],['glm-5.2',1000000]] as const){
  const policy=modelPolicy('zai',model,'default');assert.equal(policy.contextTokens,context);assert.equal(policy.outputTokens,65536);assert.equal(policy.contextFallback,false);
  assert.deepEqual(modelPolicy('zai',model,'high').parameters,{thinking:{type:'enabled'}});
  assert.throws(()=>modelPolicy('zai',model,'max'),/effort|preference/i);
 }
});
