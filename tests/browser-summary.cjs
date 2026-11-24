const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
 const context=await browser.newContext({viewport:{width:1440,height:1050},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const session={id:'daily',meetingName:'Product standup',botName:'Notes',status:'completed',createdAt:'2026-11-23T08:00:00Z',files:[]};
 const transcript={text:'Иван отправит отчёт.',createdAt:'2026-11-23T09:00:00Z',segments:[]};
 const schedule={id:'daily-rule',name:'Product standup',summaryPrompt:'Only thematic bullets'};let saves=0,saveError=false;
 let state={status:'idle',stale:false,instructions:{prompt:'Only thematic bullets',promptOrigin:'schedule',scheduleName:'Product standup',scheduleId:'daily-rule'}},submissions=[],configured=true,fail=false,delay=null,release;
 const result={text:'## Решения\n- **Иван** отправит отчёт.\n<script>bad()</script>',provider:'openai',model:'gpt-4.1',effort:'default',prompt:'Only decisions',promptSource:'custom',createdAt:'2026-11-23T09:10:00Z',requests:1,contextFallback:false};
 await page.route('http://localhost:43219/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/settings/ai')return route.fulfill({json:{provider:'openai',providers:{openai:{model:'gpt-4.1',effort:'default',configured},zai:{model:'glm-4.7',effort:'default',configured:false}}}});
  if(path==='/api/settings/zoom')return route.fulfill({json:{status:'disconnected',connected:false}});
  if(path==='/api/settings/deepgram')return route.fulfill({json:{configured:true}});
  if(path==='/api/settings')return route.fulfill({json:{botName:'Notes',recordingMode:'audio'}});
  if(path==='/api/schedules')return route.fulfill({json:{schedules:[schedule]}});
  if(path==='/api/schedules/daily-rule'){
   const input=req.postDataJSON();saves++;
   if(saveError)return route.fulfill({status:409,json:{error:'The shared prompt changed elsewhere. Cancel and reopen the editor before saving.'}});
   assert.equal(input.expectedSummaryPrompt,schedule.summaryPrompt);schedule.summaryPrompt=input.summaryPrompt;
   state={...state,instructions:{prompt:input.summaryPrompt,promptOrigin:'schedule',scheduleName:schedule.name,scheduleId:schedule.id},instructionsChanged:!!state.result};
   return route.fulfill({json:schedule});
  }
  if(path==='/api/sessions')return route.fulfill({json:{sessions:[{...session,transcription:{status:'completed'},summary:{status:state.status,stale:state.stale}}]}});
  if(path==='/api/sessions/daily')return route.fulfill({json:session});
  if(path==='/api/sessions/daily/transcription')return route.fulfill({json:{status:'completed',transcript}});
  if(path==='/api/sessions/daily/summary/download')return route.fulfill({body:result.text,headers:{'Content-Type':'text/markdown','Content-Disposition':'attachment; filename="daily-summary.md"'}});
  if(path==='/api/sessions/daily/summary'){
   if(req.method()==='POST'){
    submissions.push(req.postDataJSON());if(fail)return route.fulfill({status:409,json:{error:'Another summary is already in progress.'}});
    state={status:'processing',progress:{stage:'extracting',completedRequests:1,parts:3},...(state.result?{result:state.result}:{})};
   }else if(delay){const pending=delay;delay=null;const snapshot=state;await pending;return route.fulfill({json:snapshot});}
   return route.fulfill({status:req.method()==='POST'?202:200,json:state});
  }
  return route.fulfill({body:readFileSync(join(__dirname,'../public',path==='/'?'index.html':path.slice(1))),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
 });
 try{
  await page.goto('http://localhost:43219/#meeting/daily/summary');
  await page.getByRole('tab',{name:'Summary',exact:true}).waitFor();
  await page.getByRole('button',{name:'Generate summary',exact:true}).waitFor({state:'visible'});
  await page.getByText('Current instructions (prompt): Schedule · Product standup',{exact:true}).waitFor();
  await page.getByText('Instructions (prompt) for next generation',{exact:true}).click();
  await page.getByText('Only thematic bullets',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit instructions (prompt)',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Edit shared instructions (prompt)',exact:true});
  await editor.getByLabel('Instructions (prompt)',{exact:true}).fill('Discard this draft');
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(saves,0);assert.equal(schedule.summaryPrompt,'Only thematic bullets');
  await page.getByRole('button',{name:'Edit instructions (prompt)',exact:true}).click();
  await editor.getByText(/shared by all recordings/).waitFor();
  await editor.getByLabel('Instructions (prompt)',{exact:true}).fill('Shared new prompt');await page.evaluate(()=>MeetingView.refresh());
  assert.equal(await editor.getByLabel('Instructions (prompt)',{exact:true}).inputValue(),'Shared new prompt');
  await editor.screenshot({path:'/tmp/shared-prompt-editor-desktop.png'});
  await page.setViewportSize({width:390,height:844});await editor.screenshot({path:'/tmp/shared-prompt-editor-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1440,height:1050});
  saveError=true;await editor.getByRole('button',{name:'Save shared prompt',exact:true}).click();await editor.getByText(/changed elsewhere/).waitFor();assert.equal(await editor.getByLabel('Instructions (prompt)',{exact:true}).inputValue(),'Shared new prompt');
  saveError=false;await editor.getByRole('button',{name:'Save shared prompt',exact:true}).click();await editor.waitFor({state:'hidden'});assert.equal(schedule.summaryPrompt,'Shared new prompt');
  assert.equal(submissions.length,0);await page.getByRole('button',{name:'Generate summary',exact:true}).click();
  await page.locator('#summary-status').filter({hasText:'Extracting'}).waitFor();assert.deepEqual(submissions,[{}]);
  assert.equal(await page.locator('#transcription-submit').isDisabled(),true);
  assert.equal(await page.locator('#transcription-submit').textContent(),'Transcribe again');
  await page.getByRole('link',{name:'Back to meetings',exact:true}).click();state={status:'completed',result,stale:false};
  await page.evaluate(()=>refresh());await page.getByRole('link',{name:'Summary ready',exact:true}).click();
  await page.locator('#summary-result').filter({hasText:'Иван'}).waitFor();assert.equal(await page.locator('#summary-result script').count(),0);
  await page.getByRole('button',{name:'Copy summary',exact:true}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),result.text);
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download Markdown',exact:true}).click();assert.equal((await download).suggestedFilename(),'daily-summary.md');
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Generate again',exact:true}).click();assert.equal(submissions.length,1);
  fail=true;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Generate again',exact:true}).click();
  await page.locator('#summary-feedback').filter({hasText:'Another summary'}).waitFor();assert.deepEqual(submissions[1],{regenerate:true});
  state={status:'failed',result,stale:false,error:'Provider could not generate. No automatic retry was made.'};await page.evaluate(()=>MeetingView.refresh());
  await page.getByText('Previous successful summary',{exact:true}).waitFor();
  state={status:'completed',result,stale:true};await page.evaluate(()=>MeetingView.refresh());await page.locator('#summary-stale').filter({hasText:'transcript has changed'}).waitFor();
  state={...state,instructionsChanged:true,instructions:{prompt:'New schedule instructions',promptOrigin:'schedule',scheduleName:'Product standup',scheduleId:'daily-rule'}};await page.evaluate(()=>MeetingView.refresh());await page.locator('#summary-stale').filter({hasText:'instructions have changed'}).waitFor();
  configured=false;await page.evaluate(()=>MeetingView.refresh());assert.equal(await page.getByRole('button',{name:'Generate again',exact:true}).isDisabled(),true);assert.equal(await page.locator('#summary-result').isVisible(),true);
  await page.getByRole('tab',{name:'Summary',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.match(page.url(),/recording$/);await page.keyboard.press('End');assert.match(page.url(),/summary$/);
  await page.screenshot({path:'/tmp/summary-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/summary-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  delay=new Promise(r=>release=r);const pending=page.evaluate(()=>MeetingView.refresh());
  await page.getByRole('tab',{name:'Settings',exact:true}).click();release();await pending;assert.equal(await page.locator('#panel-meeting').isVisible(),false);
  await page.goto('http://localhost:43219/#meeting/daily/summary');await page.locator('#summary-result').filter({hasText:'Иван'}).waitFor();assert.equal(submissions.length,2);
  assert.deepEqual(errors,[]);console.log('SUMMARY_UI_PASS: explicit start, provenance, progress, previous/stale, copy/download, confirmation, keyboard, reload, late responses, mobile');
 }catch(error){console.error(errors);await page.screenshot({path:'/tmp/summary-failure.png',fullPage:true});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
