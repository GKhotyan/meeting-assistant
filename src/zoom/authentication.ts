import type { Page, BrowserContext } from 'playwright';
import { zoomHost, ZoomState } from '../integrations/zoom-settings';
export type AuthView = {url:string;password:boolean;profile:boolean;signOut:boolean;challenge:boolean;accountControls?:boolean};
export function authenticatedView(view: AuthView): boolean {
  let url:URL; try { url=new URL(view.url); } catch { return false; }
  return url.protocol==='https:' && zoomHost(url.hostname) && /^\/profile\/?$/.test(url.pathname) &&
    !view.password && view.profile && (view.signOut || !!view.accountControls) && !view.challenge;
}
export async function verifyZoomAuthentication(page:Page): Promise<boolean> {
  const view = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const visible = (s:string) => [...document.querySelectorAll(s)].some(e => (e as HTMLElement).offsetWidth>0 && (e as HTMLElement).offsetHeight>0);
    return {url:location.href,password:visible('input[type="password"]'),
      profile: /personal|profile/i.test(text) && /sign.in email|account no|personal meeting id|edit/i.test(text),
      accountControls: !!document.querySelector('#common-header-profile-avatar') && !!document.querySelector('#UserProfile_profile-info') && !!document.querySelector('#sign-in-email-label'),
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
    await probe.waitForFunction(()=>{
      const password=document.querySelector('input[type="password"]') as HTMLElement|null;
      const profile=!!document.querySelector('#common-header-profile-avatar') &&
        !!document.querySelector('#UserProfile_profile-info') && !!document.querySelector('#sign-in-email-label');
      const legacy=!!document.querySelector('a[href*="logout"],a[href*="signout"]') &&
        /sign.in email|personal meeting id|account no/i.test(document.body?.innerText || '');
      return !!(password?.offsetWidth && password.offsetHeight) || profile || legacy;
    },{},{timeout:15000}).catch(()=>{});
    return await verifyZoomAuthentication(probe);
  } finally { await probe.close(); }
}
