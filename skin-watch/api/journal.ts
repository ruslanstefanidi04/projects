import type { VercelRequest, VercelResponse } from "@vercel/node";
import { addJournal } from "../src/app/runtime.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
  const side = body.side === "sell" ? "sell" : "buy";
  const price = Number(body.price);
  if (!body.name || !Number.isFinite(price)) {
    res.status(400).json({ error: "name and price" });
    return;
  }
  res.status(200).json(addJournal(side, String(body.name), price));
}
