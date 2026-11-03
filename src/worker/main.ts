import { connectWithRetries } from "./connect";
import { maximizeZoomWindow } from "./window";
import { watchBrowser } from "./lifecycle";
import { readZoomParticipantCount, watchEmptyMeeting } from "./empty-meeting";
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
import { join } from "node:path";
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
let emptyMeetingMonitor: ReturnType<typeof watchEmptyMeeting> | undefined;
let closeBrowser: (() => Promise<void>) | undefined;
const connectionAbort = new AbortController();
let connectionTask: Promise<Awaited<ReturnType<typeof launchZoomBrowser>>> | undefined;
let config: any;
let fault: string | undefined;
let files: RecordingFile[] = [];
const send = (m: unknown) => {
  if (process.connected) process.send?.(m);
};
async function stop(error?: string) {
  stopRequested = true;
  connectionAbort.abort();
  if (error) fault = redact(error);
  if (stopping) return stopping;
  return (stopping = (async () => {
    send({ type: "status", status: "stopping" });
    detachBrowser?.();
    removeMonitor?.();
    emptyMeetingMonitor?.stop();
    clearInterval(popupTimer);
    const watchdog = setTimeout(() => process.exit(1), 45000);
    watchdog.unref();
    // Await launch/admission cleanup before finalizing or exiting the worker.
    await connectionTask?.catch(() => {});
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
process.on("disconnect", () => void stop("Controller disconnected"));
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
        if (stopRequested) return;
        send({
          type: "status",
          status: state === "awaiting_admission" ? "waiting" : "joining",
          detail:
            state === "blocked" || state === "needs_human_help"
              ? String(detail?.reason || "Zoom requires manual assistance")
              : undefined,
        });
      },
    });
    let connectionAttempt = 0;
    connectionTask = connectWithRetries({
      signal: connectionAbort.signal,
      open: () => {
        connectionAttempt++;
        return launchZoomBrowser();
      },
      async connect(browser) {
        const attempt = connectionAttempt;
        let detach: (() => void) | undefined;
        const closed = new Promise<never>((_, reject) => {
          detach = watchBrowser(browser.page, browser.context, () =>
            reject(Error("The Zoom browser closed unexpectedly")));
        });
        try {
          await Promise.race([
            (async () => {
              await joinZoomMeeting(browser.page, input.meetingUrl, input.botName, config);
              connectionAbort.signal.throwIfAborted();
              await waitForZoomMeetingAdmission(browser.page, 300000, config);
            })(),
            closed,
          ]);
        } catch (error) {
          // Capture before retry cleanup navigates away or closes the failed page.
          // Diagnostic failures must never replace the connection error.
          if (!connectionAbort.signal.aborted && !browser.page.isClosed()) {
            const filename = `connection-attempt-${attempt}-error.png`;
            try {
              await browser.page.screenshot({
                path: join(m.sessionDir, filename),
                type: "png",
                timeout: 5000,
              });
              console.log(`Connection attempt ${attempt}: diagnostic screenshot saved to ${filename}`);
            } catch (captureError) {
              console.log(`Connection attempt ${attempt}: screenshot unavailable: ${redact(String(captureError))}`);
            }
          }
          throw error;
        } finally { detach?.(); }
      },
      async close(browser) {
        try {
          if (!browser.page.isClosed())
            await leaveZoomMeeting(browser.page, config, "manual_leave");
        } finally { await browser.close(); }
      },
      onChange(state) { send({ type: "attempts", ...state }); },
    }).then(browser => {
      context = browser.context;
      page = browser.page;
      closeBrowser = browser.close;
      detachBrowser = watchBrowser(page, context,
        () => void stop("The Zoom browser closed unexpectedly"));
      return browser;
    });
    await connectionTask;
    if (stopRequested) return;
    // Everything after admission belongs to recording, never to the retry loop.
    await maximizeZoomWindow(page!);
    await dismissZoomPopups(page!);
    await page!
      .getByRole("button", { name: "Got it", exact: true })
      .first()
      .click({ timeout: 1000 })
      .catch(() => {});
    // Some Zoom tenants require an explicit computer-audio confirmation after admission.
    const computer = page!
      .getByRole("button", { name: /Join (?:with )?Computer Audio/i })
      .first();
    if (await computer.isVisible()) await computer.click({ timeout: 3000 });
    popupTimer = setInterval(
      () => void dismissZoomPopups(page!).catch(() => {}),
      5000,
    );
    audio = await createAudioRecorder(
      page!,
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
    } else if (input.recordingMode !== "audio") {
      screen = await recordScreen(m.sessionDir, {
        onFault: (e) => void stop(e.message),
      });
    }
    if (stopRequested) {
      await screen?.stop().catch(() => {});
      await screenshots?.stop().catch(() => {});
      return;
    }
    removeMonitor = startZoomRemovalMonitor(page!, () => stop());
    emptyMeetingMonitor = watchEmptyMeeting(
      () => readZoomParticipantCount(page!),
      () => {
        console.log("Leaving Zoom after two minutes without other participants");
        void stop();
      },
    );
    void emptyMeetingMonitor.check();
    send({ type: "status", status: "recording" });
  } catch (e) {
    if (!stopRequested) await stop(String(e));
  }
});
