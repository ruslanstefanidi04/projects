export function jitter(minMs: number, maxMs: number) {
  const a = Math.min(minMs, maxMs);
  const b = Math.max(minMs, maxMs);
  return a + Math.random() * (b - a);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function sleepJitter(minMs: number, maxMs: number) {
  return sleep(jitter(minMs, maxMs));
}

export class RateGate {
  min: number;
  max: number;
  next = 0;
  strikes = 0;

  constructor(minMs: number, maxMs: number) {
    this.min = minMs;
    this.max = maxMs;
  }

  async take() {
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    const gap = jitter(this.min, this.max);
    const extra = this.strikes * jitter(7000, 16000);
    this.next = now + wait + gap + extra;
    if (wait > 0) await sleep(wait);
    await sleepJitter(80, Math.min(1400, gap * 0.22 + 80));
  }

  bump() {
    this.strikes = Math.min(8, this.strikes + 1);
    this.next = Date.now() + jitter(20000, 55000) * (this.strikes + 1);
  }

  ok() {
    this.strikes = Math.max(0, this.strikes - 1);
  }
}

export const gates = {
  steamApi: new RateGate(1800, 4200),
  inventory: new RateGate(6500, 14000),
  ping: new RateGate(25000, 48000),
  summaries: new RateGate(35000, 70000),
  workerWrite: new RateGate(900, 2200)
};

export async function pacedFetch(gate: RateGate, url: string, init?: RequestInit) {
  await gate.take();
  const r = await fetch(url, init);
  if (r.status === 429 || r.status === 503) {
    gate.bump();
    await sleepJitter(12000, 28000);
    throw new Error(`steam http ${r.status}`);
  }
  gate.ok();
  return r;
}
