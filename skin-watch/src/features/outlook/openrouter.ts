import { z } from "zod";
import { config } from "../../shared/config.js";
import type { FedRow } from "./universe.js";
import type { OutlookPick, OutlookReport } from "./types.js";

const schema = z.object({
  regime: z.string(),
  newsNotes: z.string(),
  picks: z.array(
    z.object({
      name: z.string(),
      stance: z.enum(["grow", "watch", "avoid"]),
      confidence: z.number().min(0).max(100),
      thesis: z.string(),
      risks: z.string(),
    }),
  ),
});

function compact(row: FedRow) {
  const pct = (n: number | null) => (n == null ? null : Number((n * 100).toFixed(1)));
  return {
    n: row.name,
    min: row.min,
    sug: row.suggested,
    mean: row.mean,
    med: row.median,
    qty: row.qty,
    a7: row.d7avg,
    a30: row.d30avg,
    a90: row.d90avg,
    v7: row.d7vol,
    v30: row.d30vol,
    t7_30: pct(row.trend7v30),
  };
}

export async function askOutlook(fed: FedRow[], regime: string): Promise<Omit<OutlookReport, "at" | "catalogSize" | "fed">> {
  if (!config.openrouterKey) throw new Error("no OPENROUTER_API_KEY");

  const body = {
    model: config.openrouterModel,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "you are a skeptical cs2 skin market analyst. horizon is 12 months. you are not a prophet. " +
          "use the numeric tape as ground truth. use web/news only for dated events (majors, operations, valve notes, payment shocks). " +
          "prefer discontinued-feeling supply, liquid enough to exit, and theses that survive boredom. " +
          "punish already-parabolic names, dead names with fake suggested, and anything that needs a gem/float you cannot see. " +
          "return json only: {regime, newsNotes, picks:[{name,stance,confidence,thesis,risks}]}. " +
          "picks: 8-18 grow, a few watch, a few avoid. names must be copied exactly from the feed. " +
          "english fields, short sentences. no emojis. not financial advice.",
      },
      {
        role: "user",
        content: JSON.stringify({
          horizon: "12 months",
          today: new Date().toISOString(),
          regime,
          extraNotes: process.env.OUTLOOK_EVENTS ?? "",
          tape: fed.map(compact),
        }),
      },
    ],
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openrouterKey}`,
      "content-type": "application/json",
      "http-referer": "https://prgt-vault.vercel.app",
      "x-title": "vault outlook",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const raw = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = raw.choices?.[0]?.message?.content ?? "";
  const parsed = schema.parse(JSON.parse(stripFence(text)));
  const byName = new Map(fed.map((r) => [r.name, r]));
  const picks: OutlookPick[] = [];
  for (const p of parsed.picks) {
    const hit = byName.get(p.name) ?? [...byName.values()].find((r) => r.name.toLowerCase() === p.name.toLowerCase());
    if (!hit) continue;
    picks.push({
      name: hit.name,
      stance: p.stance,
      confidence: Math.round(p.confidence),
      thesis: p.thesis.slice(0, 400),
      risks: p.risks.slice(0, 280),
      url: hit.url,
      minPrice: hit.min,
    });
  }
  return {
    model: config.openrouterModel,
    regime: parsed.regime.slice(0, 800),
    newsNotes: parsed.newsNotes.slice(0, 800),
    picks,
    disclaimer:
      "weekly narrative pass, not a forecast you can bank. valve, liquidity, and you clicking buy decide the year.",
  };
}

function stripFence(text: string) {
  const t = text.trim();
  if (t.startsWith("```")) return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return t;
}
