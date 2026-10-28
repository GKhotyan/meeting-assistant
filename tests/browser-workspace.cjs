const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/app/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let failStart = false;
  let releaseSettings, settingsPending;
  let settings = { botName: 'Workspace bot', recordingMode: 'video' };
  let sessions = [
    { id:'daily', meetingName:'Product standup', botName:'Workspace bot', status:'completed', createdAt:'2026-10-28T07:00:00Z', endedAt:'2026-10-28T07:30:00Z', files:[{id:'audio',kind:'audio',bytes:1048576}] },
    { id:'review', meetingName:'Design review', botName:'Workspace bot', status:'completed', createdAt:'2026-10-27T12:00:00Z', endedAt:'2026-10-27T13:00:00Z', files:[] }
  ];
  await page.route('http://workspace.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/settings') {
      if (request.method() === 'PUT') {
        if (settingsPending) { const pending = settingsPending; settingsPending = null; await pending; }
        settings = {...settings, ...request.postDataJSON()};
      }
      return route.fulfill({json:settings});
    }
    if (path === '/api/schedules') return route.fulfill({json:{schedules:[]}});
    if (path === '/api/sessions') {
      if (request.method() === 'POST' && failStart) return route.fulfill({status:409,json:{error:'A meeting is already active.'}});
      if (request.method() === 'POST') sessions.unshift({id:'active', ...request.postDataJSON(),status:'joining',createdAt:new Date().toISOString(),files:[]});
      return route.fulfill({json:{sessions}});
    }
    if (path.endsWith('/stop')) {sessions[0].status='completed'; return route.fulfill({json:{}});}
    return route.fulfill({body:readFileSync(require('node:path').join(__dirname,'../public',path==='/'?'index.html':path.slice(1))),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});
  });
  try {
    await page.goto('http://workspace.test');
    await page.getByRole('tab',{name:'Meetings',exact:true}).waitFor({timeout:3000});
    await page.getByText('Product standup',{exact:true}).waitFor();
    await page.getByRole('searchbox').fill('design');
    assert.equal(await page.locator('#sessions article').count(),1);
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('#sessions article').count(),1);
    await page.getByRole('searchbox').fill('no-match');
    await page.getByText('No matching meetings',{exact:true}).waitFor();
    await page.getByRole('searchbox').fill('');
    await page.getByRole('button',{name:'Record a meeting',exact:true}).click();
    await page.locator('#meetingName').fill('Weekly planning');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#record-dialog').isVisible(),false);
    assert.equal(await page.getByRole('button',{name:'Record a meeting',exact:true}).evaluate(e=>e===document.activeElement),true);
    settingsPending = new Promise(resolve => { releaseSettings = resolve; });
    await page.getByRole('button',{name:'Record a meeting',exact:true}).click();
    await page.locator('#botName').fill('Pending bot');
    await page.locator('#meetingName').focus();
    await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'Settings',exact:true}).click();
    await page.locator('#settings-bot').fill('Unsaved draft');
    releaseSettings();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Settings saved'));
    assert.equal(await page.locator('#settings-bot').inputValue(),'Unsaved draft');
    await page.locator('#settings-bot').fill('New assistant');
    await page.locator('#settings-mode').selectOption('audio');
    await page.getByRole('button',{name:'Save settings',exact:true}).click();
    await page.getByText('Settings saved for future meetings.',{exact:true}).waitFor();
    assert.equal(settings.botName,'New assistant');
    await page.getByRole('tab',{name:'Schedule',exact:true}).click();
    await page.getByRole('button',{name:'Add meeting',exact:true}).click();
    await page.locator('#schedule-name').fill('Keep this draft');
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('#schedule-name').inputValue(),'Keep this draft');
    await page.getByRole('tab',{name:'Meetings',exact:true}).click();
    await page.screenshot({path:(process.env.OUTPUT_DIR || '/tmp') + '/workspace-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'Record a meeting',exact:true}).click();
    assert.equal(await page.locator('#botName').inputValue(),'New assistant');
    await page.locator('#meetingUrl').fill('https://zoom.us/j/12345678901');
    failStart = true;
    await page.getByRole('button',{name:'Join and record',exact:true}).click();
    await page.locator('#record-notice').filter({hasText:'A meeting is already active.'}).waitFor({timeout:3000});
    failStart = false;
    await page.getByRole('button',{name:'Join and record',exact:true}).click();
    await page.locator('#active-session').waitFor();
    await page.getByRole('tab',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('#stop').isVisible(),true);
    await page.getByRole('tab',{name:'Meetings',exact:true}).click();
    await page.getByRole('searchbox').fill('no-match');
    assert.equal(await page.locator('#stop').isEnabled(),true);
    await page.locator('#stop').click();
    await page.waitForFunction(()=>document.getElementById('active-session').hidden);
    await page.getByRole('searchbox').fill('');
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:(process.env.OUTPUT_DIR || '/tmp') + '/workspace-mobile.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Record a meeting',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.querySelector('dialog').getBoundingClientRect().right>innerWidth),false);
    await page.keyboard.press('Escape');
    assert.deepEqual(errors,[]);
    console.log('WORKSPACE_PASS: navigation, search/polling, keyboard drawer, settings, start/stop, mobile');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
