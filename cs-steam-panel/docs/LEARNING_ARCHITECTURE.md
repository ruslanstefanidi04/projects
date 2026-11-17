# Learning architecture

## What exists today

```
Observation (pixels+GSI, loosely timed)
  -> hand features (radar wall, yolo box, clock, money)
  -> if/else (game.mjs, timing.mjs, buy.mjs, play-policy)
  -> bandit over ACTION strings (learn.mjs)
  -> GSI delta reward (reward.mjs)
```

There is **no** trained policy network. `sense-weights.json` stores `{stateKey: {action: {n, sum}}}`. `pickAction` is greedy mean with explore. That is not PPO, not DAgger, not BC.

Perception training: Ultralytics YOLO (`train_yolo.py`). Split is session buckets (15 min mtime) into `human/train.txt` and `val.txt`. `best.baseline.pt` is kept.

Minimal BC lives in `worker/bc.mjs` (linear softmax, no extra ML package). Compare vs majority on held-out rows. Not wired into `decideGame` until a real human traj session validates.

Teach: boxes -> YOLO files; walk/aim -> `live-intent.json` teleop; notes -> notes.jsonl. Train YOLO only via `/api/train-eyes`, not on every save.

Human keys include mouse `dx/dy` from guest `SAMPLE` (cursor delta). CS2 rawinput may still zero the cursor; integrity tests cover traj gaps/order.

Control loop: `cv-worker.mjs` keeps `engine.py --loop`. `runCv` reads fresh `frame.json` instead of spawnSync every tick. Guest mean sample step 48. Latency p50/p95/p99 still in `latency.json` after live ticks.

`readStack()` reads `stack.json`. `sense-bot.mjs` is not started by farm.


## Chosen next architecture (minimal, trainable)

**Behavioral cloning** on human `traj.jsonl`, then keep the rule stack as a safety filter.

```
traj: observation_t, action_t, ..., done
  -> freeze YOLO (perception)
  -> encode (gsi scalars + yolo summary + radar nx,ny)
  -> classify action label (walk-*, fire, reload, ...)
  -> eval on a held-out record session
```

Why not PPO now: reward is sparse, delay from CV is seconds, sample efficiency on one VM is poor, and credit assignment was broken (shaping every tick). Why not DAgger yet: needs a policy that can run while a human corrects; the record path already stops the bot.

HRL later: waypoint (`brain.mjs`) as options, BC for local walk/aim.

## Splits (required)

| Bucket | Data | Must not mix |
|---|---|---|
| Perception train | teach boxes, session A | session B val |
| Policy train | human traj, session C | session D eval |
| Agent experience | loop ticks.jsonl + rewards | human traj |
| Reward | GSI sparse events only for bandit | human keystrokes |

`record-human.mjs` writes `source: "human"`. Loop rewards use `source: "agent"`. Do not `learn()` on human keys.

## Observation contract

`worker/obs.mjs`: frame_id, timestamp, screenshot freshness, detections, radar, player, weapon, round, validity. Policy must refuse `obsActionable` false.

## Trajectory contract

`worker/dataset-traj.mjs` + `traj.jsonl`. Last row `done` + `terminal_reason`. Validator: monotonic time, one episode_id.

Gaps: reward on traj is 0 until an offline GSI align pass. Mouse is cursor delta, not CS2 raw yaw.

## Eval

Do not report YOLO mAP from train=val. Do not report bandit "improvement" from in-play weight updates. Need frozen traj session + action accuracy / collision / stuck from a scripted local-bot scenario (NOT TESTED here).
