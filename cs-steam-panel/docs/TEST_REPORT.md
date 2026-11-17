# Test report

Command: `node --test ./test/*.test.mjs` in `worker/`.

## Ran

`worker/test/core.test.mjs`.

Not tested in Hyper-V / CS2: capture latency p50/p95/p99 after cv-worker, guest SAMPLE mouse under rawinput, YOLO train split on disk, BC on a real human session, teach browser.

Those are NOT TESTED, not assumed passed.


| Test | Result |
|---|---|
| kill credited once then zero | pass |
| death not doubled on spectate | pass |
| stuck-spawn is rising edge only | pass |
| isSparseEvent | pass |
| parseGsi spectate uses provider steamid | pass |
| obs rejects repeated stale frame | pass |
| obs rejects old screenshot | pass |
| action controller gates look when dead | pass |
| traj needs done + terminal | pass |
| confirmState gsi alive beats false menu cv | pass |

Fail: 0. Skip: 0.

## Not tested (environment)

- Guest screenshot, black frame, resolution change, minimized CS2.
- Concurrent `/see`.
- YOLO on disk dataset, confusion matrix, duplicate images.
- Hyper-V guest-agent restart, CS2 crash recovery.
- End-to-end walk to site on mirage vs bots.
- Live `latency.json` p50/p95/p99.
- Teach UI browser flow.
- Input after `farm stop` (keyup is fire-and-forget; not asserted on VM).

Those are **NOT TESTED**, not assumed passed.

## Syntax

`node --check` on `fsm/loop.mjs`, `reward.mjs`, `record-human.mjs`, `obs.mjs`, `action-ctl.mjs`, `gsi.mjs`.
