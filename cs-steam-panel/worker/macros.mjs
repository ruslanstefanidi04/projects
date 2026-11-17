import { jitter, sleep, sleepJitter } from "./pace.mjs";
import { VK, clickPct, keyDown, keyUp, releaseAll as releaseKeys, tap } from "./input.mjs";
import { clickTrainingOk, dismissHome, openPlayAndQueue, openDeathmatch, runTrainingScript, isTrainingMap, isOfficialFarmMode } from "./boot.mjs";
import { conExec, conHold } from "./con.mjs";
import { runBuyMenu } from "./fsm/buy.mjs";

export { tap, dismissHome, runTrainingScript, isTrainingMap, isOfficialFarmMode };

export function focusCs() {}

export function releaseAll() {
  releaseKeys();
  // netcon often down in vm training; farmstop spam blocks nothing useful
  conExec("farmstop").catch(() => {});
}

export async function doBuy(gsi) {
  await runBuyMenu(gsi || {}, tap, sleep);
}

export async function doWait(ms) {
  await sleep(ms || jitter(180, 480));
}

export async function doHold() {
  await conHold("+speed", jitter(400, 900));
}

export async function doWalk(route, opts = {}) {
  const steps = route && Array.isArray(route.steps) ? route.steps : null;
  const walk = steps
    ? Math.min(900, Number(steps[Math.floor(Math.random() * steps.length)].walk) || jitter(280, 520))
    : jitter(280, 520);
  const style = opts.style || "forward";
  if (style === "left") {
    keyDown(VK.A);
    keyDown(VK.W);
    await sleep(walk);
    keyUp(VK.A);
    keyUp(VK.W);
  } else if (style === "right") {
    keyDown(VK.D);
    keyDown(VK.W);
    await sleep(walk);
    keyUp(VK.D);
    keyUp(VK.W);
  } else if (style === "back") {
    keyDown(VK.S);
    await sleep(Math.min(400, walk));
    keyUp(VK.S);
  } else if (style === "circle") {
    keyDown(VK.D);
    await sleep(walk * 0.4);
    keyDown(VK.W);
    await sleep(walk * 0.4);
    keyUp(VK.D);
    keyUp(VK.W);
  } else {
    await conHold("+forward", walk);
    keyDown(VK.W);
    await sleep(Math.min(walk, 500));
    keyUp(VK.W);
  }
  if (opts.plant) {
    await conExec("+use");
    keyDown(VK.E);
    await sleep(80);
    keyUp(VK.E);
  }
  if (Math.random() < 0.18) {
    keyDown(VK.SPACE);
    await sleep(40);
    keyUp(VK.SPACE);
  }
}

export async function doShoot(opts = {}) {
  const burst = Number(opts.burst) || jitter(70, 160);
  await conExec("+attack");
  clickPct(50 + (Math.random() * 8 - 4), 50 + (Math.random() * 6 - 3));
  await sleep(burst);
  await conExec("-attack");
  if (Math.random() < 0.4) {
    clickPct(50 + (Math.random() * 10 - 5), 48 + (Math.random() * 8 - 2));
    await sleep(jitter(40, 90));
  }
}

export async function doNade() {
  await conExec("slot4");
  keyDown(VK.N4);
  await sleep(40);
  keyUp(VK.N4);
  await conExec("+attack");
  clickPct(50, 45);
  await sleepJitter(200, 400);
  await conExec("-attack");
  await conExec("slot1");
  keyDown(VK.N1);
  await sleep(40);
  keyUp(VK.N1);
}

let bootPass = 0;

export async function queueMatch() {
  bootPass += 1;
  console.log("boot step", bootPass, "training-ok");
  await clickTrainingOk();
  if (bootPass >= 2) await runTrainingScript();
}

export async function acceptMatch() {
  // menu / training day: clicks + enter; farmgo only if netcon alive
  await clickTrainingOk();
  await tap(VK.RETURN, 50, 120);
  clickPct(50, 62);
  await sleepJitter(180, 360);
  clickPct(50, 78);
  await conExec("farmgo");
}
