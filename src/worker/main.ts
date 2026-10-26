import { maximizeZoomWindow } from "./window";
import { watchBrowser } from "./lifecycle";
import { launchZoomBrowser } from "./browser";

import type { BrowserContext, Page } from "playwright";
import { joinZoomMeeting } from "../../vendor/vexa/join/zoom/join";
import { waitForZoomMeetingAdmission } from "../../vendor/vexa/join/zoom/admission";
import {
  leaveZoomMeeting,
  dismissZoomPopups,
} from "../../vendor/vexa/join/zoom/leave";
import { startZoomRemovalMonitor } from "../../vendor/vexa/join/zoom/removal";
import { setHooks } from "../../vendor/vexa/join/_host";
import { createAudioRecorder } from "./audio";
import { captureMeetingScreenshot } from "./share-capture";
import { recordScreenshots } from "../recordings/screenshots";
import { recordScreen } from "../recordings/writer";
import { RecordingFile, StartInput } from "../session/types";
import { redact } from "../session/security";
let page: Page | undefined,
  context: BrowserContext | undefined,
  audio: Awaited<ReturnType<typeof createAudioRecorder>> | undefined,
  screen: Awaited<ReturnType<typeof recordScreen>> | undefined;
let screenshots: Awaited<ReturnType<typeof recordScreenshots>> | undefined;
let stopping: Promise<void> | undefined,
  started = false,
  stopRequested = false,
  removeMonitor: (() => void) | undefined,
  popupTimer: ReturnType<typeof setInterval> | undefined;
let detachBrowser: (() => void) | undefined;
let closeBrowser: (() => Promise<void>) | undefined;
let config: any;
let fault: string | undefined;
let files: RecordingFile[] = [];
const send = (m: unknown) => {
  if (process.connected) process.send?.(m);
};
async function stop(error?: string) {
  stopRequested = true;
  if (error) fault = redact(error);
  if (stopping) return stopping;
  return (stopping = (async () => {
    send({ type: "status", status: "stopping" });
    detachBrowser?.();
    removeMonitor?.();
    clearInterval(popupTimer);
    const watchdog = setTimeout(() => process.exit(1), 45000);
    watchdog.unref();
    try {
      if (audio) files.push(await audio.stop());
    } catch (e) {
      fault ??= redact(String(e));
    }
    try {
      if (screen) files.push(await screen.stop());
      if (screenshots) files.push(...await screenshots.stop());
    } catch (e) {
      fault ??= redact(String(e));
    }
    try {
      if (page && !page.isClosed())
        await leaveZoomMeeting(page, config, "manual_leave");
    } catch (e) {
      console.error("Leave:", redact(String(e)));
    }
    await closeBrowser?.().catch(() => {});
    clearTimeout(watchdog);
    const message = { type: "done", files, error: fault };
    if (process.connected)
      process.send?.(message, undefined, undefined, () =>
        process.exit(fault ? 1 : 0),
      );
    else process.exit(fault ? 1 : 0);
  })());
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.on("disconnect", () => void stop("Контроллер отключился"));
process.on("message", async (m: any) => {
  if (m.type === "stop") {
    void stop();
    return;
  }
  if (m.type !== "start" || started) return;
  started = true;
  try {
    const input = m.input as StartInput;
    config = {
      platform: "zoom",
      botName: input.botName,
      automaticLeave: { waitingRoomTimeout: 300000 },
    };
    setHooks({
      onState(state, detail) {
        send({
          type: "status",
          status: state === "awaiting_admission" ? "waiting" : "joining",
          detail:
            state === "blocked" || state === "needs_human_help"
              ? String(detail?.reason || "Zoom требует вмешательства")
              : undefined,
        });
      },
    });
    const browser = await launchZoomBrowser();
    context = browser.context;
    page = browser.page;
    closeBrowser = browser.close;
    detachBrowser = watchBrowser(
      page,
      context,
      () => void stop("Браузер Zoom неожиданно закрылся"),
    );
    if (stopRequested) return;
    await joinZoomMeeting(page, input.meetingUrl, input.botName, config);
    if (stopRequested) return;
    await waitForZoomMeetingAdmission(page, 300000, config);
    if (stopRequested) return;
    await maximizeZoomWindow(page);
    await dismissZoomPopups(page);
    await page
      .getByRole("button", { name: "Got it", exact: true })
      .first()
      .click({ timeout: 1000 })
      .catch(() => {});
    // Some Zoom tenants require an explicit computer-audio confirmation after admission.
    const computer = page
      .getByRole("button", { name: /Join (?:with )?Computer Audio/i })
      .first();
    if (await computer.isVisible()) await computer.click({ timeout: 3000 });
    popupTimer = setInterval(
      () => void dismissZoomPopups(page!).catch(() => {}),
      5000,
    );
    audio = await createAudioRecorder(
      page,
      m.sessionDir,
      (e) => void stop(e.message),
    );
    if (stopRequested) {
      await audio.stop().catch(() => {});
      return;
    }
    if (input.recordingMode === "screenshots") {
      screenshots = await recordScreenshots(m.sessionDir,
        (path) => captureMeetingScreenshot(page!, path),
        { audioStartedAtMs: audio.startedAtMs, onFault: (e) => void stop(e.message) });
    } else {
      screen = await recordScreen(m.sessionDir, {
        onFault: (e) => void stop(e.message),
      });
    }
    if (stopRequested) {
      await screen?.stop().catch(() => {});
      await screenshots?.stop().catch(() => {});
      return;
    }
    removeMonitor = startZoomRemovalMonitor(page, () => stop());
    send({ type: "status", status: "recording" });
  } catch (e) {
    await stop(String(e));
  }
});
