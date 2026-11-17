# Performance report

## How latency is measured

`worker/fsm/protocol.mjs` keeps rolling samples (cap 400) for:

- capture_ms / transfer_ms
- cv_ms
- decision_ms
- input_ms
- verify_ms
- cycle_ms

Each reports n, p50, p95, p99, last. Written to `D:/FarmVMs/ops/vision/latency.json` every 8 ticks and on process exit.

This session did **not** run CS2 or the golden VM. Live p50/p95/p99: **NOT TESTED**. Do not treat the stack as real-time.

## What the code implies (not measured)

- Capture: guest `CopyFromScreen` / PrintWindow then HTTP png. Extra PNG encode/decode on host.
- CV: `spawnSync(python, engine.py)` timeout 20000 ms. YOLO `yolov8n` CPU in `train_yolo.py` (`device="cpu"`).
- GSI: in-process HTTP parse, cheap vs CV.
- Policy: dictionary lookup + RNG, cheap vs CV.
- Input: guest `/input` timeout 1500 ms (look 5000). HV fallback for keys except LOOK.
- Effective Hz: one `cycle` then `sleep(60)` when RUNNING. If CV is 1-3s, control is ~0.3-1 Hz.

End-to-end observation-to-action is dominated by screenshot + YOLO, not by `decideGame`.

## Changes that affect timing

- GSI-live path no longer runs `decideGame` on a fabricated frame when CV fails (avoids acting fast on garbage).
- Stale/repeated frames skip action (adds WAIT, does not add capture speed).
- Record CV still blocks on `engine.py` per frame (`FARM_RECORD_FRAME_MS=800` is a lower bound).

## Next measurement (on VM)

1. Start `farm bot`, play 2 minutes in local bots.
2. Copy `D:/FarmVMs/ops/vision/latency.json`.
3. Compare p95 cycle_ms before/after any capture change.
4. Only then: reuse buffers, skip PNG, GPU/ONNX.

Blind GPU work is out of scope until that file exists.
