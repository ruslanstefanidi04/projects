import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadSkinPng } from "../src/lib/skin-image.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = String(req.query.n ?? "");
  if (!name) {
    res.status(400).end();
    return;
  }
  const png = await loadSkinPng(name);
  if (!png) {
    res.status(404).end();
    return;
  }
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "public, max-age=86400");
  res.status(200).send(png);
}
