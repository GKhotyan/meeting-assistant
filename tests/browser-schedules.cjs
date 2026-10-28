// Run in the application's Playwright image with the repository mounted at /work.
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { EventEmitter } = require("node:events");
const { chromium } = require("/app/node_modules/playwright");
const { Controller } = require("../dist/src/session/controller");
const { Scheduler } = require("../dist/src/session/schedules");
const { createApp } = require("../dist/src/server/app");

(async () => {
  const root = mkdtempSync("/tmp/ea-schedule-browser-");
  const workers = [], launches = [];
  const controller = new Controller(root, () => {
    const worker = new EventEmitter();
    worker.send = message => { if (message.type === "start") launches.push(message); };
    worker.kill = () => {};
    workers.push(worker);
    return worker;
  });
  let now = new Date("2026-10-26T06:59:00Z");
  const scheduler = new Scheduler(root, controller, () => now);
  const server = createApp(controller, { publicDir: "/work/public", scheduler });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(base);
    await page.getByRole("tab", { name: "Schedule", exact: true }).click();
    assert.equal(await page.locator("#join").isVisible(), false);
    await page.getByRole("button", { name: "Add meeting", exact: true }).click();
    assert.equal(await page.locator("#schedule-bot").inputValue(), "Engineering Assistant");
    await page.locator("#schedule-bot").fill("Team assistant");
    await page.locator("#schedule-name").fill("Daily <team>");
    await page.locator("#schedule-url").fill("https://zoom.us/j/12345678901?pwd=private");
    await page.locator("#schedule-mode").selectOption("audio");
    await page.getByRole("button", { name: "Save meeting", exact: true }).click();
    await page.getByText("Choose at least one weekday.", { exact: true }).waitFor();
    for (const day of ["Mon", "Tue", "Thu", "Fri"]) await page.locator(".weekdays label").filter({ hasText: day }).click();
    await page.waitForTimeout(2200); // Exercise the real polling timer during an edit.
    assert.equal(await page.locator("#schedule-name").inputValue(), "Daily <team>");
    await page.getByRole("button", { name: "Save meeting", exact: true }).click();
    await page.locator(".schedule-card").getByText("Daily <team>", { exact: true }).waitFor();
    assert.match(await page.locator(".schedule-card").innerText(), /Mon, Tue, Thu, Fri · 10:00 · Europe\/Moscow · Audio only/);
    assert.equal(scheduler.list()[0].nextRunAt, "2026-10-26T07:00:00.000Z");
    assert.equal(await page.locator(".schedule-card team").count(), 0);

    scheduler.create({ name: "Overlapping grooming", meetingUrl: "https://zoom.us/j/12345678901", weekdays: [1], time: "10:00", timeZone: "Europe/Moscow", recordingMode: "video" });
    now = new Date("2026-10-26T07:00:10Z");
    await scheduler.tick();
    await page.getByText("Skipped because another meeting is still active.", { exact: false }).waitFor();
    assert.equal(launches.length, 1);
    assert.equal(launches[0].input.botName, "Team assistant");
    assert.equal(launches[0].input.recordingMode, "audio");
    assert.equal(launches[0].input.meetingName, "Daily <team>");
    assert.match(launches[0].sessionDir, /\/Daily_team_[a-f0-9-]{36}$/);
    assert.equal(JSON.parse(readFileSync(launches[0].sessionDir + "/session.json", "utf8")).meetingName, "Daily <team>");
    assert.match(launches[0].input.meetingUrl, /pwd=private/);
    await new Scheduler(root, controller, () => now).tick();
    assert.equal(launches.length, 1);
    await page.screenshot({ path: "/output/schedules-desktop.png", fullPage: true });

    const card = page.locator(".schedule-card").filter({ hasText: "Daily <team>" });
    await card.getByRole("button", { name: "Edit", exact: true }).focus();
    await page.evaluate(() => refresh());
    assert.equal(await card.getByRole("button", { name: "Edit", exact: true }).evaluate(el => el === document.activeElement), true, "polling preserves schedule keyboard focus");
    await card.getByRole("button", { name: "Pause", exact: true }).click();
    await card.getByRole("button", { name: "Resume", exact: true }).waitFor();
    assert.equal(scheduler.list()[0].enabled, false);
    assert.equal(controller.list()[0].meetingName, "Daily <team>");
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(await page.locator("#schedule-bot").inputValue(), "Team assistant");
    await page.locator("#schedule-bot").fill("Updated assistant");
    await page.locator("#schedule-name").fill("Updated daily");
    await page.locator("#schedule-time").fill("11:15");
    await page.getByRole("button", { name: "Save meeting", exact: true }).click();
    await page.locator(".schedule-card").getByText("Updated daily", { exact: true }).waitFor();
    assert.equal(scheduler.list()[0].enabled, false);
    await page.locator(".schedule-card").filter({ hasText: "Updated daily" }).getByRole("button", { name: "Resume", exact: true }).click();
    await page.locator(".schedule-card").filter({ hasText: "Updated daily" }).getByRole("button", { name: "Pause", exact: true }).waitFor();
    assert.equal(scheduler.list()[0].nextRunAt, "2026-10-26T08:15:00.000Z");
    assert.equal(scheduler.list()[0].botName, "Updated assistant");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Add meeting", exact: true }).click();
    await page.screenshot({ path: "/output/schedules-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    page.once("dialog", dialog => dialog.dismiss());
    await page.locator(".schedule-card").filter({ hasText: "Updated daily" }).getByRole("button", { name: "Delete schedule" }).click();
    assert.equal(scheduler.list().length, 2);
    page.once("dialog", dialog => dialog.accept());
    await page.locator(".schedule-card").filter({ hasText: "Updated daily" }).getByRole("button", { name: "Delete schedule" }).click();
    await page.getByText("Schedule deleted. Existing recordings are kept.", { exact: true }).waitFor();
    assert.equal(scheduler.list().length, 1);
    assert.equal(controller.list().length, 1);
    await page.getByRole("tab", { name: "Meetings", exact: true }).click();
    await page.getByRole("button", { name: "Record a meeting", exact: true }).click();
    assert.equal(await page.locator("#join").isVisible(), true);
    assert.deepEqual(errors, []);
    workers[0].emit("message", { type: "done", files: [] });
    workers[0].emit("exit", 0, null);
    console.log("SCHEDULE_BROWSER_PASS: CRUD, tabs, four weekdays, polling, single-worker overlap, restart, responsive layout");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
