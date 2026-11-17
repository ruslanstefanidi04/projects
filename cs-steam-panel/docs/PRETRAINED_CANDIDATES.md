# Pretrained candidates (checked 2026-09-17)

Statuses: DOCUMENTED = page/files exist. VERIFIED = we ran it. UNVERIFIED = not run. BROKEN = confirmed dead.

Do not download 700GB CS:GO hdf5 or 29GB P2P without a format smoke on a tiny sample.

## A. wyhong3103/cs-rl-agent

- Repo exists, MIT, CS2 GSI + YOLO + occupancy, IQL, host-style input.
- `weights/326_head_body.pt` ~14MB: **YOLO detector**, not a policy.
- `artifacts/models/offline/` has `p_network.pth` (~283KB), `q_network.pth`, `v_network.pth`, `config.json`. **DOCUMENTED** on GitHub. **Not VERIFIED** (not loaded here: torch `.pth` is pickle, device `cuda`, host `PressKey`, occupancy 30x30 + 13-d GSI, 7 discrete + 1 continuous, 1920x1080, `target_dt=0.1`).
- Author says the agent does not play well. Needs localhost GSI, condebug, fy_snow.
- Status: policy files **DOCUMENTED**. Inference **UNVERIFIED**. Not wired to guest-input.

## B. RekaAI/CS2-10k

- HF card: **Valve takedown**. Data, viewer, files removed. Remaining ~58MB stub.
- Format (historical, DOCUMENTED): 720p 48fps video + parquet `actions`, `mouse_x_delta`, `mouse_y_delta`, pose.
- License was CC BY-NC. Demos owned by rights holders. **Cannot download sample. BROKEN as a public dataset.**
- Renderer `reka-ai/cs2-dem-renderer` still exists to rebuild from your own `.dem`. Not used here.

## C. EgoCS-400K/Dataset

- Repo and paper exist. README: full 400k **claimed**; **published samples: 2 player-rounds (~188s)** + parser for local `.dem`.
- Has tick-level keys/mouse in CSV. Processing code for VLM captions still unchecked.
- Status: **DOCUMENTED**. Full dump **UNVERIFIED**. Too small as pretrained agent. Import adapter later, not now.

## D. TeaPearce CounterStrike_Deathmatch + Behavioural_Cloning

- Dataset **CS:GO DM 2021**, 16x16? actually 128x768? paper 16x9 768. hdf5 1000 frames, keys onehot + mouse bins. **748GB**.
- `trained_models.zip` **384MB pickle** (HF flags pickle). Inference `dm_run_agent.py` is **CS:GO host screenshot + SendInput**.
- Transfer CS:GO->CS2 HUD/radar/FOV: **UNVERIFIED**, likely poor.
- Status: weights **DOCUMENTED** (zip exists). Load **not VERIFIED** (pickle risk, size, CS:GO). Not downloaded.

## E. elefant-ai/open-p2p

- Weights on HF (~29GB family). MIT. Image+text -> keyboard/mouse. Inference via Recap, WSL, Gemma tokenizer login, dual GPU / 50ms budget. Tested games: Roblox, DOOM, Quake. **Not CS2.**
- Train: 8x H100. Status: **DOCUMENTED**. Excluded from immediate integration (hardware + Recap + not CS2).

## Choice

| Rank | Use | Why |
|---|---|---|
| 1 now | Our FSM + guest input + optional `FARM_POLICY=bc` | Only stack that already drives CS2 in the VM |
| 2 later | EgoCS 2 samples or own demos via renderer | Real CS2 mouse+keys, tiny, legal-ish if you own demos |
| 3 later | TeaPearce | Only if someone loads zip in an isolated env and measures CS2 transfer |
| skip | CS2-10k | Takedown |
| skip | open-p2p now | Cost / Recap / not CS2 |
| skip now | cs-rl-agent IQL | Files exist (~280KB) but host PressKey + occupancy + CUDA; smoke not run |

There is **no VERIFIED pretrained CS2 policy** we could smoke-test without installing their game loop.
