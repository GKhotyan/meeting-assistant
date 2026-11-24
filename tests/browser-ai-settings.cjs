const assert = require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(5000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let state={provider:'zai',providers:{zai:{model:'glm-4.7',effort:'default',configured:false},openai:{model:'gpt-4.1',effort:'default',configured:false}}};
 const keys={},checked=[];let release,hold=null,failLoad=false,failAction=false;
 await page.route('http://workspace.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.startsWith('/api/settings/ai')){
   if(req.method()==='GET')return failLoad?route.fulfill({status:500,json:{error:'Storage unavailable'}}):route.fulfill({json:state});
   if(failAction)return route.fulfill({status:500,json:{error:'Could not save settings'}});
   const input=req.postDataJSON();if(hold){const pending=hold;hold=null;await pending;}
   if(path.endsWith('/check')){checked.push(input.apiKey||keys[input.provider]);return route.fulfill({json:{valid:true,message:'Connection verified.'}});}
   if(path.endsWith('/provider'))state.provider=input.provider;
   else if(req.method()==='DELETE'){delete keys[input.provider];state.providers[input.provider].configured=false;}
   else{if(input.activate!==false)state.provider=input.provider;state.providers[input.provider]={model:input.model,effort:input.effort,configured:!!(input.apiKey||keys[input.provider])};if(input.apiKey)keys[input.provider]=input.apiKey;}
   return route.fulfill({json:state});
  }
  if(path==='/api/settings/zoom')return route.fulfill({json:{status:'disconnected',connected:false}});
  if(path==='/api/settings/deepgram')return route.fulfill({json:{configured:false}});
  if(path==='/api/settings')return route.fulfill({json:{botName:'Notes',recordingMode:'audio'}});
  if(path==='/api/sessions')return route.fulfill({json:{sessions:[]}});
  if(path==='/api/schedules')return route.fulfill({json:{schedules:[]}});
  return route.fulfill({body:readFileSync(join(__dirname,'../public',path==='/'?'index.html':path.slice(1))),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
 });
 try{
  await page.goto('http://workspace.test/#settings');
  const provider=page.getByLabel('Summary provider',{exact:true}),openai=page.locator('#ai-openai-form'),zai=page.locator('#ai-zai-form');
  const key=page.getByLabel('OpenAI API key',{exact:true}),model=page.getByLabel('OpenAI model ID',{exact:true});
  const zkey=page.getByLabel('z.ai API key',{exact:true});
  const presets=page.getByLabel('z.ai model',{exact:true});
  await page.waitForFunction(()=>!document.querySelector('#ai-zai-preset').disabled);
  assert.deepEqual(await presets.locator('option').evaluateAll(options=>options.map(option=>option.value)),['','glm-5.3','glm-5.3-flash','glm-5.3-flashx','glm-5.2','glm-5.1','glm-5','glm-4.7','glm-4.7-flash','glm-4.7-flashx']);
  assert.equal(await presets.inputValue(),'glm-4.7');
  await presets.selectOption('glm-5.2');assert.equal(await page.getByLabel('z.ai model ID',{exact:true}).inputValue(),'glm-5.2');
  await page.getByLabel('z.ai model ID',{exact:true}).fill('my-custom-model');assert.equal(await presets.inputValue(),'');
  await presets.selectOption('glm-5.3-flash');
  await key.fill('draft-secret');await model.fill('gpt-5');await zkey.fill('zai-secret');
  await openai.getByRole('button',{name:'Show key',exact:true}).click();assert.equal(await key.getAttribute('type'),'text');
  await openai.getByRole('button',{name:'Hide key',exact:true}).click();assert.equal(await key.getAttribute('type'),'password');
  failAction=true;await openai.getByRole('button',{name:'Save OpenAI settings',exact:true}).click();await page.locator('#ai-openai-feedback').filter({hasText:'Could not save settings'}).waitFor();assert.equal(await key.inputValue(),'draft-secret');failAction=false;
  await openai.getByRole('button',{name:'Check connection',exact:true}).click();await page.locator('#ai-openai-feedback').filter({hasText:'Entered key: Connection verified.'}).waitFor();assert.equal(keys.openai,undefined);
  hold=new Promise(r=>release=r);await openai.getByRole('button',{name:'Save OpenAI settings',exact:true}).click();assert.equal(await provider.isDisabled(),true);release();
  await page.locator('#ai-openai-feedback').filter({hasText:'Settings saved.'}).waitFor();assert.equal(await key.inputValue(),'');assert.equal(await zkey.inputValue(),'zai-secret');assert.equal(state.provider,'zai');
  await openai.getByRole('button',{name:'Check connection',exact:true}).click();await page.locator('#ai-openai-feedback').filter({hasText:'Saved key: Connection verified.'}).waitFor();assert.deepEqual(checked,['draft-secret','draft-secret']);
  await zai.getByRole('button',{name:'Save z.ai settings',exact:true}).click();await page.locator('#ai-zai-feedback').filter({hasText:'Settings saved.'}).waitFor();
  assert.equal(state.providers.openai.configured,true);assert.equal(state.providers.zai.configured,true);
  await model.fill('unsaved-model');await zkey.fill('unsaved-other-key');
  await provider.selectOption('openai');await page.getByRole('button',{name:'Apply provider',exact:true}).click();await page.locator('#ai-feedback').filter({hasText:'Summary provider updated.'}).waitFor();
  assert.equal(state.provider,'openai');assert.equal(state.providers.openai.model,'gpt-5');assert.equal(await model.inputValue(),'unsaved-model');assert.equal(await zkey.inputValue(),'unsaved-other-key');
  await provider.selectOption('zai');await page.getByRole('button',{name:'Apply provider',exact:true}).click();await page.locator('#ai-active').filter({hasText:'Active summary provider: z.ai.'}).waitFor();
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#ai-provider').disabled);
  assert.equal(await provider.inputValue(),'zai');assert.equal(await key.inputValue(),'');assert.equal(await zkey.inputValue(),'');assert.equal(await model.inputValue(),'gpt-5');
  await openai.getByRole('button',{name:'Remove key',exact:true}).click();await page.locator('#ai-openai-feedback').filter({hasText:'API key removed.'}).waitFor();assert.equal(state.providers.zai.configured,true);assert.equal(state.provider,'zai');
  await page.locator('#ai-settings').screenshot({path:'/tmp/ai-providers-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.locator('#ai-settings').screenshot({path:'/tmp/ai-providers-mobile.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  failLoad=true;await page.reload();await page.locator('#ai-feedback').filter({hasText:'Storage unavailable'}).waitFor();assert.equal(await provider.isDisabled(),true);
  failLoad=false;await page.locator('#ai-reload').click();await page.waitForFunction(()=>!document.querySelector('#ai-provider').disabled);assert.equal(await provider.inputValue(),'zai');assert.deepEqual(errors,[]);
  console.log('AI_SETTINGS_UI_PASS: separate visible cards, both keys, independent saves/checks/removal, active provider switch, drafts, persistence, mobile');
 }catch(error){await page.screenshot({path:'/tmp/ai-providers-failure.png',fullPage:true});throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
