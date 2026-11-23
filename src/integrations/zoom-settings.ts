import type { BrowserContext } from 'playwright';
import { CredentialStore } from './credential-store';
import { AppError } from '../session/types';
export type ZoomState = Awaited<ReturnType<BrowserContext['storageState']>>;
export const zoomHost = (hostname: string) => hostname === 'zoom.us' || hostname.endsWith('.zoom.us');
export function validateZoomState(value: unknown): ZoomState {
  const s = value as ZoomState;
  if (!s || !Array.isArray(s.cookies) || !s.cookies.length || !Array.isArray(s.origins) || JSON.stringify(s).length > 2_000_000)
    throw new AppError(400, 'Invalid Zoom session. Reconnect your account.');
  for (const c of s.cookies) {
    if (!c || !zoomHost(c.domain?.replace(/^\./, '') || '') || typeof c.name !== 'string' || !c.name || typeof c.value !== 'string' ||
      typeof c.path !== 'string' || !c.path.startsWith('/') || typeof c.expires !== 'number' || !Number.isFinite(c.expires) ||
      typeof c.httpOnly !== 'boolean' || typeof c.secure !== 'boolean' || !['Strict','Lax','None'].includes(c.sameSite))
      throw new AppError(400, 'Invalid Zoom session cookie.');
  }
  for (const o of s.origins) {
    let url: URL; try { url = new URL(o.origin); } catch { throw new AppError(400, 'Invalid Zoom session origin.'); }
    if (url.protocol !== 'https:' || !zoomHost(url.hostname) || url.origin !== o.origin || !Array.isArray(o.localStorage) ||
      o.localStorage.some(e => !e || typeof e.name !== 'string' || typeof e.value !== 'string'))
      throw new AppError(400, 'Invalid Zoom session origin.');
  }
  return structuredClone(s);
}
type SavedAccount = { email: string; state?: ZoomState; expired?: boolean };
export class ZoomSettings {
  private store: CredentialStore;
  constructor(root: string) { this.store = new CredentialStore(root); }
  private account() { return this.store.read().zoom as SavedAccount | undefined; }
  metadata() {
    const a = this.account();
    return { status: !a ? 'not_connected' : a.expired ? 'sign_in_required' : 'connected', email: a?.email || '' };
  }
  session(): ZoomState | undefined {
    const a = this.account();
    if (!a) return;
    if (a.expired) throw new AppError(409, 'Zoom sign-in required. Reconnect your account in Settings.');
    return validateZoomState(a.state);
  }
  save(email: string, state: ZoomState) {
    if (typeof email !== 'string' || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw new AppError(400, 'Enter a valid email address.');
    const validated = validateZoomState(state);
    this.store.write({ ...this.store.read(), zoom: { email, state: validated } });
  }
  markExpired() {
    const a = this.account();
    if (a) this.store.write({ ...this.store.read(), zoom: { email: a.email, expired: true } });
  }
  disconnect() {
    const value = this.store.read(); delete value.zoom; this.store.write(value);
  }
}
