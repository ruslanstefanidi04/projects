import { jitter, sleep, sleepJitter } from "./pace.mjs";
import { VK, clickPct, tap, keyDown, keyUp } from "./input.mjs";

export async function clickTrainingOk() {
  // training day / intro overlays: center CTA, then lower confirm, then enter/space
  const spots = [
    [50, 62],
    [50, 70],
    [52, 58],
    [48, 66],
    [50, 78],
    [55, 72],
    [45, 72],
    [50, 88]
  ];
  for (const [x, y] of spots) {
    clickPct(x, y);
    await sleepJitter(140, 220);
  }
  await tap(VK.RETURN, 60, 140);
  await tap(VK.SPACE, 50, 120);
  await tap(VK.ESC, 40, 100);
}

export async function dismissHome() {
  await clickTrainingOk();
}

export async function openPlayAndQueue() {
  clickPct(48, 4);
  await sleepJitter(800, 1100);
  clickPct(50, 4);
  await sleepJitter(900, 1200);
  clickPct(14, 82);
  await sleepJitter(500, 800);
  clickPct(16, 74);
  await sleepJitter(500, 800);
  clickPct(28, 42);
  await sleepJitter(400, 700);
  clickPct(36, 48);
  await sleepJitter(400, 700);
  clickPct(82, 90);
  await sleepJitter(400, 700);
  clickPct(50, 90);
}

export async function openDeathmatch() {
  clickPct(48, 4);
  await sleepJitter(800, 1100);
  clickPct(14, 54);
  await sleepJitter(500, 800);
  clickPct(14, 58);
  await sleepJitter(400, 700);
  clickPct(82, 90);
}

async function hold(vk, ms) {
  keyDown(vk);
  await sleep(ms);
  keyUp(vk);
}

export async function runTrainingScript() {
  await tap(VK.RETURN, 50, 120);
  await hold(VK.W, jitter(700, 1100));
  await hold(VK.A, jitter(220, 400));
  await hold(VK.D, jitter(220, 400));
  await hold(VK.S, jitter(180, 280));
  await hold(VK.W, jitter(500, 800));
  await tap(VK.SPACE, 50, 80);
  await tap(VK.R, 40, 80);
  await tap(VK.E, 40, 80);
  await tap(VK.N1, 40, 60);
}

export function isTrainingMap(name) {
  return /train|tutorial|boot|course|agency|shoots|gfx|player|workshop/i.test(String(name || ""));
}

export function isOfficialFarmMode(mode) {
  return /deathmatch|competitive|casual|scrimcomp|wingman|premier/i.test(String(mode || ""));
}
