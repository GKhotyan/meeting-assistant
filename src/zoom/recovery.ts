import { ZoomSettings, ZoomState, RecoveryAccount } from '../integrations/zoom-settings';
import type { LoginDriver } from './connection';
import { createLoginBrowser } from './login-browser';

const signInRequired = () => new Error('Zoom sign-in required. Automatic sign-in could not complete. Reconnect your account in Settings; Zoom may require a verification code or CAPTCHA.');

/** One credential submission, with cancellation and protection against stale account writes. */
export async function recoverZoomSession(settings: ZoomSettings, signal: AbortSignal,
  factory: () => Promise<LoginDriver> = createLoginBrowser,
  persist: (account: RecoveryAccount, state?: ZoomState) => Promise<boolean> = async (account, state) => {
    if (!settings.isCurrent(account)) return false;
    if (state) return settings.saveRecovered(account, state);
    settings.markExpired(); return true;
  }): Promise<ZoomState> {
  signal.throwIfAborted();
  const account = settings.recoveryAccount();
  if (!account) throw signInRequired();
  let browser: LoginDriver | undefined;
  let aborted!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    aborted = () => reject(new DOMException('Connection stopped', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
  });
  // Cancellation can occur while the non-cancellable browser launch is pending.
  void cancelled.catch(() => {});
  // Launch must settle before cleanup can own the resulting browser.
  try {
    browser = await factory();
    signal.throwIfAborted();
    if (!settings.isCurrent(account)) throw signInRequired();
    const login = async () => {
      await browser!.start(account.email, account.password);
      signal.throwIfAborted();
      if (!await browser!.verify()) throw signInRequired();
      const state = await browser!.state();
      signal.throwIfAborted();
      if (!await persist(account, state)) throw signInRequired();
      return state;
    };
    return await Promise.race([login(), cancelled]);
  } catch {
    signal.throwIfAborted();
    await persist(account).catch(() => false);
    // Browser errors can include credential field contents. Return only fixed copy.
    throw signInRequired();
  } finally {
    signal.removeEventListener('abort', aborted);
    await browser?.close().catch(() => {});
  }
}
