# Architecture audit (evidence from repo)

Scope: `worker/` farm loop, GSI, CV, teach, record, bandit weights. Not a public MM client. No anti-cheat bypass.

## Actual architecture

Control is a host Node FSM (`worker/fsm/loop.mjs`) talking to a guest agent on the Hyper-V VM (`worker/vm/guest-agent.mjs`, capture `guest-shot.ps1`, input `guest-input.ps1`). Perception is a blocking Python process (`worker/cv/engine.py` + `yolo_infer.py`). Game state is CS2 GSI HTTP (`worker/gsi.mjs` port 32222). Decisions are rules + live teach intent + epsilon-greedy bandit (`worker/learn.mjs`, `worker/data/sense-weights.json`), not a trained policy net.

```
guest shot png -> host live.png -> engine.py frame.json
GS POST -> parseGsi
confirmState (CV screen vs GSI)
decideApp | decideGame -> steps (LOOK/KEYDOWN/FIRE)
guest /input SendInput
reward.step(GSI) -> optional bandit cell update
```

Teach UI (`worker/teach-server.mjs`, `worker/cv/teach.html`) writes YOLO boxes under `D:/FarmVMs/ops/yolo/human` and `live-intent.json`. Human record (`worker/record-human.mjs`) writes jsonl under `D:/FarmVMs/ops/vision/human-record/` and now `traj.jsonl` (observation/action pairs). Farm `stop` kills `fsm/loop.mjs`.

## Data flow

| Source | In | Out | Failures |
|---|---|---|---|
| `guest-shot.ps1` | desktop/CS2 hwnd | `live.png`, `shot.json` (ts, mean, black) | black, Add-Type cost, stale png |
| `engine.py` | png path | `frame.json` (screen, radar, yolo, timestamp) | missing image, CPU YOLO timeout 20s |
| `gsi.mjs` | POST body | last snapshot + `receivedAt()` | bind/token, delay, spectate steamid swap |
| `play-policy.mjs` | `live-prompt.txt`, `live-intent.json` | action string | regex miss |
| `learn.mjs` | discrete state key | action from mean+ucb | empty buckets, explore noise |
| `reward.mjs` | GSI deltas | sparse + shaping | duplicate events (fixed in this pass) |
| `record-human.mjs` | keys + gsi + frames | jsonl + traj | Windows taskkill zeros (stop.flag) |

## Control flow

1. `farm.mjs bot` deploys guest files, starts `fsm/loop.mjs`.
2. Fast path: GSI hp drop -> look/fire without waiting for a new frame (`loop.mjs` react-damage).
3. If GSI says in a live map, GSI-live path: capture, CV, waypoints (`radar-zones.mjs`, `brain.mjs`), `decideGame`.
4. Else slow path: capture, CV, `confirmState`, app or game FSM.
5. Input: guest `/input`, HV bridge `127.0.0.1:39201` fallback except LOOK (explicitly not on HV).

`worker/fsm/protocol.mjs` already journals ticks and p50/p95 latency to `D:/FarmVMs/ops/vision/latency.json`. Observation contract is `worker/obs.mjs`. Held-key watchdog is `worker/action-ctl.mjs`.

## Defects (with files)

### Critical

1. **No neural policy.** `learn.mjs` is a contextual bandit over string keys (`live_t_open_clear`). `pickAction` is mean of rewards + noise. There is no encoder, no BC/PPO weights, no eval split. Calling this RL is false.
2. **YOLO train/val leak.** `worker/cv/farm.yaml` sets `train: images` and `val: images` (same folder). Adjacent teach frames are not session-split. Metrics from `train_yolo.py` are not a holdout.
3. **GSI-live used to invent IN_GAME frames.** `fsm/loop.mjs` previously set `ok: true, screen: IN_GAME` when CV failed and still called `decideGame`. That path now waits on bad/stale/missing CV instead of fabricating a frame.

### High

4. **Stale screenshot still drove play.** `captureHealthFromVision` computed `repeated` but did not skip (`fsm/loop.mjs`). Now skip on repeat / invalid capture.
5. **Sticky KEYDOWN without a controller.** `game.mjs` `walkHolds(..., sticky=true)` emits KEYDOWN only. Release was ad hoc on death. `action-ctl.mjs` tracks holds, 8s watchdog, `releaseAllKeys` on SIGINT/SIGTERM and `farm.mjs killLoop` fires keyup.
6. **Reward spam into bandit.** `reward.mjs` emitted stuck-spawn / hit-wall / live+0.02 every tick; `loop.mjs` called `learn` on any non-boot event. Bandit saw dense shaping as if it were the action outcome. Now `learn` uses `scored.learn` + `scored.sparse` only.
7. **Death + spectate double count.** `parseGsi` sets `alive=false` when `provider.steamid !== player.steamid`. Old tracker added `death+` and `died`. Spectate path now only uses death delta.
8. **Teach boxes != BC pairs.** Saving a lesson is image + yolo labels + intent text. That is perception data. Policy imitation needs `traj.jsonl` from record (added). Boxes alone cannot train a movement policy.
9. **Human vs agent credit.** Record does not call `learn`. Loop still updates bandit while you are not recording. Teach intent overrides (`preferByPrompt`) while the bot is armed: demonstrations and autonomous control must not overlap (record still kills the loop).

### Medium

10. **GSI vs pixels unsynced.** Snapshot is "last POST". Age is now `receivedAt()`. No round-id lock between png mtime and GSI round.
11. **Radar walls as YOLO boxes.** Classes include `wall` (`classes.json`). Boxes are a poor geometry; radar disc CV is a separate estimator (`engine.py`). No navmesh.
12. **Blocking PNG + spawnSync python** every tick. Control frequency is CV-bound, not 64-tick.
13. **`busy` skip** drops ticks under overlap; no queue, stale commands are "skip overlap-busy".
14. **No automated tests existed** before `worker/test/core.test.mjs`.
15. **Mouse deltas** are not in `/keysample` (keys only). BC look is incomplete.

### Low

16. Empty `catch {}` on GSI onState in loop.
17. Dual record stacks: `record-local.mjs` vs `record-human.mjs`.
18. `sense-bot.mjs` is a parallel loop using the same weights.

## Missing for a learnable agent

- Session-split YOLO val + confusion matrix from a real run (needs `D:/FarmVMs/ops/yolo/human`).
- Temporal tracker (velocity of dets).
- Action duration aligned to frames (50ms keys vs 800ms+ CV).
- NavMesh / graph planner with success metrics.
- Policy eval harness vs frozen scenarios.
- GPU/ONNX only after measuring `latency.json` on the VM.

## Priority

1. Keep observation gate + sparse rewards + traj (this change).
2. Split YOLO by record session; stop claiming val metrics.
3. Behavioral cloning on `traj.jsonl` with a held-out session.
4. Measure e2e latency on golden VM; then async capture.
5. Navmesh for mirage train only after BC walks without spinning.
