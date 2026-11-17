import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hydrateState, hydrateChats } from "../src/shared/store.js";
import { snapshot } from "../src/app/runtime.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const state = await hydrateState();
  await hydrateChats(state);
  res.setHeader("cache-control", "no-store");
  res.status(200).json(snapshot(state));
}
