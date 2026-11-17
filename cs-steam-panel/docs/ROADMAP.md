# Roadmap

## Done in this pass

- Observation schema + freshness gate (`obs.mjs`, wired in `fsm/loop.mjs`).
- Action hold watchdog + emergency release (`action-ctl.mjs`, farm stop keyup).
- Sparse vs shaping rewards; bandit only on sparse (`reward.mjs`).
- Human traj jsonl for BC (`dataset-traj.mjs`, `record-human.mjs`).
- Unit tests (`worker/test/core.test.mjs`).
- Audit docs (this folder).

## Next (order)

1. On golden VM: dump `latency.json`, confirm keyup on `farm stop`, one human record with `traj.jsonl` rows that validate.
2. Split YOLO by filename/session; stop using val=images. Report class counts from `D:/FarmVMs/ops/yolo/human` (script later, data not in git).
3. Offline BC: sklearn or tiny MLP on traj features, eval session held out. Keep `decideGame` as override if BC conf low.
4. Add mouse dx to guest `/keysample` if SendInput/rawinput allows; without it aim BC is weak.
5. Nav success metric: reach radar waypoint in N seconds, stuck detector already in loop (`wSince`).
6. Only after BC beats sticky-W baseline: consider PPO on agent ticks with sparse GSI reward.

## Explicit non-goals

- Public matchmaking, anti-cheat hide, host SendKeys, Default Switch, inventing live latency numbers.
