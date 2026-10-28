import { fork } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { Controller } from "../session/controller";
import { createApp } from "./app";
import { Scheduler } from "../session/schedules";
const root = process.env.DATA_DIR || join(process.cwd(), "data");
mkdirSync(root, { recursive: true });
const host = process.env.HOST || "127.0.0.1";
if (process.env.ACCESS_MODE === "server" && !process.env.APP_PASSWORD)
  throw Error("Server mode requires APP_PASSWORD");
const controller = new Controller(root, (dir) => {
  const log = openSync(join(dir, "worker.log"), "a", 0o600);
  try {
    return fork(join(__dirname, "../worker/main.js"), [], {
      stdio: ["ignore", log, log, "ipc"],
      env: { ...process.env },
    });
  } finally {
    closeSync(log);
  }
});
const scheduler = new Scheduler(root, controller);
const server = createApp(controller, {
  password: process.env.APP_PASSWORD,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  publicDir: join(process.cwd(), "public"),
  scheduler,
});
server.listen(Number(process.env.PORT || 8088), host, () => {
  scheduler.start();
  console.log(
    "Meeting Assistant listening on port " + (process.env.PORT || 8088),
  );
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  await scheduler.stop();
  await controller.shutdown();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
