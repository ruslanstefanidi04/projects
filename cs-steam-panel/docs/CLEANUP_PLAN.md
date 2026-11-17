# Cleanup plan

Restore git: `7d04215` (`restore: snapshot before CS2 agent lab cleanup`).
Repo had no commits before that. Uncommitted user work was included in the snapshot, not discarded.

Disk models/datasets under `D:\FarmVMs\ops\` are **not** deleted.

## KEEP

Hyper-V / guest: `worker/vm/**`, `guest-agent`, `guest-input.ps1`, `guest-shot.ps1`, `farm-net.mjs`.
Input: `worker/input.mjs` (guest `/input` only), `action-ctl.mjs`.
Sense: `gsi.mjs`, `obs.mjs`, `cv/engine.py`, `cv-worker.mjs`, `vision.mjs` pull-guest.
Farm loop: `farm.mjs`, `fsm/loop.mjs` (one tick; idle unless lab walk confirmed or `FARM_LEGACY_FSM=1`).
Walk tools: `control/astar.mjs`, `control/waypoint.mjs`, `radar-zones.mjs`.
YOLO files: `cv/yolo_infer.py`, `train_yolo.py`, `fetch_public_yolo.py`, `classes.json` (train only from UI button).
Teach HTTP: `teach-server.mjs` (now CS2 Agent Lab).
Tests: `worker/test/*.test.mjs`.

## ARCHIVE (keep on disk, out of main UI)

Linear BC: `bc.mjs`, `bc-data.mjs`, `train-bc.mjs`, `eval-bc.mjs`, `data/bc-model.json`.
Bandit: `learn.mjs`, `sense-bot.mjs`, `fit-human.mjs`, `data/sense-weights.json`.
Pretrained stubs: `iql-inspect.mjs`, `dataset-adapter.mjs`, docs `PRETRAINED_*`.
Old policy switch: `policy-router.mjs` (debug only, `FARM_LEGACY_FSM=1` + `/legacy`).
Old teach: `/legacy` serves `cv/teach.html`.
Human record / BC traj: `record-human.mjs` (not in lab nav).
Hierarchy aim/fire: `skills/hierarchy.mjs`, `control/pid.mjs`, `kalman2d.mjs`, `fire.mjs`, `strafe.mjs` (not wired to VM from lab).

## REMOVE

Nothing source-deleted in this pass (tests still import BC/bandit).
Gitignored only: `__pycache__`, `*.pt` in repo root, `.env`.
Do not delete `D:\FarmVMs\ops\yolo\best.pt` or `public/`.

## Target loop

Observation (GSI + screenshot + CV) -> active lab skill (default idle) -> Action Controller -> guest input.

One controller. Walk start needs `confirm:true`. Stop releases keys.
