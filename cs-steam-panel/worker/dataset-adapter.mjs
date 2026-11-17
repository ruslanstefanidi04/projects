// map external demo rows to our traj. never rewrite source files.

export function emptyIssues() {
  return {
    missing_action: 0,
    bad_ts: 0,
    bad_mouse: 0,
    bad_frame: 0,
    dup: 0,
    bad_res: 0
  };
}

export function checkRow(row, prev) {
  const issues = [];
  if (!row?.action && !row?.keys) issues.push("missing_action");
  const ts = Number(row?.timestamp);
  if (!Number.isFinite(ts)) issues.push("bad_ts");
  else if (prev && Number.isFinite(Number(prev.timestamp)) && ts < Number(prev.timestamp)) issues.push("bad_ts");
  const dx = Number(row?.keys?.dx ?? row?.mouse_dx);
  const dy = Number(row?.keys?.dy ?? row?.mouse_dy);
  if (row?.keys && (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 8000 || Math.abs(dy) > 8000)) {
    issues.push("bad_mouse");
  }
  if (row?.frame_path === "" || row?.frame_ok === false) issues.push("bad_frame");
  if (prev && row?.id && prev.id === row.id) issues.push("dup");
  const w = Number(row?.width || 0);
  const h = Number(row?.height || 0);
  if (w && h && (w < 64 || h < 64 || w > 4096 || h > 4096)) issues.push("bad_res");
  return issues;
}

export function toCanonical(row, source) {
  return {
    observation: row.observation || null,
    action: row.action || "wait",
    timestamp: Number(row.timestamp || 0),
    episode_id: String(row.episode_id || ""),
    source: source || row.source || "unknown",
    terminal: Boolean(row.terminal),
    metadata: row.metadata || {},
    keys: row.keys || { dx: Number(row.mouse_dx || 0), dy: Number(row.mouse_dy || 0) }
  };
}

// EgoCS-style tick csv: keys + mouse + tick. no original mutation.
export function fromEgoTick(tick, episodeId) {
  const keys = {
    W: Boolean(tick.w || tick.W),
    A: Boolean(tick.a || tick.A),
    S: Boolean(tick.s || tick.S),
    D: Boolean(tick.d || tick.D),
    dx: Number(tick.mouse_dx ?? tick.dx ?? 0),
    dy: Number(tick.mouse_dy ?? tick.dy ?? 0)
  };
  const parts = ["W", "A", "S", "D"].filter((k) => keys[k]).map((k) => k.toLowerCase());
  return toCanonical(
    {
      observation: { player: { alive: tick.alive !== false }, radar: {}, round: {} },
      action: parts.length ? `walk-${parts.join("")}` : "wait",
      timestamp: Number(tick.tick ?? tick.t ?? 0),
      episode_id: episodeId,
      keys,
      terminal: Boolean(tick.terminal)
    },
    "egocs"
  );
}

export function splitByEpisode(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const id = String(r.episode_id || "na");
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(r);
  }
  const ids = [...by.keys()].sort();
  const n = ids.length;
  const nTrain = Math.max(1, Math.floor(n * 0.7));
  const nVal = Math.max(0, Math.floor(n * 0.15));
  const train = [];
  const val = [];
  const test = [];
  ids.forEach((id, i) => {
    const chunk = by.get(id);
    if (i < nTrain) train.push(...chunk);
    else if (i < nTrain + nVal) val.push(...chunk);
    else test.push(...chunk);
  });
  return { train, val, test, episodes: n };
}
