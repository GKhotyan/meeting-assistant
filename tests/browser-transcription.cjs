const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(6000);
 const errors=[];let slowGet=0;page.on('pageerror',e=>errors.push(e.message));
 const session={id:'daily',meetingName:'Product standup',botName:'Notes',status:'completed',createdAt:'2026-11-17T08:00:00Z',files:[{id:'audio',name:'audio.webm',kind:'audio',status:'ready',bytes:80044}]};
 let state={status:'idle'}, submissions=[], fail=false, delayGet=null, release;
 const transcript={audioFileId:'audio',audioFile:'audio.webm',language:'ru',diarize:true,model:'nova-3',createdAt:'2026-11-17T09:00:00Z',text:'Привет <script>команда</script>',segments:[{start:1.2,end:3,text:'Привет <script>команда</script>',speaker:0}]};
 const wav=Buffer.alloc(80044);wav.write('RIFF');wav.writeUInt32LE(80036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(80000,40);
 await page.route('http://workspace.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/summary'))return route.fulfill({json:{status:'idle',stale:false}});
  if(path==='/api/settings/zoom')return route.fulfill({json:{status:'disconnected',connected:false}});
    if (path === '/api/settings/ai') return route.fulfill({json:{provider:'zai',providers:{zai:{model:'glm-4.7',effort:'default',configured:false},openai:{model:'gpt-4.1',effort:'default',configured:false}}}});
  if(path==='/api/settings/deepgram')return route.fulfill({json:{configured:true}});
  if(path==='/api/settings')return route.fulfill({json:{botName:'Notes',recordingMode:'audio'}});
  if(path==='/api/schedules')return route.fulfill({json:{schedules:[]}});
  if(path==='/api/sessions')return route.fulfill({json:{sessions:[{...session,transcription:{status:state.status}}]}});
  if(path==='/api/sessions/daily'){if(slowGet)await new Promise(resolve=>setTimeout(resolve,slowGet));return route.fulfill({json:session});}
  if(path==='/api/sessions/daily/transcription'){
   if(req.method()==='POST'){
    submissions.push(req.postDataJSON());
    if(fail)return route.fulfill({status:409,json:{error:'Another transcription is already in progress.'}});
    state={status:'processing',options:req.postDataJSON(),...(state.transcript?{transcript:state.transcript}:{})};
   }else if(delayGet){const pending=delayGet;delayGet=null;const snapshot=state;await pending;return route.fulfill({json:snapshot});}
   return route.fulfill({status:req.method()==='POST'?202:200,json:state});
  }
  if(path.includes('/files/'))return route.fulfill({body:wav,contentType:'audio/wav'});
  return route.fulfill({body:readFileSync(join(__dirname,'../public',path==='/'?'index.html':path.slice(1))),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
 });
 try {
  await page.goto('http://workspace.test');
  await page.getByRole('link',{name:'Product standup',exact:true}).click();
  await page.getByRole('tab',{name:'Recording',exact:true}).waitFor();
  assert.equal(submissions.length,0);
  await page.getByRole('tab',{name:'Transcription',exact:true}).click();
  assert.equal(await page.getByLabel('Audio language',{exact:true}).inputValue(),'ru');
  assert.equal(await page.getByLabel('Identify speakers').isChecked(),false);
  await page.getByLabel('Identify speakers').check();
  await page.getByRole('button',{name:'Get transcription',exact:true}).click();
  await page.getByText('Transcribing audio…',{exact:true}).waitFor();
  assert.deepEqual(submissions,[{audioFileId:'audio',language:'ru',diarize:true}]);
  assert.equal(await page.getByLabel('Audio language',{exact:true}).isDisabled(),true);
  await page.getByRole('link',{name:'Back to meetings',exact:true}).click();
  state={status:'completed',transcript};
  await page.evaluate(()=>refresh());
  await page.getByRole('link',{name:'Transcript ready',exact:true}).click();
  await page.getByText('Привет <script>команда</script>',{exact:true}).waitFor();
  await page.getByText('Speaker 1',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#meeting-audio').readyState>=1);
  await page.getByRole('button',{name:'Play from 00:01',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#meeting-audio').currentTime>=1.1);
  const before=await page.locator('#meeting-audio').evaluate(e=>e.currentTime);
  await page.evaluate(()=>MeetingView.refresh());
  assert.ok(await page.locator('#meeting-audio').evaluate(e=>e.currentTime)>=before);
  await page.screenshot({path:'/tmp/transcription-desktop.png',fullPage:true});
  slowGet=2300;
  await page.reload();
  await page.getByText('Speaker 1',{exact:true}).waitFor();
  slowGet=0;
  assert.match(page.url(),/#meeting\/daily\/transcription$/);
  session.files.push({id:'second',name:'second.webm',kind:'audio',status:'ready',bytes:80044});
  await page.evaluate(()=>MeetingView.refresh());
  await page.getByLabel('Audio file',{exact:true}).selectOption('second');
  await page.evaluate(()=>MeetingView.refresh());
  assert.match(await page.locator('#meeting-audio').getAttribute('src'),/files\/second/);
  fail=true;
  await page.getByRole('button',{name:'Transcribe again',exact:true}).click();
  await page.locator('#transcription-feedback').filter({hasText:'Another transcription'}).waitFor();
  assert.equal(await page.getByText('Привет <script>команда</script>',{exact:true}).isVisible(),true);
  fail=false;state={status:'failed',error:'Deepgram did not accept the API key.',transcript};
  await page.evaluate(()=>MeetingView.refresh());
  await page.locator('#transcription-status').filter({hasText:'Deepgram did not accept'}).waitFor();
  await page.getByRole('button',{name:'Retry transcription',exact:true}).click();
  await page.getByText('Transcribing audio…',{exact:true}).waitFor();
  state={status:'completed',transcript};await page.evaluate(()=>MeetingView.refresh());
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:'/tmp/transcription-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>{
   const audio=document.getElementById('meeting-audio');
   Object.defineProperty(audio,'readyState',{get:()=>0,configurable:true});
   document.querySelector('.timestamp').click();
   MeetingView.close();location.hash='#settings';
   delete audio.readyState;
  });
  await page.getByRole('tab',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Meetings',exact:true}).click();
  await page.getByRole('link',{name:'Transcript ready',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('meeting-audio').readyState>=1);
  assert.ok(await page.locator('#meeting-audio').evaluate(audio=>audio.currentTime)<0.5,'pending seek must not leak across navigation');
  assert.equal(await page.locator('#meeting-audio').evaluate(audio=>audio.paused),true);
  delayGet=new Promise(resolve=>{release=resolve;});
  const pending=page.evaluate(()=>MeetingView.refresh());
  await page.getByRole('tab',{name:'Settings',exact:true}).click();release();await pending;
  assert.equal(await page.locator('#panel-meeting').isVisible(),false);
  await page.getByRole('tab',{name:'Meetings',exact:true}).click();
  await page.getByRole('link',{name:'Product standup',exact:true}).click();
  await page.goBack();
  assert.equal(await page.locator('#panel-now').isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('TRANSCRIPTION_UI_PASS: navigation, no automatic uploads, options, background, result, seek, retry, reload/back, stale response, mobile');
 }catch(error){console.error('Page errors:',errors);await page.screenshot({path:'/tmp/transcription-failure.png',fullPage:true});console.error(await page.locator('#panel-meeting').innerText());throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
