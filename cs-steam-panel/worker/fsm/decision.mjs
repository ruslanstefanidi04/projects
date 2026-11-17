// decision router: confirm state -> app FSM or game FSM. no pixels.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { confirmState } from "./confirm.mjs";
import { decideApp } from "./app.mjs";
import { decideGame } from "./game.mjs";
import { filterSteps } from "../brain-cfg.mjs";

const VISION = "D:/FarmVMs/ops/vision";

export function readFrame(dir = VISION) {
  const p = path.join(dir, "frame.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function writeDecision(decision, dir = VISION) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "decision.json"), JSON.stringify(decision, null, 2));
  } catch {}
}

/**
 * @param {string} state
 * @param {any} frame
 * @param {any} ctx
 */
export function decide(state, frame, ctx = {}) {
  if (!frame || !frame.ok) {
    return {
      fsm: "app",
      state: "STARTING",
      action: "WAIT",
      reason: "no-frame",
      timeout_ms: 1500,
      confirmed: confirmState(null, ctx.gsi || null),
      expect: { kind: "any" }
    };
  }

  const confirmed = confirmState(frame, ctx.gsi || null);
  let decision;

  if (confirmed.gameplay_allowed && confirmed.phase === "IN_GAME") {
    decision = decideGame(frame, ctx);
  } else {
    decision = decideApp(frame, ctx, confirmed);
  }

  if (decision?.steps) {
    decision.steps = filterSteps(decision.steps, ctx.stack);
    if (!decision.steps.length) {
      decision.action = "WAIT";
      decision.reason = String(decision.reason || "") + "+hands-off";
    }
  }

  return { ...decision, confirmed };
}

export function nextState(prev, frame, decision, confirmed) {
  const c = confirmed || decision?.confirmed;
  if (decision?.state === "ERROR") return "STARTING";
  if (!frame?.ok) return "STARTING";
  if (c?.phase === "IN_GAME" && c.gameplay_allowed) return "RUNNING";
  if (c?.phase === "PLAY_MENU") return "PLAY_MENU";
  if (c?.phase === "MAIN_MENU") return "MAIN_MENU";
  if (c?.phase === "UNKNOWN") return "UNKNOWN";
  if (c?.phase === "LOADING" || c?.phase === "WAIT_FOR_WINDOW") return "STARTING";
  if (frame.screen === "IN_GAME" || frame.screen === "TRAINING") return "RUNNING";
  if (frame.screen === "PLAY_MENU") return "PLAY_MENU";
  if (frame.screen === "MAIN_MENU") return "MAIN_MENU";
  return decision?.state || prev || "STARTING";
}

/** verify expect against after-frame / mean delta */
export function verifyExpect(expect, before, after, meanDelta) {
  if (!expect || expect.kind === "any") {
    return { ok: true, detail: "no-expect" };
  }
  if (expect.kind === "screen_change") {
    const ok = Boolean(after && after.screen !== before?.screen);
    return { ok, detail: `screen ${before?.screen}->${after?.screen}` };
  }
  if (expect.kind === "screen_not") {
    const ok = Boolean(after && after.screen !== expect.value);
    return { ok, detail: `not ${expect.value} got ${after?.screen}` };
  }
  if (expect.kind === "screen_in") {
    const ok = Boolean(after && (expect.values || []).includes(after.screen));
    return { ok, detail: `want ${(expect.values || []).join("|")} got ${after?.screen}` };
  }
  if (expect.kind === "phase_change" || expect.kind === "phase_known" || expect.kind === "conf_up") {
    return { ok: true, detail: expect.kind };
  }
  if (expect.kind === "motion") {
    const ok = meanDelta == null || meanDelta >= 0.4;
    return { ok, detail: `dMean=${meanDelta ?? "?"}` };
  }
  if (expect.kind === "ammo_up") {
    return { ok: true, detail: "ammo-deferred" };
  }
  return { ok: true, detail: "unhandled-expect" };
}
