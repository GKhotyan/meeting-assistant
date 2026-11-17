const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
 const page = await browser.newPage({viewport:{width:1440,height:1050}});
 page.setDefaultTimeout(5000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let state={provider:'zai',providers:{zai:{model:'glm-4.7',effort:'default',configured:false},openai:{model:'gpt-4.1',effort:'default',configured:false}}};
 const keys={},checked=[];let release,hold=null,failLoad=false,failAction=false;
 await page.route('http://workspace.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.startsWith('/api/settings/ai')){
   if(req.method()==='GET')return failLoad?route.fulfill({status:500,json:{error:'Storage unavailable'}}):route.fulfill({json:state});
   if(failAction)return route.fulfill({status:500,json:{error:'Could not save settings'}});
   const input=req.postDataJSON();
   if(hold){const pending=hold;hold=null;await pending;}
   if(path.endsWith('/check')){checked.push(input.apiKey||keys[input.provider]);return route.fulfill({json:{valid:true,message:'Connection verified.'}});}
   if(req.method()==='DELETE'){delete keys[input.provider];state.providers[input.provider].configured=false;}
   else{state.provider=input.provider;state.providers[input.provider]={model:input.model,effort:input.effort,configured:!!(input.apiKey||keys[input.provider])};if(input.apiKey)keys[input.provider]=input.apiKey;}
   return route.fulfill({json:state});
  }
  if(path==='/api/settings/deepgram')return route.fulfill({json:{configured:false}});
  if(path==='/api/settings')return route.fulfill({json:{botName:'Notes',recordingMode:'audio'}});
  if(path==='/api/sessions')return route.fulfill({json:{sessions:[]}});
  if(path==='/api/schedules')return route.fulfill({json:{schedules:[]}});
  return route.fulfill({body:readFileSync(join(__dirname,'../public',path==='/'?'index.html':path.slice(1))),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
 });
 try{
  await page.goto('http://workspace.test');await page.getByRole('tab',{name:'Settings',exact:true}).click();
  const provider=page.getByLabel('AI provider',{exact:true}),key=page.getByLabel('AI API key',{exact:true}),model=page.getByLabel('Model ID',{exact:true});
  await provider.selectOption('openai');await key.fill('draft-secret');await model.fill('gpt-5');
  await page.locator('#ai-toggle').click();assert.equal(await key.getAttribute('type'),'text');await page.locator('#ai-toggle').click();assert.equal(await key.getAttribute('type'),'password');
  failAction=true;await page.locator('#ai-save').click();await page.locator('#ai-feedback').filter({hasText:'Could not save settings'}).waitFor();assert.equal(await key.inputValue(),'draft-secret');failAction=false;
  await page.locator('#ai-check').click();await page.locator('#ai-feedback').filter({hasText:'Entered key: Connection verified.'}).waitFor();
  assert.equal(keys.openai,undefined);
  await provider.selectOption('zai');await key.fill('zai-secret');await provider.selectOption('openai');
  assert.equal(await key.inputValue(),'draft-secret');assert.equal(await model.inputValue(),'gpt-5');
  hold=new Promise(resolve=>release=resolve);await page.locator('#ai-save').click();assert.equal(await provider.isDisabled(),true);release();
  await page.locator('#ai-feedback').filter({hasText:'Settings saved.'}).waitFor();assert.equal(await key.inputValue(),'');assert.equal(await key.getAttribute('type'),'password');
  await page.locator('#ai-check').click();await page.locator('#ai-feedback').filter({hasText:'Saved key: Connection verified.'}).waitFor();assert.deepEqual(checked,['draft-secret','draft-secret']);
  await provider.selectOption('zai');assert.equal(await key.inputValue(),'zai-secret');
  await page.locator('#ai-save').click();await page.locator('#ai-feedback').filter({hasText:'Settings saved.'}).waitFor();
  await page.reload();await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#ai-provider').disabled);
  assert.equal(await provider.inputValue(),'zai');assert.equal(await key.inputValue(),'');
  await provider.selectOption('openai');assert.equal(await model.inputValue(),'gpt-5');
  await page.locator('#ai-remove').click();await page.locator('#ai-feedback').filter({hasText:'API key removed.'}).waitFor();assert.equal(state.providers.zai.configured,true);
  await page.screenshot({path:'/tmp/ai-settings-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/ai-settings-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  failLoad=true;await page.reload();await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.locator('#ai-feedback').filter({hasText:'Storage unavailable'}).waitFor();assert.equal(await provider.isDisabled(),true);
  failLoad=false;await page.locator('#ai-reload').click();await page.waitForFunction(()=>!document.querySelector('#ai-provider').disabled);assert.equal(await provider.inputValue(),'zai');assert.deepEqual(errors,[]);
  console.log('AI_SETTINGS_UI_PASS: provider switching, drafts, independent credentials, save/check/remove, pending state, persistence, mobile');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
