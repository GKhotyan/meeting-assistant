import type { ZoomState } from "../integrations/zoom-settings";
import { hydrateSession, verifyContext } from "../zoom/authentication";
import { AdmissionError } from "../../vendor/vexa/join/shared/admission";
import { launchPersistentBrowser } from "../../vendor/vexa/remote-browser/browser";
import { getAuthenticatedBrowserArgs } from "../../vendor/vexa/remote-browser/args";
import { getJoinBrowserArgs } from "../../vendor/vexa/join/browser-args";
import { createProfile } from "./profiles";
export async function launchZoomBrowser(state?: ZoomState) {
  const profile = createProfile();
  let owned: Awaited<ReturnType<typeof launchPersistentBrowser>> | undefined;
  try {
    const { context, page } = owned = await launchPersistentBrowser({
      dataDir: profile.path,
      args: [...getAuthenticatedBrowserArgs(), ...getJoinBrowserArgs().filter(arg => !state || arg !== "--incognito")],
    });
    if (state) {
      await hydrateSession(context, state);
      if (!await verifyContext(context)) throw new AdmissionError('auth_session_missing', 'Zoom sign-in required. Reconnect your account in Settings.');
    }
    return {
      context,
      page,
      async close() {
        try {
          await context.close();
        } finally {
          profile.close();
        }
      },
    };
  } catch (e) {
    await owned?.context.close().catch(() => {});
    profile.close();
    throw e;
  }
}
