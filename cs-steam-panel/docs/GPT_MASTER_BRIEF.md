# MASTER BRIEF FOR GPT: CS2 local farm bot + teach panel

Copy this entire file into GPT. Ask it for an architecture / learning analysis, not new VAC-bypass ideas.

You are a senior ML + game-AI reviewer. Analyze this system as it exists in code today (Sep 2026). Do not assume PPO, DAgger, or a neural policy unless the text says it exists. Be harsh about what is "learning" vs "a human typing walk-W". Propose a next architecture that fits the data we already collect. Do not suggest public matchmaking, anti-cheat evasion, host SendKeys, or Default Switch.

## Product and constraints (hard)

Repo: `cs-steam-panel` (external, not a public CS2 cheat product).

Goal: a bot that plays **CS2 inside a Hyper-V golden VM** (`csfarm-golden`) against **local bots / local competitive**, so we can teach perception + behavior from a host panel.

Hard rules:
- Hyper-V only. Game runs in the guest. Capture and input are **in the guest**.
- **Never** host SendKeys into vmconnect. Host does not inject keys into the VM console.
- **Never** Hyper-V Default Switch. Private LAN only.
- vmconnect Basic / fill to native host desktop so the cursor stays in the game, not in black bars.
- No Cybershoke, no public MM as the training loop.
- Map load can be skipped (`FARM_SKIP_MAP=1`). Freeze time: buy via B menu, then play; we do not want the bot frozen AFK in freeze except for buy.
- YOLO inference is **CPU** on the host (`ultralytics`, `D:\FarmVMs\ops\yolo\best.pt`).
- Guest overlay is click-through glass over CS2, pulling `overlay-glass.png` from the host teach HTTP (LAN bind), not from host desktop capture.

CLI: `node farm.mjs` / `farm.bat`: `status`, `show` (stretch VM+CS2), `play`, `grind`, `bot` (restart FSM), `stop`, `fit` (clone human record into bandit weights), `record`, `teach`, `train`.

## Physical topology

```
[Windows host]
  farm.mjs / fsm/loop.mjs          control
  teach-server.mjs :39210          panel + overlay PNG
  cv/engine.py + yolo_infer.py     perception
  gsi.mjs bind host vSwitch        CS2 Game State Integration
  hv-bridge optional :39201        fallback clicks, NOT look

[Hyper-V guest CS2]
  guest-agent.mjs HTTP             /see /shot /input /put /fill /cfg
  guest-shot.ps1                   CopyFromScreen CS2 client
  guest-input.ps1                  resident SendInput (LOOK/KD/KU/FIRE/CLICK)
  guest-overlay.ps1                TopMost layered form, TransparencyKey black
  CS2 windowed borderless = desktop size
  GSI POSTs to host
```

Tick (simplified):

```
guest live.png -> host D:/FarmVMs/ops/vision/live.png
engine.py -> frame.json (screen, radar crop, yolo dets, motion)
GSI POST -> parseGsi (hp, ammo, team, bomb, activity, steamid spectate)
confirmState: CV screen vs GSI
decideApp | decideGame -> steps LOOK / KEYDOWN / KEYUP / FIRE / CLICK / HOLD
guest /input
reward.step(GSI) -> sparse events may update bandit cell
```

Control frequency is **CV-bound** (guest shot + spawnSync python), not 64-tick. Fast path: GSI HP drop can look/fire without a new frame.

## What is NOT a neural policy

`worker/learn.mjs` is a **contextual bandit**:
- State key like `live_ct_open_clear` from team + clock + radar wall + foe count (`stateKey`).
- Actions are **strings**: `walk-w`, `fight-push`, `unstick-wall`, `explore`, ... (~40 labels).
- `pickAction`: epsilon explore, else mean reward + small UCB-ish bonus (`n0=24`).
- `learn`: `{n, sum}` per cell. Loop only feeds **sparse** GSI reward (`scored.learn` / `scored.sparse`), not per-tick shaping.
- Weights: `worker/data/sense-weights.json`.

There is **no** encoder, no PPO, no BC net, no DAgger loop. Calling this RL is marketing. `fit-human.mjs` clones recorded keys into the same `{n,sum}` buckets (crude BC into the bandit).

`brain-cfg.mjs` `stack`: eyes, radar, prompt, rules, rl, aim, fire, move toggles. Default all on. `readStack()` currently returns **DEFAULT_STACK** (file write exists, live read is stubbed to defaults).

## Perception stack (what "sees")

`worker/cv/engine.py`:
- Screen class (IN_GAME, menus, black, ...), templates for play button etc.
- Radar crop + color blobs: self, enemies red, allies, wall_ahead, facing_deg, nx/ny.
- Motion blobs (`likely_enemy`).
- YOLO via `yolo_infer.py` on the full frame, conf ~0.15, CPU, max 32 dets.
- Writes `overlay.png` (painted frame) and `overlay-glass.png` (dets + motion on black). Guest overlay **must not** fall back to full `overlay.png` (that would plaster an opaque screenshot on CS2).

YOLO classes (`classes.json` / `farm.yaml`, nc=11):
`c, ch, t, th, wall, turn, climb, cover, drop, look, gun`

Train: `train_yolo.py` Ultralytics CPU, imgsz 640, batch 4, epochs 12-16. Data `D:\FarmVMs\ops\yolo\human\images` + `labels`. **train and val are the same folder** (`farm.yaml`). Adjacent teach frames leak. Do not trust mAP.

Observed live: model often returns `dets: []` even in-game; motion still fires. Glass was empty until we painted motion boxes too. Overlay needs teach server up + guest overlay process + non-black pixels (TransparencyKey).

GSI (`gsi.mjs`): health, armor, money, weapons, bomb, map, round, activity, provider vs player steamid => spectate. `receivedAt()` for freshness. Bind is host LAN, not 127.0.0.1 (guest must POST).

`obs.mjs`: packed observation + `obsActionable`. Screenshot stale only if **repeated hash AND age > 12s**. GSI max age 8s. Gate: dead / spectate / menu / bad frame. Fresh identical hashes still playable (otherwise the bot WAIT-loops AFK).

## Decision stack (what "thinks")

Priority in GSI-live (`fsm/loop.mjs`):
1. `preferByPrompt()` from `live-intent.json` / `live-prompt.txt` (walk wait/WASD, aim yolo-head/body).
2. `preferByRules()`: spawn => walk-w, wall => unstick, C4 not on site => explore.
3. Bandit `pickAction` on LIVE_MOVE / LIVE_FIGHT / LIVE_DM pools.
4. Waypoints `brain.mjs` + `radar-zones.mjs` `steerWaypoint` when walk-ish prefer and radar self nx,ny ok.
5. `fsm/game.mjs` `decideGame`: yolo aim, mouse-scan if aim mode on but no box, unstick, pickup gun, plant/defuse, walk holds.

Walk: `walkHolds` can emit **sticky KEYDOWN** without KEYUP (`sticky=true`). `action-ctl.mjs` tracks holds, 8s watchdog, gates LOOK/FIRE/KEYDOWN when dead; CLICK/KEY still allowed for menus. `farm stop` / SIGTERM release WASD.

Buy: freeze + not armed => B + digits (`fsm/buy.mjs`). Knife/C4 => tap 1.

App FSM (`fsm/app.mjs` + `confirm.mjs`): menus, click play. Conflict `cv-ingame-gsi-menu` still happens (GSI menu vs CV IN_GAME) and can click play in a live match.

Known input bug (partially fixed): guest `/input` LOOK used 800ms stdin timeout then **killed** `guest-input.ps1`. Host then `fetch failed`. Mouse-scan did LOOK first, so WASD never ran. Fix: do not kill child on timeout; longer look timeout; **KEYDOWN walk before LOOK**; cache CS2 hwnd. Residual look fails still possible if agent restarts (`reload-agent.flag` on every `farm bot` deploy) or `/see` spawnSync blocks Node event loop.

LOOK must stay on guest SendInput, not HV bridge.

## Teach panel (how a human "teaches")

Host UI: `http://127.0.0.1:39210` (`worker/cv/teach.html`, `teach-server.mjs`). Also LAN bind so **guest overlay** can GET glass PNG. Staff UI is Russian.

Layout:
- Left: live.png + canvas boxes.
- Channels with **see / think / note / log** each:
  - **Eyes / YOLO**: 11 class buttons, draw boxes, undo/clear. Perception labels.
  - **HUD**: GSI-ish see (gun, ammo, money, hp, bomb, freeze, spectate). Timing auto/off. Free text correction.
  - **Radar**: crop + paths images, text correction (false enemy, wrong route).
  - **Walk**: buttons walk-w / wa / wd / a / d / s / wait + note.
  - **Aim**: yolo-head / yolo-body / don't aim + note.
- One button **отправить урок** (`/api/save`): packs boxes + walk/aim/timing + notes.
- **Запись твоей игры** (`/api/play-record`): NOT a lesson. Stops bot keys, you play, dump session folder.

What `/api/save` actually writes:
1. Copy `live.png` -> `D:/FarmVMs/ops/yolo/human/images/<id>.png`
2. YOLO txt labels (normalized cx cy w h) if boxes
3. If any boxes: kick `train_yolo.py` (CPU, can hitch the host)
4. `applyPrompt`: rewrite `live-intent.json` (walk, aim, timing) and prompt log so the **running bot immediately changes WASD / aim mode**
5. `notes.jsonl` kind `prompt-bc` (name is a lie: it is prompt + optional boxes, not trajectory BC)

So the panel is **three different things mixed in one button**:
- Perception dataset (YOLO)
- Instant policy override (intent JSON the FSM reads every tick)
- Human notes (not consumed by a model)

`preferByPrompt` wins over bandit. Teaching "walk W+A" is a **live remote control**, not gradient descent.

Record path (`record-human.mjs`):
- Kills / does not drive the game.
- Dense: keys ~50ms (`/keysample` keys only, **no mouse dx**), GSI jsonl, frames ~800ms, CV optional, `ticks.jsonl`, `samples.jsonl`, `traj.jsonl` (`dataset-traj.mjs`).
- Stop via `stop.flag` (Windows `taskkill` used to flush zeros).
- `farm.mjs fit` / `fit-human.mjs`: bin keys+GSI into bandit cells. Not a policy net.

Brain page `/brain`: think logs, not training.

## Rewards (what "learns" online)

`reward.mjs`:
- **Sparse** (may update bandit): kill, assist, death, died, respawn, round win/loss, plant, defuse, bomb explode CT, leave-spawn, reach-site.
- **Shaping logged only**: stuck-spawn rising edge, hit-wall, on-route/off-route, live tick crumbs, AFK.
- Spectate: death delta only (no double death+died).
- Record does **not** call `learn()`. Agent loop does.

Human header text in teach.html claims rewards always even when you play. GSI can log; bandit update is agent-loop only.

## Data on disk (not in git)

| Path | Role |
|---|---|
| `D:/FarmVMs/ops/vision/live.png` frame.json overlay*.png fsm.log latency.json | live perception + FSM |
| `D:/FarmVMs/ops/yolo/best.pt` human/images labels notes.jsonl live-intent.json | eyes + live intent |
| `D:/FarmVMs/ops/vision/human-record/human-*/` traj.jsonl keys gsi frames | imitation dump |
| `worker/data/sense-weights.json` | bandit |

## Tests and docs already in repo

`worker/test/core.test.mjs` (~11 tests): reward uniqueness, GSI spectate steamid, obs stale-only-when-old, fresh-repeat playable, action gate when dead, traj needs done+terminal, confirm GSI alive vs false menu CV.

Docs: `ARCHITECTURE_AUDIT.md`, `LEARNING_ARCHITECTURE.md`, `PERFORMANCE_REPORT.md`, `TEST_REPORT.md`, `ROADMAP.md`.

Chosen next architecture in those docs: **BC on human traj.jsonl**, freeze YOLO, keep rules as safety; **not PPO now** (sparse reward, seconds of CV delay, broken credit historically).

## Honest inventory: what works vs theater

Works:
- Guest capture + guest SendInput architecture (correct isolation).
- GSI live path plays local dust2 vs bots (buy, slot1, mouse-scan / walk, damage react).
- Teach intent changes walk/aim immediately.
- YOLO train kick from boxes (small N, leaky val).
- Overlay glass pipeline (teach LAN + glass PNG + guest form). Fragile.
- Observation schema + sparse bandit + traj files exist.

Broken / weak:
- No policy network. Bandit state is a handful of discrete bins.
- YOLO often empty; walls as boxes are a bad nav representation; radar CV is a separate heuristic, no navmesh.
- Panel "урок" does not add (obs, action) pairs to traj. Record does, without mouse.
- train=val. Intent override hides whether the bandit does anything.
- Tick 8-12s, LOOK timeouts, agent restart on deploy, Node blocked on shot.
- Sticky W vs radar wall_ahead historically AFK. Mouse-scan now walks first and ignores wall strip for that combo.
- Dual loops: `sense-bot.mjs` vs `fsm/loop.mjs`. Dual record: `record-local.mjs` vs `record-human.mjs`.
- `readStack()` ignores `stack.json`.

## Questions for you (GPT)

1. Given this data, what is the **minimum honest learning stack** (perception vs intent override vs BC vs bandit)? What should the panel button write that it does not write today?
2. How to split YOLO session-holdout and stop claiming val metrics?
3. Spec a BC feature vector from `traj.jsonl` + GSI + radar nx,ny + yolo summary, action labels aligned to 200ms bins, eval protocol on a held-out human session. What is missing (mouse)?
4. Should live-intent stay as a **safety / teleop layer** forever, or be converted into DAgger (human corrects while policy runs)? Record currently **stops** the bot.
5. Credit assignment: sparse GSI vs CV delay of seconds. Is the bandit worth keeping?
6. Overlay/YOLO empty: better to train on motion-proposals, or radar-only nav, or more human boxes? Do not propose host capture.
7. Control loop: async capture vs blocking python. Priority vs BC.
8. Rank the next 5 engineering tasks with effort and what metric proves each.

Output structure: (A) one-page current diagram in words, (B) what the panel trains vs pretends to train, (C) gaps, (D) proposed architecture with data contracts, (E) 5 tasks, (F) explicit non-goals.
