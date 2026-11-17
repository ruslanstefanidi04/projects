import type { VercelRequest, VercelResponse } from "@vercel/node";
import { mutateConfig } from "../src/app/runtime.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
  res.status(200).json(await mutateConfig(body));
}
