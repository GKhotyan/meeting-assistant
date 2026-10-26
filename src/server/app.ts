import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  readFileSync,
  statSync,
  realpathSync,
  createReadStream,
  existsSync,
} from "node:fs";
import { join, basename, sep } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { Controller } from "../session/controller";
import { AppError } from "../session/types";
const hash = (s: string) => createHash("sha256").update(s).digest();
export function createApp(
  controller: Controller,
  options: { password?: string; publicDir: string },
) {
  return createServer(async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'",
      );
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname;
      const json = (status: number, data: unknown) => {
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(data));
      };
      if (path === "/health" && req.method === "GET") {
        json(200, { status: "ok" });
        return;
      }
      if (options.password) {
        const auth = req.headers.authorization || "";
        let valid = false;
        try {
          if (auth.startsWith("Basic ")) {
            const value = Buffer.from(auth.slice(6), "base64").toString();
            valid = timingSafeEqual(
              hash(value),
              hash("assistant:" + options.password),
            );
          }
        } catch {}
        if (!valid) {
          res.setHeader(
            "WWW-Authenticate",
            'Basic realm="Meeting Assistant", charset="UTF-8"',
          );
          json(401, { error: "Authentication required" });
          return;
        }
      }
      if (["POST", "PUT"].includes(req.method || "")) {
        if (
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          throw new AppError(403, "Cross-site requests are not allowed");
        if (!(req.headers["content-type"] || "").startsWith("application/json"))
          throw new AppError(415, "Content-Type must be application/json");
      }
      const body = async () => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16384) throw new AppError(413, "Request body is too large");
          chunks.push(chunk);
        }
        try {
          return JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } catch {
          throw new AppError(400, "Invalid JSON");
        }
      };
      if (path === "/api/settings") {
        if (req.method === "GET") json(200, controller.settings());
        else if (req.method === "PUT")
          json(200, controller.setSettings(await body()));
        else throw new AppError(405, "Method not allowed");
        return;
      }
      if (path === "/api/sessions") {
        if (req.method === "GET") json(200, { sessions: controller.list() });
        else if (req.method === "POST")
          json(201, await controller.startSession(await body()));
        else throw new AppError(405, "Method not allowed");
        return;
      }
      const stop = path.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/stop$/);
      if (stop && req.method === "POST") {
        await body();
        const id = stop[1];
        if (!controller.getSession(id))
          throw new AppError(404, "Session not found");
        void controller.stopSession(id).catch(() => {});
        json(202, { status: "stopping" });
        return;
      }
      const detail = path.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)$/);
      if (detail && req.method === "GET") {
        const session = controller.getSession(detail[1]);
        if (!session) throw new AppError(404, "Session not found");
        json(200, session);
        return;
      }
      const download = path.match(
        /^\/api\/sessions\/([a-zA-Z0-9-]+)\/files\/([a-zA-Z0-9-]+)$/,
      );
      if (download && req.method === "GET") {
        const [_, sid, fid] = download;
        const session = controller.getSession(sid),
          file = session?.files.find(
            (f) => f.id === fid && f.status === "ready",
          );
        if (!file || basename(file.name) !== file.name)
          throw new AppError(404, "File not found");
        const dir = join(controller.root, "recordings", sid),
          target = join(dir, file.name);
        if (
          !existsSync(target) ||
          !realpathSync(target).startsWith(realpathSync(dir) + sep) ||
          !statSync(target).isFile()
        )
          throw new AppError(404, "File not found");
        res.writeHead(200, {
          "Content-Type": file.kind === "audio" ? "audio/webm" : file.kind === "screenshot" ? "image/jpeg" : "video/mp4",
          "Content-Length": statSync(target).size,
          "Content-Disposition": `attachment; filename="${sid}-${file.name}"`,
        });
        const stream = createReadStream(target);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
        return;
      }
      const assets: Record<string, string> = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      };
      if (req.method === "GET" && assets[path]) {
        const file = assets[path];
        const mime = file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : file.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8";
        res.writeHead(200, { "Content-Type": mime });
        res.end(readFileSync(join(options.publicDir, file)));
        return;
      }
      throw new AppError(404, "Not found");
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = e instanceof AppError ? e.status : 500;
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(
        JSON.stringify({
          error:
            status === 500
              ? "Internal error. Check the server logs."
              : (e as Error).message,
        }),
      );
      if (status === 500)
        console.error("HTTP request failed:", (e as Error).name);
    }
  });
}
