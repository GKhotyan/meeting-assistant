// Real HTTP/CSP and browser input integration; only the external Zoom login is a fixture.
const assert=require('node:assert/strict');
const {mkdtempSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {ZoomConnection}=require('../dist/src/zoom/connection.js');
const {Controller}=require('../dist/src/session/controller.js');
const {createApp}=require('../dist/src/server/app.js');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
 const probeContext=await browser.newContext();
 await probeContext.route('https://zoom.us/profile',route=>route.fulfill({contentType:'text/html',body:`<body>Profile Edit shell<script>setTimeout(()=>{document.body.innerHTML='<div id="common-header-profile-avatar"></div><div id="UserProfile_profile-info">Personal Meeting ID</div><h4 id="sign-in-email-label">Sign-In Email</h4>';},400);</script></body>`}));
 const {verifyContext}=require('../dist/src/zoom/authentication.js');
 try {assert.equal(await verifyContext(probeContext),true,'Wait for actual signed-in controls instead of the initial profile shell');} finally{await probeContext.close();}
 const loginContext=await browser.newContext();
 await loginContext.route('https://zoom.us/signin',route=>route.fulfill({contentType:'text/html',body:`<input type="email" id="email"><input type="password"><button onclick="document.body.dataset.submitted='true'">Sign In</button>`}));
 const loginPage=await loginContext.newPage();const {submitZoomCredentials}=require('../dist/src/zoom/login-browser.js');
 await submitZoomCredentials(loginPage,'bot@example.com','fixture-password');
 assert.equal(await loginPage.locator('#email').inputValue(),'bot@example.com');assert.equal(await loginPage.locator('body').getAttribute('data-submitted'),'true');
 await loginContext.close();
 const namesContext=await browser.newContext();const namesPage=await namesContext.newPage();
 const {applyMeetingName,setPreJoinName}=require('../dist/src/zoom/meeting-name.js');
 await namesPage.setContent(`<input id="input-for-name" value="Account Name"><button aria-label="open the participants list pane,[11] particpants" onclick="setTimeout(()=>document.querySelector('.participants-li').style.display='block',150)">Participants</button><button aria-label="Participants Settings" onclick="window.wrongButton=true">Menu</button><div class="participants-li" style="display:none"><div>PA</div><span class="participants-item__name-section"><span class="participants-item__display-name">PIM Assistant</span><span>(Me)</span></span></div>`);
 assert.equal(await setPreJoinName(namesPage,'PIM Assistant'),true);assert.equal(await namesPage.locator('#input-for-name').inputValue(),'PIM Assistant');
 assert.equal(await applyMeetingName(namesPage,'PIM Assistant'),'applied','Wait for the actual participant pane and compare the display-name element exactly');
 assert.equal(await namesPage.evaluate(()=>!!window.wrongButton),false);
 await namesPage.setContent(`<div class="participants-li"><span class="participants-item__display-name">Account Name</span><span>(Me)</span><button aria-label="More options" onclick="document.querySelector('#rename-menu').hidden=false">More</button></div><button id="rename-menu" role="menuitem" hidden onclick="document.querySelector('.dialog-rename-container').hidden=false">Rename</button><div class="dialog-rename-container" hidden><div>Rename:</div><label for="newname">Name</label><input type="text" id="newname"><button onclick="document.querySelector('.participants-item__display-name').textContent=document.querySelector('#newname').value;document.querySelector('.dialog-rename-container').hidden=true">Change</button></div>`);
 assert.equal(await applyMeetingName(namesPage,'PIM Assistant'),'applied','Support the Zoom rename modal without relying on a dialog ARIA role');
 assert.equal(await namesPage.locator('.participants-item__display-name').innerText(),'PIM Assistant');await namesContext.close();
 const root=mkdtempSync(join(tmpdir(),'zoom-http-browser-'));
 let remote;
 const zoom=new ZoomConnection(root,async state=>{
  const context=await browser.newContext({viewport:{width:1280,height:900}});remote=await context.newPage();
  if(state)await remote.setContent('<body data-verified="true">Profile fixture</body>');
  return {async start(){await remote.setContent(`<body style="font:20px sans-serif;background:#f0f4ff" data-verified="false"><h1>Zoom verification fixture</h1><label style="position:absolute;left:30px;top:50px">Verification code</label><input id="code" style="position:absolute;left:30px;top:80px;width:300px;height:40px"><button style="position:absolute;left:30px;top:150px;width:180px;height:40px" onclick="if(document.querySelector('#code').value==='123456')document.body.dataset.verified='true'">Verify</button></body>`);},
   async verify(){return await remote.locator('body').getAttribute('data-verified')==='true';},async problem(){return 'Enter the verification code in the browser.';},
   async state(){return {cookies:[{name:'cred',value:'fixture-secret',domain:'.zoom.us',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]};},
   async frame(){return remote.screenshot({type:'jpeg'});},async input(a){if(a.type==='click')await remote.mouse.click(a.x,a.y);else if(a.type==='text')await remote.keyboard.insertText(a.text);else if(a.type==='key')await remote.keyboard.press(a.key);else await remote.mouse.wheel(0,a.deltaY);},async close(){await context.close();}};
 },{pollMs:100});
 const app=createApp(new Controller(root,()=>{throw Error('No recording expected');}),{zoom,password:'test',publicDir:join(__dirname,'../public')});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.address().port;
 const user=await browser.newContext({httpCredentials:{username:'assistant',password:'test'},viewport:{width:1440,height:1100}});const page=await user.newPage();page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url);await page.getByRole('tab',{name:'Settings',exact:true}).click();
  await page.locator('#zoom-email').fill('bot@example.com');await page.locator('#zoom-password').fill('temporary-password');await page.locator('#zoom-connect').click();
  await page.locator('#zoom-browser-open').waitFor({state:'visible'});await page.locator('#zoom-browser-open').click();
  await page.waitForFunction(()=>document.querySelector('#zoom-browser-image').naturalWidth===1280);
  const img=page.locator('#zoom-browser-image');
  async function clickRemote(x,y){const r=await img.boundingBox();await img.click({position:{x:x*r.width/1280,y:y*r.height/900}});}
  await clickRemote(100,100);await page.locator('#zoom-browser-text').fill('123456');await page.locator('#zoom-browser-send').click();
  await remote.waitForFunction(()=>document.querySelector('#code').value==='123456');
  await page.screenshot({path:'/tmp/zoom-live-fallback.png'});
  await clickRemote(100,170);await page.locator('#zoom-status').filter({hasText:'Connected'}).waitFor();
  assert.equal(await page.locator('#zoom-password').inputValue(),'');assert.equal(await page.locator('#zoom-browser').isVisible(),false);
  assert.equal(readFileSync(join(root,'settings/api-keys.json'),'utf8').includes('fixture-secret'),false);
  await page.locator('#zoom-title').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/zoom-live-settings.png'});
  await page.setViewportSize({width:390,height:844});await page.locator('#zoom-title').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/zoom-live-settings-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const restored=new ZoomConnection(root,async()=>{throw Error('Must not open on restart');});assert.equal(restored.metadata().status,'connected');await restored.close();
  await page.reload();await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.locator('#zoom-status').filter({hasText:'Connected'}).waitFor();assert.equal(await page.locator('#zoom-email').inputValue(),'bot@example.com');assert.equal(await page.locator('#zoom-password').inputValue(),'');
  assert.deepEqual(errors,[]);console.log('Real HTTP/CSP, interactive input, encrypted persistence, desktop/mobile UI passed');
 }finally{await zoom.close();await new Promise(r=>app.close(r));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
