import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchPersistentBrowser } from '../../vendor/vexa/remote-browser/browser';
import { getAuthenticatedBrowserArgs } from '../../vendor/vexa/remote-browser/args';
import { ZoomState, zoomHost } from '../integrations/zoom-settings';
import { hydrateSession, verifyContext } from './authentication';
import type { LoginDriver, BrowserInput } from './connection';
async function isolatedDisplay():Promise<{display:string;process:ChildProcess}> {
  const child=spawn('Xvfb',['-displayfd','3','-screen','0','1280x900x24','-nolisten','tcp','-ac'],{stdio:['ignore','ignore','ignore','pipe']});
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Login display timeout'));},5000);
    child.once('error',()=>{clearTimeout(timer);reject(Error('Login display unavailable'));});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Login display exited'));});
    child.stdio[3]?.once('data',data=>{ clearTimeout(timer); const id=String(data).trim();
      if(!/^\d+$/.test(id)){child.kill();reject(Error('Invalid login display'));}else resolve({display:':'+id,process:child}); });
  });
}
export async function createLoginBrowser(state?:ZoomState):Promise<LoginDriver> {
  const profile=mkdtempSync(join(tmpdir(),'zoom-login-'));
  let display:Awaited<ReturnType<typeof isolatedDisplay>>|undefined;
  let browser:Awaited<ReturnType<typeof launchPersistentBrowser>>|undefined;
  try {
    if(process.platform==='linux')display=await isolatedDisplay();
    browser=await launchPersistentBrowser({dataDir:profile,args:getAuthenticatedBrowserArgs(),display:display?.display,viewport:{width:1280,height:900}});
    const {context}=browser;
    if(state)await hydrateSession(context,state);
    let current=browser.page;
    context.on('page',page=>{void page.opener().then(opener=>{if(opener && !page.isClosed())current=page;}).catch(()=>{});});
    const page=():Page=>current.isClosed() ? context.pages().find(p=>!p.isClosed())! : current;
    // Probes are not interactive pages; preserve the user's focused login page.
    const verify=()=>verifyContext(context);
    let closed=false;
    return {
      async start(email,password) {
        await submitZoomCredentials(page(),email,password);
      },verify,
      async problem() {
        const text=await page().locator('body').innerText({timeout:3000});
        if(/incorrect|invalid password|wrong password|account.*locked/i.test(text)) return 'Zoom did not accept the credentials. Cancel to correct them, or continue in the browser.';
        return '';
      },
      async requiresAction() {
        return page().evaluate(()=>{
          const text=document.body?.innerText || '';
          const visible=(selector:string)=>[...document.querySelectorAll(selector)].some(e=>(e as HTMLElement).offsetWidth>0 && (e as HTMLElement).offsetHeight>0);
          return /verify your identity|enter[^\n]*verification code|complete[^\n]*captcha/i.test(text) ||
            visible('input[autocomplete="one-time-code"], iframe[title*="challenge" i][src*="recaptcha"], iframe[title*="challenge" i][src*="hcaptcha"]');
        });
      },
      async state(){const s=await context.storageState();return {cookies:s.cookies.filter(c=>zoomHost(c.domain.replace(/^\./,''))),origins:s.origins.filter(o=>zoomHost(new URL(o.origin).hostname))};},
      frame:()=>page().screenshot({type:'jpeg',quality:70,timeout:5000}),
      async input(a:BrowserInput) {
        const credentialsChanged=(a.type==='text'||a.type==='key') && await page().evaluate(()=>{
          const field=document.activeElement as HTMLInputElement|null;
          return field?.tagName==='INPUT' && (field.type==='password'||field.type==='email'||field.name==='email'||field.id==='email');
        });
        if(a.type==='click')await page().mouse.click(a.x,a.y);
        else if(a.type==='text')await page().keyboard.insertText(a.text);
        else if(a.type==='key')await page().keyboard.press(a.key);
        else await page().mouse.wheel(0,a.deltaY);
        return {credentialsChanged};
      },
      async close(){if(closed)return;closed=true;await context.close().catch(()=>{});display?.process.kill();rmSync(profile,{recursive:true,force:true});},
    };
  } catch(error) { await browser?.context.close().catch(()=>{});display?.process.kill();rmSync(profile,{recursive:true,force:true});throw error; }
}

export async function submitZoomCredentials(page:Page,email:string,password:string):Promise<void> {
  await page.goto('https://zoom.us/signin',{waitUntil:'domcontentloaded',timeout:30000});
  for(const s of ['#onetrust-reject-all-handler','#onetrust-accept-btn-handler'])
    await page.locator(s).click({timeout:700}).catch(()=>{});
  await page.locator('input[type="email"], #email, input[name="email"]').first().fill(email,{timeout:10000});
  const passwordField=page.locator('input[type="password"]').first();
  if(!await passwordField.isVisible()) {
    const next=page.getByRole('button',{name:/^next$/i}).first();
    if(await next.isVisible())await next.click({timeout:5000});
  }
  await passwordField.fill(password,{timeout:10000});
  await page.getByRole('button',{name:/^sign in$/i}).first().click({timeout:5000});
}
