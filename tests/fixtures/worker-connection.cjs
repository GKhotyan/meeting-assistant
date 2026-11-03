// Replace only the external browser/Zoom/media boundaries; run the real worker and retry loop.
const { EventEmitter } = require("node:events");
const { join } = require("node:path");
const root = join(__dirname, "../..");
const scenario = process.env.CONNECTION_SCENARIO;
const probe = (event, extra = {}) => process.send?.({ type: "probe", event, ...extra });
function substitute(path, exports) {
  const id = require.resolve(join(root, path));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const timers = require("node:timers/promises");
const originalDelay = timers.setTimeout;
timers.setTimeout = (ms, value, options) => originalDelay(ms >= 10000 ? 30 : ms, value, options);
let count = 0;
let current;
substitute("src/worker/browser.ts", {
  launchZoomBrowser: async () => {
    const number = ++count;
    probe("launching", { number });
    if (scenario === "stop-launch") await originalDelay(100);
    const page = new EventEmitter(), context = new EventEmitter();
    let closed = false;
    page.isClosed = () => closed;
    page.screenshot = async options => {
      probe("diagnostic-screenshot", { number, options });
      if (scenario === "screenshot-failure") throw Error("Screenshot unavailable");
      if (closed) throw Error("Screenshot after browser cleanup");
    };
    const locator = { first: () => locator, click: async () => {}, isVisible: async () => false, allTextContents: async () => ["2"] };
    page.getByRole = page.locator = () => locator;
    page.number = number;
    current = page;
    probe("opened", { number });
    return { page, context, close: async () => {
      if (closed) throw Error("browser closed twice");
      closed = true; probe("closed", { number }); page.emit("close"); context.emit("close");
    } };
  },
});
const { AdmissionError } = require(join(root, "vendor/vexa/join/shared/admission.ts"));
substitute("vendor/vexa/join/zoom/join.ts", { joinZoomMeeting: async page => {
  if (["retry", "screenshot-failure"].includes(scenario) && page.number === 1) throw new AdmissionError("denial", "zoom_requires_rtms: automated bots aren't allowed");
  if (scenario === "stop-delay") throw Error("net::ERR_CONNECTION_RESET");
  if (scenario === "crash-connect" && page.number === 1) { page.emit("crash"); return new Promise(() => {}); }
} });
substitute("vendor/vexa/join/zoom/admission.ts", { waitForZoomMeetingAdmission: async () => {
  probe("admitting");
  if (scenario === "stop-admission") return new Promise(() => {});
  return true;
} });
substitute("vendor/vexa/join/zoom/leave.ts", {
  leaveZoomMeeting: async () => probe("leave"), dismissZoomPopups: async () => {},
});
substitute("src/worker/window.ts", { maximizeZoomWindow: async () => {} });
substitute("src/worker/audio.ts", { createAudioRecorder: async () => ({
  startedAtMs: Date.now(), stop: async () => { probe("audio-stopped"); return { id: "audio", kind: "audio" }; },
}) });
// Use real browser lifecycle and empty-meeting watcher; Zoom removal is an external event source.
substitute("vendor/vexa/join/zoom/removal.ts", { startZoomRemovalMonitor: () => () => {} });
process.on("message", m => { if (m.type === "probe-crash") current.emit("crash"); });
require(join(root, "src/worker/main.ts"));
