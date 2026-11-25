import { ZoomSettings, ZoomState, RecoveryAccount } from '../integrations/zoom-settings';
import type { LoginDriver } from './connection';
import { createLoginBrowser } from './login-browser';
import { setTimeout as delay } from 'node:timers/promises';

const signInRequired = () => new Error('Zoom sign-in required. Automatic sign-in could not complete. Reconnect your account in Settings; Zoom may require a verification code or CAPTCHA.');

/** One credential submission, with cancellation and protection against stale account writes. */
export async function recoverZoomSession(settings: ZoomSettings, signal: AbortSignal,
  factory: () => Promise<LoginDriver> = createLoginBrowser,
  persist: (account: RecoveryAccount, state?: ZoomState) => Promise<boolean> = async (account, state) => {
    if (!settings.isCurrent(account)) return false;
    if (state) return settings.saveRecovered(account, state);
    settings.markExpired(); return true;
  }, timing = { pollMs: 3000, timeoutMs: 60000 }): Promise<ZoomState> {
  signal.throwIfAborted();
  const account = settings.recoveryAccount();
  if (!account) throw signInRequired();
  let browser: LoginDriver | undefined;
  let stage = 'launching';
  let reason = 'browser_error';
  let deadline: NodeJS.Timeout | undefined;
  let finished = false;
  const waiting = new AbortController();
  const ensureActive = () => {
    signal.throwIfAborted();
    if (finished) throw signInRequired();
    if (!settings.isCurrent(account)) {
      reason = 'account_changed';
      throw signInRequired();
    }
  };
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
    ensureActive();
    const expired = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        reason = 'timeout';
        finished = true;
        reject(signInRequired());
      }, timing.timeoutMs);
    });
    const login = async () => {
      stage = 'submitting';
      await browser!.start(account.email, account.password);
      ensureActive();
      stage = 'verifying';
      while (true) {
        const verified = await browser!.verify();
        ensureActive();
        if (verified) break;
        const problem = await browser!.problem();
        ensureActive();
        if (problem) {
          reason = 'credentials_rejected';
          throw signInRequired();
        }
        const challenge = await browser!.requiresAction?.();
        ensureActive();
        if (challenge) {
          reason = 'action_required';
          throw signInRequired();
        }
        await delay(timing.pollMs, undefined, { signal: waiting.signal });
        ensureActive();
      }
      const state = await browser!.state();
      ensureActive();
      // The deadline bounds Zoom sign-in, not the controller's persistence acknowledgement.
      clearTimeout(deadline);
      stage = 'saving';
      reason = 'persistence_failed';
      if (!await persist(account, state)) throw signInRequired();
      return state;
    };
    return await Promise.race([login(), cancelled, expired]);
  } catch {
    signal.throwIfAborted();
    console.warn(`Zoom automatic sign-in failed: stage=${stage} reason=${reason}`);
    await persist(account).catch(() => false);
    // Browser errors can include credential field contents. Return only fixed copy.
    throw signInRequired();
  } finally {
    finished = true;
    clearTimeout(deadline);
    waiting.abort();
    signal.removeEventListener('abort', aborted);
    await browser?.close().catch(() => {});
  }
}
