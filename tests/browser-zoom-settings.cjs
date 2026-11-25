const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(7000);
 let status={status:'not_connected',email:'',browserAvailable:false},posted;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://workspace.test/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(p.startsWith('/api/settings/zoom')){
   if(p.endsWith('/connect')){posted=r.postDataJSON();status={status:'action_required',email:posted.email,browserAvailable:true,message:'Complete sign-in in the browser.'};}
   if(r.method()==='DELETE'||p.endsWith('/cancel'))status={status:'not_connected',email:'',browserAvailable:false};
   if(p.endsWith('/frame'))return route.fulfill({body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5F8AAAAASUVORK5CYII=','base64'),contentType:'image/png'});
   return route.fulfill({json:status});
  }
  if(p==='/api/settings')return route.fulfill({json:{botName:'Notes',recordingMode:'audio'}});
  if(p==='/api/sessions')return route.fulfill({json:{sessions:[]}});
  if(p==='/api/schedules')return route.fulfill({json:{schedules:[]}});
  if(p.startsWith('/api/'))return route.fulfill({json:{configured:false}});
  return route.fulfill({body:readFileSync(join(__dirname,'../public',p==='/'?'index.html':p.slice(1))),contentType:p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'});
 });
 try{
  await page.goto('http://workspace.test');await page.getByRole('tab',{name:'Settings',exact:true}).click();
  await page.getByLabel('Zoom email',{exact:true}).fill('bot@example.com');await page.getByLabel('Zoom password',{exact:true}).fill('secret');
  await page.locator('#zoom-connect').click();await page.getByRole('button',{name:'Continue in browser',exact:true}).waitFor();
  assert.equal(posted.password,'secret');assert.equal(await page.locator('#zoom-password').inputValue(),'');
  await page.locator('#zoom-browser-open').click();await page.locator('#zoom-browser').waitFor({state:'visible'});
  await page.screenshot({path:'/tmp/zoom-settings-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/zoom-settings-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#zoom-browser-close').click();await page.locator('#zoom-cancel').click();
  await page.locator('#zoom-status').filter({hasText:'Not connected'}).waitFor();
  status={status:'connected',email:'bot@example.com',passwordSaved:true,browserAvailable:false};
  await page.getByRole('button',{name:'Reconnect',exact:true}).waitFor();
  const password=page.getByLabel('Zoom password',{exact:true});
  assert.equal(await password.inputValue(),'');assert.equal(await password.getAttribute('placeholder'),'••••••••');
  assert.equal(await password.evaluate(e=>e.required),false);
  await page.getByLabel('Zoom email',{exact:true}).fill('other@example.com');
  assert.equal(await password.evaluate(e=>e.required),true);assert.equal(await password.getAttribute('placeholder'),'');
  await page.getByLabel('Zoom email',{exact:true}).fill('bot@example.com');
  await page.locator('#zoom-connect').click();await page.getByRole('button',{name:'Continue in browser',exact:true}).waitFor();
  assert.equal(posted.password,'','masked placeholder must never be submitted as a password');
  await page.locator('#zoom-cancel').click();
  assert.deepEqual(errors,[]);console.log('Zoom Settings browser smoke passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
