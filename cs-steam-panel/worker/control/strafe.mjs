export function strafeCommand({ wallAhead, openRel, threatX, stuckMs } = {}) {
  if (stuckMs > 1800 || wallAhead) {
    const left = Number(openRel) < 0 || Number(threatX) > 50;
    return {
      skill: "strafe",
      reason: "unstick",
      key: left ? "A" : "D",
      steps: [
        { action: "HOLD", key: left ? "A" : "D", ms: 160 },
        { action: "HOLD", key: "W", ms: 140 }
      ]
    };
  }
  if (threatX != null && Number.isFinite(Number(threatX))) {
    const key = Number(threatX) < 50 ? "A" : "D";
    return {
      skill: "strafe",
      reason: "peek",
      key,
      steps: [{ action: "HOLD", key, ms: 120 }]
    };
  }
  return { skill: "strafe", reason: "idle", steps: [] };
}
