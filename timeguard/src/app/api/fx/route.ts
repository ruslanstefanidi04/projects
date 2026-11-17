import { NextResponse } from "next/server";
import { isCurrency } from "@/shared/lib/currencies";
import { requireUserId } from "@/shared/lib/session";

type CacheEntry = { at: number; rates: Record<string, number> };

const cache = new Map<string, CacheEntry>();
const TTL = 60 * 60 * 1000;

async function fromOpenEr(base: string) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
  };
  if (data.result !== "success" || !data.rates) return null;
  return data.rates;
}

async function fromCurrencyApi(base: string) {
  const code = base.toLowerCase();
  const res = await fetch(
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${code}.min.json`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, Record<string, number>>;
  const raw = data[code];
  if (!raw) return null;
  const rates: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    rates[key.toUpperCase()] = value;
  }
  rates[base] = 1;
  return rates;
}

export async function GET(req: Request) {
  try {
    await requireUserId();
    const url = new URL(req.url);
    const base = (url.searchParams.get("base") || "USD").toUpperCase();
    if (!isCurrency(base)) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    const hit = cache.get(base);
    if (hit && Date.now() - hit.at < TTL) {
      return NextResponse.json({ base, rates: hit.rates });
    }

    const rates = (await fromOpenEr(base)) ?? (await fromCurrencyApi(base));
    if (!rates) {
      if (hit) return NextResponse.json({ base, rates: hit.rates, stale: true });
      return NextResponse.json({ error: "fx" }, { status: 502 });
    }

    rates[base] = 1;
    cache.set(base, { at: Date.now(), rates });
    return NextResponse.json({ base, rates });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
