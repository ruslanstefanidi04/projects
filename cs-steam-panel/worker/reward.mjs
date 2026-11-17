// reward from GSI deltas. sparse events for bandit; shaping is logged but not mixed into learn.
export function isSparseEvent(name) {
  const n = String(name || "");
  if (/^(kill|assist|death)\+\d+$/.test(n)) return true;
  return /^(died|respawn|round_win|round_loss|plant|defuse|bomb_explode_ct|leave-spawn|reach-site)$/.test(n);
}

export function makeRewardTracker({ source = "agent" } = {}) {
  let prev = null;
  return {
    source,
    reset() {
      prev = null;
    },
    step(s) {
      if (!s) return { reward: 0, events: [], sparse: 0, shaping: 0, learn: false, source };
      if (!prev) {
        prev = snapshot(s);
        return { reward: 0, events: ["boot"], sparse: 0, shaping: 0, learn: false, source };
      }
      const events = [];
      let sparse = 0;
      let shaping = 0;

      if (s.spectating) {
        const dd = (s.deaths || 0) - (prev.deaths || 0);
        if (dd > 0) {
          sparse -= 2.5 * dd;
          events.push(`death+${dd}`);
        }
        prev = snapshot(s);
        return pack(sparse, shaping, events, source);
      }

      const dk = (s.kills || 0) - (prev.kills || 0);
      const dd = (s.deaths || 0) - (prev.deaths || 0);
      const da = (s.assists || 0) - (prev.assists || 0);
      if (dk > 0) {
        sparse += 10 * dk;
        events.push(`kill+${dk}`);
      }
      if (da > 0) {
        sparse += 1.2 * da;
        events.push(`assist+${da}`);
      }
      if (dd > 0) {
        sparse -= 2.5 * dd;
        events.push(`death+${dd}`);
      }
      // spectate flip already handled. extra died only if deaths did not tick yet.
      if (prev.alive && !s.alive && dd <= 0) {
        sparse -= 1.2;
        events.push("died");
      }
      if (!prev.alive && s.alive) {
        sparse += 0.15;
        events.push("respawn");
      }
      if (prev.round !== s.round && s.round > prev.round) {
        if (prev.winTeam && prev.team && prev.winTeam === prev.team) {
          sparse += 3;
          events.push("round_win");
        } else if (prev.winTeam && prev.team && prev.winTeam !== prev.team && prev.winTeam !== "") {
          sparse -= 3.5;
          events.push("round_loss");
        }
      }
      let inStuckSpawn = false;
      let afkNow = false;
      if (s.clock !== "dm") {
        const plantedNow = s.bomb === "planted" || s.bombState === "planted";
        const plantedPrev = prev.bomb === "planted";
        if (prev.hasC4 && plantedNow && !plantedPrev) {
          sparse += 2.5;
          events.push("plant");
        }
        if (plantedPrev && s.bomb === "defused") {
          sparse += 2.5;
          events.push("defuse");
        }
        if (s.bomb === "exploded" && plantedPrev && prev.team === "CT") {
          sparse -= 2.5;
          events.push("bomb_explode_ct");
        }
        if (s.alive && s.leftSpawn && !prev.leftSpawn) {
          sparse += 1.4;
          events.push("leave-spawn");
        }
        if (s.alive && s.atSite && !prev.atSite) {
          sparse += 1.5;
          events.push("reach-site");
        }
        inStuckSpawn =
          s.alive && Number(s.elapsedMs || 0) > 4000 && s.zone && String(s.zone).includes("spawn");
        if (inStuckSpawn && !prev.stuckSpawn) {
          shaping -= 1.2;
          events.push("stuck-spawn");
        }
        if (s.alive && s.wallAhead && !prev.wallAhead) {
          shaping -= 1.4;
          events.push("hit-wall");
        }
        const nd = Number(s.navDist);
        const pd = Number(prev.navDist);
        if (s.alive && Number.isFinite(nd) && Number.isFinite(pd)) {
          const closer = pd - nd;
          if (closer > 0.02) {
            shaping += 0.9;
            events.push("on-route");
          } else if (closer < -0.02) {
            shaping -= 0.55;
            events.push("off-route");
          }
        }
        const nx = Number(s.nx);
        const ny = Number(s.ny);
        const px = Number(prev.nx);
        const py = Number(prev.ny);
        const moved =
          s.alive && Number.isFinite(nx) && Number.isFinite(px) ? Math.hypot(nx - px, ny - py) : 1;
        afkNow = s.alive && moved < 0.008 && Number(s.elapsedMs || 0) > 2500;
        if (afkNow && !prev.afk) {
          shaping -= 0.7;
          events.push("afk");
        }
      } else if (s.alive) {
        shaping += 0.02;
      }
      if (s.alive && (s.mapPhase === "live" || s.phase === "live") && s.clock !== "dm") shaping += 0.02;
      if (s.inMenu) shaping -= 0.01;

      prev = snapshot(s, { stuckSpawn: inStuckSpawn, afk: afkNow });
      return pack(sparse, shaping, events, source);
    }
  };
}

function pack(sparse, shaping, events, source) {
  const learn = events.some((e) => isSparseEvent(e));
  return {
    reward: sparse + shaping,
    sparse,
    shaping,
    events,
    learn,
    source
  };
}

function snapshot(s, extra = {}) {
  return {
    kills: s.kills || 0,
    deaths: s.deaths || 0,
    assists: s.assists || 0,
    alive: Boolean(s.alive),
    round: s.round || 0,
    winTeam: s.winTeam || "",
    team: s.team || "",
    hasC4: Boolean(s.hasC4),
    bomb: s.bomb === "planted" || s.bombState === "planted" ? "planted" : s.bomb || "",
    leftSpawn: Boolean(s.leftSpawn),
    atSite: Boolean(s.atSite),
    zone: s.zone || "",
    nx: s.nx,
    ny: s.ny,
    wallAhead: Boolean(s.wallAhead),
    navDist: s.navDist,
    countedDeath: Boolean(extra.countedDeath),
    stuckSpawn: Boolean(extra.stuckSpawn),
    afk: Boolean(extra.afk)
  };
}
