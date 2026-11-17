// typed observation: screenshot + yolo + radar + gsi, with freshness flags.
export const OBS_VERSION = 1;
export const MAX_FRAME_AGE_MS = 12000;
export const MAX_GSI_AGE_MS = 8000;

export function packObservation({
  tickId,
  episodeId,
  capture,
  frame,
  gsi,
  gsiAgeMs,
  clock
} = {}) {
  const yolo = frame?.yolo?.dets || frame?.estimates?.yolo?.dets || [];
  const age = capture?.age_ms;
  const staleFile = Boolean(capture?.repeated) && age != null && age > MAX_FRAME_AGE_MS;
  const shotOk = Boolean(capture?.valid) && !staleFile;
  const shotFresh = shotOk && (age == null || age <= MAX_FRAME_AGE_MS);
  const gsiFresh = Boolean(gsi) && (gsiAgeMs == null || gsiAgeMs <= MAX_GSI_AGE_MS);
  return {
    version: OBS_VERSION,
    frame_id: capture?.frame_id ?? tickId ?? 0,
    tick_id: tickId ?? 0,
    episode_id: episodeId || "",
    timestamp: Date.now(),
    screenshot: {
      valid: Boolean(capture?.valid),
      mean: capture?.mean ?? frame?.mean ?? null,
      age_ms: age ?? null,
      frame_hash: capture?.frame_hash ?? null,
      repeated: Boolean(capture?.repeated),
      black_ratio: capture?.black_ratio ?? null,
      error: capture?.error ?? null
    },
    detections: Array.isArray(yolo) ? yolo.slice(0, 32) : [],
    radar: frame?.radar || frame?.observations?.radar || null,
    player: gsi
      ? {
          alive: Boolean(gsi.alive),
          health: Number(gsi.health || 0),
          armor: Number(gsi.armor || 0),
          spectating: Boolean(gsi.spectating),
          money: Number(gsi.money || 0),
          team: String(gsi.team || ""),
          pos: gsi.pos || null,
          activity: String(gsi.activity || "")
        }
      : null,
    weapon: gsi
      ? {
          name: String(gsi.weapon || ""),
          ammo: Number(gsi.ammo || 0),
          ammoReserve: Number(gsi.ammoReserve || 0),
          loadout: String(gsi.loadout || "")
        }
      : null,
    round: gsi
      ? {
          map: String(gsi.map || ""),
          round: Number(gsi.round || 0),
          phase: String(gsi.phase || ""),
          bomb: String(gsi.bomb || gsi.bombState || ""),
          clock: clock || gsi.clock || "",
          winTeam: String(gsi.winTeam || "")
        }
      : null,
    gsi_age_ms: gsiAgeMs ?? null,
    confidence: Number(frame?.confidence || 0),
    validity: {
      screenshot: shotFresh,
      gsi: gsiFresh,
      aligned: shotFresh && gsiFresh
    }
  };
}

export function validateObservation(obs) {
  const errors = [];
  if (!obs || typeof obs !== "object") return { ok: false, errors: ["missing"] };
  if (obs.version !== OBS_VERSION) errors.push("version");
  if (!Number.isFinite(Number(obs.frame_id))) errors.push("frame_id");
  if (!obs.screenshot || typeof obs.screenshot !== "object") errors.push("screenshot");
  if (!obs.validity || typeof obs.validity !== "object") errors.push("validity");
  if (obs.detections && !Array.isArray(obs.detections)) errors.push("detections");
  return { ok: errors.length === 0, errors };
}

export function obsActionable(obs) {
  if (!obs) return { ok: false, reason: "no-obs" };
  const v = validateObservation(obs);
  if (!v.ok) return { ok: false, reason: "schema:" + v.errors.join(",") };
  if (!obs.validity?.screenshot) return { ok: false, reason: "stale-or-bad-frame" };
  const age = obs.screenshot.age_ms;
  if (age != null && age > MAX_FRAME_AGE_MS) return { ok: false, reason: "frame-old" };
  if (!obs.player) return { ok: false, reason: "no-gsi" };
  if (!obs.validity.gsi) return { ok: false, reason: "gsi-old" };
  if (obs.player.spectating) return { ok: false, reason: "spectate" };
  if (!obs.player.alive) return { ok: false, reason: "dead" };
  if (obs.player.activity === "menu") return { ok: false, reason: "menu" };
  return { ok: true, reason: "ok" };
}
