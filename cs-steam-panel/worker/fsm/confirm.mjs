// reconcile GSI + CV into one confirmed application phase.
// gameplay must not run unless phase === IN_GAME and gameplay_allowed.

/**
 * @typedef {{
 *   phase: 'BOOT'|'WAIT_FOR_WINDOW'|'MAIN_MENU'|'PLAY_MENU'|'LOADING'|'IN_GAME'|'UNKNOWN'|'ERROR',
 *   gameplay_allowed: boolean,
 *   screen_cv: string,
 *   conf_cv: number,
 *   gsi_alive: boolean|null,
 *   gsi_menu: boolean|null,
 *   conflict: string|null,
 *   reason: string
 * }} ConfirmedState
 */

const MENU_SCREENS = new Set(["MAIN_MENU", "PLAY_MENU", "STORE", "INVENTORY", "LOADOUT"]);
const LIVE_SCREENS = new Set(["IN_GAME", "TRAINING", "RUNNING"]);

/**
 * @param {{ screen?: string, confidence?: number, ok?: boolean }|null} frame
 * @param {{ alive?: boolean, inMenu?: boolean, over?: boolean }|null} gsi
 * @returns {ConfirmedState}
 */
export function confirmState(frame, gsi) {
  const screen_cv = String(frame?.screen || "UNKNOWN");
  const conf_cv = Number(frame?.confidence || 0);
  const gsi_alive = gsi ? Boolean(gsi.alive) : null;
  // alive in match wins over flaky gsi.inMenu (was clicking Play mid-fight)
  const gsi_menu = gsi ? Boolean(gsi.over || (gsi.inMenu && !gsi.alive)) : null;

  if (!frame?.ok || screen_cv === "BLACK") {
    if (gsi && gsi_alive && !gsi_menu) {
      return {
        phase: "IN_GAME",
        gameplay_allowed: true,
        screen_cv,
        conf_cv,
        gsi_alive,
        gsi_menu,
        conflict: "no-cv-gsi-alive",
        reason: "gsi-live-no-frame"
      };
    }
    return {
      phase: "WAIT_FOR_WINDOW",
      gameplay_allowed: false,
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: null,
      reason: frame?.ok ? "black-frame" : "no-frame"
    };
  }

  if (screen_cv === "LOADING") {
    return {
      phase: "LOADING",
      gameplay_allowed: false,
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: null,
      reason: "loading"
    };
  }

  if (screen_cv === "UNKNOWN" || (conf_cv < 0.55 && !LIVE_SCREENS.has(screen_cv))) {
    // weak CV: trust GSI if clearly in match
    if (gsi && gsi_alive && !gsi_menu) {
      return {
        phase: "IN_GAME",
        gameplay_allowed: true,
        screen_cv,
        conf_cv,
        gsi_alive,
        gsi_menu,
        conflict: "cv-unknown-gsi-alive",
        reason: "gsi-overrides-unknown-cv"
      };
    }
    return {
      phase: "UNKNOWN",
      gameplay_allowed: false,
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: null,
      reason: "cv-unknown"
    };
  }

  // conflict: CV says menu, GSI says alive in match -> confirmed IN_GAME, no menu clicks
  if (MENU_SCREENS.has(screen_cv) && gsi && gsi_alive && !gsi_menu) {
    return {
      phase: "IN_GAME",
      gameplay_allowed: true,
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: "cv-menu-gsi-alive",
      reason: "gsi-overrides-false-menu"
    };
  }

  // conflict: CV says in-game, GSI says menu/over -> do not play gameplay
  if (LIVE_SCREENS.has(screen_cv) && gsi && gsi_menu) {
    return {
      phase: "MAIN_MENU",
      gameplay_allowed: false,
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: "cv-ingame-gsi-menu",
      reason: "gsi-menu-overrides-cv"
    };
  }

  if (LIVE_SCREENS.has(screen_cv)) {
    const allow = !gsi || (gsi_alive && !gsi_menu) || gsi_alive === null;
    return {
      phase: "IN_GAME",
      gameplay_allowed: Boolean(allow),
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: allow ? null : "gsi-not-alive",
      reason: allow ? "cv-ingame" : "cv-ingame-but-gsi-dead"
    };
  }

  if (screen_cv === "PLAY_MENU") {
    return {
      phase: "PLAY_MENU",
      gameplay_allowed: false,
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: null,
      reason: "cv-play-menu"
    };
  }

  if (MENU_SCREENS.has(screen_cv)) {
    return {
      phase: screen_cv === "MAIN_MENU" ? "MAIN_MENU" : "MAIN_MENU",
      gameplay_allowed: false,
      screen_cv,
      conf_cv,
      gsi_alive,
      gsi_menu,
      conflict: null,
      reason: `cv-${screen_cv.toLowerCase()}`
    };
  }

  return {
    phase: "UNKNOWN",
    gameplay_allowed: false,
    screen_cv,
    conf_cv,
    gsi_alive,
    gsi_menu,
    conflict: null,
    reason: "unmapped-screen"
  };
}
