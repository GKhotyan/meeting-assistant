const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let saved = '', release, delayed = null, failLoad = false;
  let checks = [];
  await page.route('http://workspace.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/settings/ai') return route.fulfill({json:{provider:'zai',providers:{zai:{model:'glm-4.7',effort:'default',configured:false},openai:{model:'gpt-4.1',effort:'default',configured:false}}}});
    if (path.startsWith('/api/settings/deepgram')) {
      if (delayed) { const pending = delayed; delayed = null; await pending; }
      if (failLoad && request.method() === 'GET') return route.fulfill({status:500,json:{error:'Storage unavailable'}});
      const value = request.method() === 'GET' ? {} : request.postDataJSON() || {};
      if (path.endsWith('/check')) {
        checks.push(value.apiKey || saved);
        return route.fulfill({json:{valid:true,message:'Connection verified.'}});
      }
      if (request.method() === 'PUT') saved = value.apiKey.trim();
      if (request.method() === 'DELETE') saved = '';
      return route.fulfill({json:{configured:!!saved}});
    }
    if (path === '/api/settings') return route.fulfill({json:{botName:'Notes',recordingMode:'video'}});
    if (path === '/api/sessions') return route.fulfill({json:{sessions:[]}});
    if (path === '/api/schedules') return route.fulfill({json:{schedules:[]}});
    return route.fulfill({body:readFileSync(join(__dirname,'../public',path==='/'?'index.html':path.slice(1))),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
  });
  try {
    delayed = new Promise(resolve => { release = resolve; });
    await page.goto('http://workspace.test');
    await page.getByRole('tab',{name:'Settings',exact:true}).click();
    const key = page.getByLabel('Deepgram API key', {exact:true});
    await key.fill('first-draft');
    release();
    await page.getByText('No key saved.',{exact:true}).waitFor();
    assert.equal(await key.inputValue(),'first-draft');
    assert.equal(await key.getAttribute('type'),'password');
    await page.locator('#deepgram-form').getByRole('button',{name:'Show key',exact:true}).click();
    assert.equal(await key.getAttribute('type'),'text');
    await page.locator('#deepgram-form').getByRole('button',{name:'Check connection',exact:true}).click();
    await page.locator('#deepgram-feedback').filter({hasText:'Connection verified.'}).waitFor();
    assert.equal(saved,'');
    await key.fill('saved-secret');
    assert.equal(await page.locator('#deepgram-feedback').textContent(),'');
    delayed = new Promise(resolve => { release = resolve; });
    await page.locator('#deepgram-form').getByRole('button',{name:'Save key',exact:true}).click();
    assert.equal(await key.isDisabled(),true);
    assert.equal(await page.locator('#deepgram-form').getByRole('button',{name:'Check connection',exact:true}).isDisabled(),true);
    release();
    await page.getByText('Key saved. Connection has not been checked.',{exact:true}).waitFor();
    assert.equal(await key.inputValue(),'');
    assert.equal(await key.getAttribute('type'),'password');
    await page.locator('#deepgram-form').getByRole('button',{name:'Check connection',exact:true}).click();
    await page.locator('#deepgram-feedback').filter({hasText:'Connection verified.'}).waitFor();
    assert.deepEqual(checks,['first-draft','saved-secret']);
    assert.equal(await page.locator('#deepgram-status').textContent(),'Key saved. Connection verified.');
    await page.reload();
    await page.getByRole('tab',{name:'Settings',exact:true}).click();
    await page.getByText('Key saved. Connection has not been checked.',{exact:true}).waitFor();
    assert.equal(await key.inputValue(),'');
    await page.screenshot({path:'/tmp/deepgram-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({path:'/tmp/deepgram-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('#deepgram-form').getByRole('button',{name:'Remove key',exact:true}).click();
    await page.getByText('No key saved.',{exact:true}).waitFor();
    assert.equal(saved,'');
    failLoad = true;
    await page.reload();
    await page.getByRole('tab',{name:'Settings',exact:true}).click();
    await page.locator('#deepgram-feedback').filter({hasText:'Storage unavailable'}).waitFor();
    assert.equal(await key.isEnabled(),true);
    assert.deepEqual(errors,[]);
    console.log('DEEPGRAM_UI_PASS: drafts, save/check/remove, masking, pending controls, reload, load failure, mobile');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1)});
