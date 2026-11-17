# CS Farm strategy (locked)

## Goal

One account = one Hyper-V VM = own Steam + CS2. Host mouse free. **vmconnect is optional.** Eyes: guest captures CS2 and HTTP-sends `live.png` to the host. You teach in the **host** browser. YOLO glass lives **inside the guest** over CS2, not on the host.

Not matchmaking / Cybershoke. Local bots until YOLO + policy are actually good.

## Hard rules

| Rule | Why |
|---|---|
| Hyper-V only | no Sandboxie, no host Steam/CS as the farm |
| Never host SendKeys | input is guest `/input` or Msvm console |
| Never Default Switch | kills Happ / wintun |
| Basic vmconnect, not Enhanced Session | Enhanced is a fake second login |
| Eyes = guest capture -> host teach | `guest-shot.ps1` then `/see` `/shot`. Do not require host vmconnect |
| Glass = inside the guest | `guest-overlay.ps1` over CS2. Never host-overlay on the desktop |
| Do not `map` via console type | `typeCon map ...` can kill CS2; use `FARM_SKIP_MAP=1` |
| Do not maximize CS2 in guest (`ShowWindow 3`) | kills the GPU-PV hwnd |
| Do not queue MM (`matchmaking_session_create`) | stay local vs bots |
| One-shots `_tmp-*`, then delete | never the main path |

## Network (Happ / wintun)

| Adapter | VPN day | Farm day |
|---|---|---|
| `Default Switch` / `vEthernet (Default Switch)` | **OFF forever** | **OFF forever** |
| `csfarm-int` / `vEthernet (csfarm-int)` | **OFF** (parked) | ON; host `10.250.0.1`, guest `10.250.0.10` |
| Happ / wintun / other VPN NICs | never touch | never touch |

Guest internet = internal `csfarm-int` + `NetNat 10.250.0.0/24` only while the farm session runs. Park the vNIC when VPN must work. HostOps net scripts match exact names only. No adapter wildcards.

## Control plane

```
you
  `- host browser http://127.0.0.1:39210  (farm teach: live.png from guest)

guest
  |- cs2
  |- guest-shot.ps1 -> live.png
  `- guest-overlay.ps1 (yolo glass over cs2, pulls overlay from 10.250.0.1:39210)

panel (Next) -> worker (host)
  |- HostOps SYSTEM (start/stop VM, GPU-PV, farm-net)
  |- hv-bridge :39201  (Msvm type/click when needed; often down)
  |- guest-agent :39200 on 10.250.0.N  (steam/cs/ping/input/see)
  |- GSI listen 10.250.0.1:32222  (guest cfg posts here)
  |- fsm/loop.mjs
  `- teach-server :39210 on 127.0.0.1 and 10.250.0.1
```

Debug order:
1. `D:\FarmVMs\ops\vision\live.png` from **guest** `/see` (DwmFlush CopyFromScreen, then desktop crop)
2. Teach browser on the host. Overlay is in the VM, not on the host.
3. Guest `/input` on CS2 hwnd
4. Never invent host Steam/CS launches
5. Never grab host desktop / Cursor / Telegram as vision
6. Never require vmconnect open for eyes

`Set-VMHost -EnableEnhancedSessionMode $false`.

## Live pipeline (this is the stack)

```
guest CS2
  -> guest-shot.ps1 (CopyFromScreen / desktop crop)
  -> guest-agent /see /shot
  -> D:\FarmVMs\ops\vision\live.png  (host teach)

cv/engine.py (host OpenCV + ultralytics)
  -> frame.json  observations | estimates | yolo.dets | capture_health
  -> overlay.png + overlay-glass.png
  -> guest-overlay.ps1 pulls http://10.250.0.1:39210/overlay-glass.png

GSI (guest -> host :32222)
  -> parseGsi: hp, team, bomb, pos, weapons  (no viewangles; yaw from mouse + forward)

Confirm (GSI + CV)
  -> phase + gameplay_allowed

Game FSM  (live)
  1. YOLO box  (c/ch/t/th)  if dets exist
  2. GSI world aim          if all/foe xyz
  3. radar / routes / bandit
  rewards: kill is biggest; skip freeze waits; no AFK buy; no C4 in hands; hold W

App FSM  (menus)
  -> click Play etc.  you still start the local bot match yourself

Input
  -> guest-agent /input  (SendInput in VM)

Journal
  -> ticks.jsonl, fsm.log, think-last.json

Teach (host only)
  -> box live.png, notes -> D:\FarmVMs\ops\yolo\human\
  -> train_yolo.py -> D:\FarmVMs\ops\yolo\best.pt
```

YOLO: Priler 4-class `c, ch, t, th` plus human nav `wall, vault, climb, cover, drop, door` (`worker/cv/farm.yaml`). Aim uses only player boxes. Infer on **host CPU**. Empty player dets until `best.pt`. Human boxes beat cloned `human-record` as gold.

Bandit `sense-weights.json` is still a prior, not a ranked player. Instruction prior: `play-policy.mjs`.

## Pieces

| Piece | Path | Role |
|---|---|---|
| CLI | `farm.bat` / `worker/farm.mjs` | status show play grind bot stop teach |
| Eyes | `worker/vm/guest-shot.ps1` | capture CS2 in guest |
| Glass | `worker/vm/guest-overlay.ps1` | TopMost click-through over CS2 in guest |
| CV | `worker/cv/engine.py` | radar + motion + yolo + overlays |
| YOLO | `worker/cv/yolo_infer.py` `train_yolo.py` `priler.yaml` | detect / train |
| Teach | `worker/teach-server.mjs` `cv/teach.html` | host labels UI |
| Loop | `worker/fsm/loop.mjs` | one tick, GSI-live path + menu path |
| Confirm | `worker/fsm/confirm.mjs` | GSI vs CV |
| Game | `worker/fsm/game.mjs` | yolo then gsi then radar |
| GSI | `worker/gsi.mjs` `aim-gsi.mjs` | parse + world aim |
| Agent | `worker/vm/guest-agent.mjs` | `/cs` `/input` `/ping` `/see` `/shot` |
| Defaults | `worker/vm/defaults.mjs` | golden `csfarm-golden`, 6 vCPU, 14 GB static RAM |

## Run

Teach in the **host** browser. Overlay is **inside the VM**. vmconnect is optional (`farm.bat show`).

```
farm.bat teach     host labels, guest shot, guest glass
farm.bat grind     local bots
farm.bat status
farm.bat stop
```

Env: `FARM_ISOLATION=vm`, `FARM_PLAY_ON_GOLDEN=1`, `FARM_ALLOW_CS=1`, `GSI_HOST=10.250.0.1`, `FARM_SKIP_MAP=1`.

Golden now: 6 vCPU, 14 GB **static** RAM (GPU-PV). GPU-PV + HostDriverStore. Do not change CPU/RAM while Running.

## Layers

| Layer | Path | Owns |
|---|---|---|
| panel | `src/` | accounts UI |
| worker orchestrator | `worker/index.mjs` | panel sync |
| farm cli | `worker/farm.mjs` | bring-up + teach + glass |
| isolation | `worker/vm/host.mjs` | slot/golden, agent HTTP |
| host ops | `worker/vm/ops.mjs` + `D:\FarmVMs\ops\` | elevated Hyper-V |
| console | `vm-console.ps1` + hv-bridge | type / click fallback |
| guest | `guest-agent.mjs` | steam/cs, SendInput |
| vision | `worker/cv/` + `worker/fsm/` | pixels + decisions |
| weights | `D:\FarmVMs\ops\yolo\` | best.pt + human labels |

## Isolation

**Only Hyper-V.** GPU-PV required or CS2 dies on Hyper-V Video. CS2 in guest: `-windowed -noborder` (keep the small hwnd; do not fullscreen-maximize from the agent).

## Layout

| Piece | Role |
|---|---|
| Host worker | orchestrate, CV, YOLO train, teach, glass |
| Guest | Steam + CS2 + GPU + guest-agent |
| `csfarm-golden` | Win10 + Steam/CS + GPU-PV |
| `csf-*` slots | differencing disks (later) |
| Switch `csfarm-int` | farm-on only |

## Install

1. `setup-farm.bat` (UAC once)
2. Reboot if asked, rerun
3. `worker.bat` for the panel; `farm.bat` for the bot
