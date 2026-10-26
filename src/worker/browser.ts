import { launchPersistentBrowser } from "../../vendor/vexa/remote-browser/browser";
import { getAuthenticatedBrowserArgs } from "../../vendor/vexa/remote-browser/args";
import { getJoinBrowserArgs } from "../../vendor/vexa/join/browser-args";
import { createProfile } from "./profiles";
export async function launchZoomBrowser() {
  const profile = createProfile();
  try {
    const { context, page } = await launchPersistentBrowser({
      dataDir: profile.path,
      args: [...getAuthenticatedBrowserArgs(), ...getJoinBrowserArgs()],
    });
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
    profile.close();
    throw e;
  }
}
