import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { config } from "../shared/config.js";
import { publicState, saveState, type RuntimeState } from "../shared/store.js";
import { normalizeWatch } from "../entities/listing.js";
import { saveFilters } from "../shared/filters.js";
import { pnl } from "../entities/journal.js";
import { bus } from "./bus.js";
import type { Alert } from "../entities/listing.js";
import { loadSkinPng } from "../lib/skin-image.js";
import { loadOutlook } from "../features/outlook/store.js";
import { runOutlook } from "../features/outlook/run.js";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const webRoot = resolve(process.cwd(), "web");

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function startDesk(getState: () => RuntimeState, getBoard: () => Alert[]) {
  const clients = new Set<ServerResponse>();

  bus.on("alerts", (alerts: Alert[]) => {
    const line = `event: alerts\ndata: ${JSON.stringify(alerts)}\n\n`;
    for (const c of clients) c.write(line);
  });
  bus.on("tick", (payload: unknown) => {
    const line = `event: tick\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const c of clients) c.write(line);
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://desk.local");
    const state = getState();

    if (req.method === "GET" && url.pathname === "/api/img") {
      const name = url.searchParams.get("n") ?? "";
      if (!name) {
        res.writeHead(400);
        res.end();
        return;
      }
      const png = await loadSkinPng(name);
      if (!png) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      });
      res.end(png);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      json(res, 200, {
        currency: config.currency,
        pollSec: config.pollSec,
        ...publicState(state),
        board: getBoard(),
        pnl: pnl(state.journal),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("event: hello\ndata: {}\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config") {
      const raw = JSON.parse(await readBody(req)) as Partial<RuntimeState> & { watchText?: string };
      if (typeof raw.enabled === "boolean") state.enabled = raw.enabled;
      for (const key of ["spreadPct", "extremePct", "snipePct", "snipeMaxQty", "floor"] as const) {
        const n = Number(raw[key]);
        if (Number.isFinite(n) && n >= 0) state[key] = n;
      }
      if (typeof raw.watchText === "string") {
        state.watch = normalizeWatch(raw.watchText.split(",").map((s) => s.trim()).filter(Boolean));
      }
      saveState(state);
      await saveFilters(state);
      json(res, 200, publicState(state));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/outlook") {
      const report = await loadOutlook();
      json(res, 200, { ok: true, configured: Boolean(config.openrouterKey), model: config.openrouterModel, report });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/outlook") {
      try {
        const report = await runOutlook(true);
        json(res, 200, { ok: true, report });
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : "outlook failed" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/journal") {
      const raw = JSON.parse(await readBody(req)) as { side?: string; name?: string; price?: number };
      const side = raw.side === "sell" ? "sell" : "buy";
      const price = Number(raw.price);
      if (!raw.name || !Number.isFinite(price)) {
        json(res, 400, { error: "name and price" });
        return;
      }
      state.journal.push({ side, name: String(raw.name), price, at: new Date().toISOString() });
      saveState(state);
      json(res, 200, { journal: state.journal, pnl: pnl(state.journal) });
      return;
    }

    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(webRoot, path.replace(/^\/+/, ""));
    if (!file.startsWith(webRoot) || !existsSync(file)) {
      json(res, 404, { error: "missing" });
      return;
    }
    const ext = extname(file);
    res.writeHead(200, { "content-type": mime[ext] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });

  server.listen(config.webPort, "127.0.0.1", () => {
    console.log(`desk http://127.0.0.1:${config.webPort}`);
  });
  return server;
}
