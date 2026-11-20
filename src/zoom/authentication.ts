import type { Page, BrowserContext } from 'playwright';
import { zoomHost, ZoomState } from '../integrations/zoom-settings';
export type AuthView = {url:string;password:boolean;profile:boolean;signOut:boolean;challenge:boolean};
export function authenticatedView(view: AuthView): boolean {
  let url:URL; try { url=new URL(view.url); } catch { return false; }
  return url.protocol==='https:' && zoomHost(url.hostname) && /^\/profile\/?$/.test(url.pathname) &&
    !view.password && view.profile && view.signOut && !view.challenge;
}
export async function verifyZoomAuthentication(page:Page): Promise<boolean> {
  const view = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const visible = (s:string) => [...document.querySelectorAll(s)].some(e => (e as HTMLElement).offsetWidth>0 && (e as HTMLElement).offsetHeight>0);
    return {url:location.href,password:visible('input[type="password"]'),
      profile: /personal|profile/i.test(text) && /sign.in email|account no|personal meeting id|edit/i.test(text),
      signOut: !!document.querySelector('a[href*="logout"], a[href*="signout"], [data-testid="sign-out"]') || /sign out/i.test(text),
      challenge: /verify your identity|enter.*verification code|complete.*captcha/i.test(text)};
  });
  return authenticatedView(view);
}
export async function hydrateSession(context: BrowserContext, state:ZoomState) {
  await context.addCookies(state.cookies);
  await context.addInitScript(origins => {
    const o = origins.find(v=>v.origin===location.origin);
    if (o) for (const item of o.localStorage) localStorage.setItem(item.name,item.value);
  },state.origins);
}
export async function verifyContext(context:BrowserContext):Promise<boolean> {
  const probe = await context.newPage();
  try {
    await probe.goto('https://zoom.us/profile',{waitUntil:'domcontentloaded',timeout:20000});
    // The profile is rendered asynchronously; do not treat the initial shell as success.
    await probe.waitForFunction(()=>!!document.querySelector('input[type="password"]') || /sign.in email|personal meeting id|account no|edit/i.test(document.body?.innerText || ''),{},{timeout:8000}).catch(()=>{});
    return await verifyZoomAuthentication(probe);
  } finally { await probe.close(); }
}
