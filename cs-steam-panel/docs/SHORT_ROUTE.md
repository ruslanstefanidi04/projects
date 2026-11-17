# Short route scenario (human demos required)

Map: de_dust2 or current local train map.
Start: T or CT spawn, freeze ended.
Do, 20-40 seconds, 4 independent takes:

1. Hold W, walk a short visible path.
2. Strafe A or D once.
3. Mouse turn (real dx/dy, look left then straighten).
4. Stop (release keys) at a wall or corner.

Rules:
- Bot must be STOPPED (`farm.bat stop`) so you drive.
- CS2 focused in the VM.
- Teach UI mode "запись".
- After each take: save recording.
- Do not mix with YOLO boxing.

Then tell the agent: sessions saved, run `node dataset-qc.mjs` and `node train-bc.mjs`.
Do not invent these demos in code.
