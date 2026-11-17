// Application FSM: menus / loading / unknown. never issues live combat COMBO.

const MIN_CONF = 0.55;

/** @param {any} frame @param {any} ctx @param {import('./confirm.mjs').ConfirmedState} confirmed */
export function decideApp(frame, ctx, confirmed) {
  const stuckMs = ctx.stuckMs || 0;
  const screen = confirmed.screen_cv || frame?.screen || "UNKNOWN";

  if (confirmed.phase === "WAIT_FOR_WINDOW" || confirmed.phase === "LOADING") {
    return {
      fsm: "app",
      state: confirmed.phase,
      action: "WAIT",
      reason: confirmed.reason,
      timeout_ms: confirmed.phase === "LOADING" ? 2000 : 1500,
      expect: { kind: "phase_change" }
    };
  }

  if (confirmed.phase === "UNKNOWN") {
    return {
      fsm: "app",
      state: "UNKNOWN",
      action: "WAIT",
      reason: confirmed.reason || "unknown",
      timeout_ms: 900,
      expect: { kind: "phase_known" }
    };
  }

  if ((frame?.confidence || 0) < MIN_CONF && screen !== "BLACK" && screen !== "IN_GAME") {
    return {
      fsm: "app",
      state: confirmed.phase,
      action: "WAIT",
      reason: `low-conf ${screen}`,
      timeout_ms: 800,
      expect: { kind: "conf_up" }
    };
  }

  if (screen === "STORE" || screen === "INVENTORY" || screen === "LOADOUT") {
    if (stuckMs > 8000) {
      return {
        fsm: "app",
        state: "ERROR",
        action: "CLICK",
        target: "home_icon",
        x: 3.5,
        y: 3.5,
        reason: "stuck-wrong-tab-home",
        timeout_ms: 2500,
        expect: { kind: "screen_not", value: screen }
      };
    }
    const play = frame.targets?.play_button;
    return {
      fsm: "app",
      state: "MAIN_MENU",
      action: "CLICK",
      target: "play_button",
      x: play?.x ?? 37,
      y: play?.y ?? 5,
      reason: `leave-${screen}`,
      timeout_ms: 3000,
      expect: { kind: "screen_change" }
    };
  }

  if (confirmed.phase === "MAIN_MENU" || screen === "MAIN_MENU") {
    const play = frame.targets?.play_button;
    return {
      fsm: "app",
      state: "MAIN_MENU",
      action: "CLICK",
      target: "play_button",
      x: play?.x ?? 37,
      y: play?.y ?? 3.5,
      reason: "open-play",
      timeout_ms: 3000,
      expect: { kind: "screen_in", values: ["PLAY_MENU", "IN_GAME", "LOADING"] }
    };
  }

  if (confirmed.phase === "PLAY_MENU" || screen === "PLAY_MENU") {
    const train = frame.targets?.training_go || frame.targets?.go_button;
    if (train) {
      return {
        fsm: "app",
        state: "PLAY_MENU",
        action: "CLICK",
        target: train.type || "training_go",
        x: train.x,
        y: train.y,
        reason: "training-go",
        timeout_ms: 4000,
        expect: { kind: "screen_in", values: ["LOADING", "IN_GAME"] }
      };
    }
    if ((ctx.playStep || 0) === 0) {
      return {
        fsm: "app",
        state: "PLAY_MENU",
        action: "CLICK",
        target: "training_tile",
        x: 22,
        y: 42,
        reason: "training-tile-fallback",
        timeout_ms: 2500,
        nextPlayStep: 1,
        expect: { kind: "any" }
      };
    }
    return {
      fsm: "app",
      state: "PLAY_MENU",
      action: "CLICK",
      target: "go_button",
      x: 88,
      y: 92,
      reason: "go-fallback",
      timeout_ms: 4000,
      nextPlayStep: 0,
      expect: { kind: "screen_in", values: ["LOADING", "IN_GAME"] }
    };
  }

  if (stuckMs > 45000) {
    return {
      fsm: "app",
      state: "ERROR",
      action: "CLICK",
      target: "home_icon",
      x: 3.5,
      y: 3.5,
      reason: "timeout-recovery",
      timeout_ms: 3000,
      expect: { kind: "any" }
    };
  }

  return {
    fsm: "app",
    state: confirmed.phase || "STARTING",
    action: "WAIT",
    reason: `idle ${screen}`,
    timeout_ms: 1000,
    expect: { kind: "any" }
  };
}
