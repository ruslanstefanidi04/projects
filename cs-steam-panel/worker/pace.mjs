export function jitter(minMs, maxMs) {
  const a = Math.min(minMs, maxMs);
  const b = Math.max(minMs, maxMs);
  return a + Math.random() * (b - a);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function sleepJitter(minMs, maxMs) {
  return sleep(jitter(minMs, maxMs));
}

export class RateGate {
  constructor(minMs, maxMs) {
    this.min = minMs;
    this.max = maxMs;
    this.next = 0;
    this.strikes = 0;
  }

  async take() {
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    const gap = jitter(this.min, this.max);
    const extra = this.strikes * jitter(8000, 18000);
    this.next = now + wait + gap + extra;
    if (wait > 0) await sleep(wait);
    await sleepJitter(120, Math.min(1800, gap * 0.25 + 120));
  }

  bump() {
    this.strikes = Math.min(8, this.strikes + 1);
    this.next = Date.now() + jitter(25000, 70000) * (this.strikes + 1);
  }

  ok() {
    this.strikes = Math.max(0, this.strikes - 1);
  }
}

export const gates = {
  poll: new RateGate(1800, 3200),
  heartbeat: new RateGate(8000, 14000),
  command: new RateGate(400, 1200),
  launch: new RateGate(800, 2200),
  queue: new RateGate(2000, 5000),
  login: new RateGate(14000, 28000),
  tradeSend: new RateGate(48000, 95000),
  tradeAccept: new RateGate(9000, 19000),
  confirm: new RateGate(5000, 11000),
  inv: new RateGate(7000, 15000)
};
