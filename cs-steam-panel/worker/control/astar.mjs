// 4-connected a* on a small occupancy grid. hart et al. 1968, not nav2/ros.
export function cellOf(nx, ny, n = 32) {
  const x = Math.max(0, Math.min(n - 1, Math.floor(Number(nx) * n)));
  const y = Math.max(0, Math.min(n - 1, Math.floor(Number(ny) * n)));
  return { x, y };
}

export function worldOf(c, n = 32) {
  return { nx: (c.x + 0.5) / n, ny: (c.y + 0.5) / n };
}

export function emptyGrid(n = 32) {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

export function occFromRadar({ n = 32, self, goal, wall_ahead, facing_deg, blocked, occupancy } = {}) {
  let g;
  if (Array.isArray(occupancy) && occupancy.length === n && Array.isArray(occupancy[0]) && occupancy[0].length === n) {
    g = occupancy.map((row) => row.map((v) => (Number(v) > 140 ? 1 : 0)));
  } else {
    g = emptyGrid(n);
    if (Array.isArray(blocked)) {
      for (const b of blocked) {
        const c = cellOf(b.nx ?? b.x, b.ny ?? b.y, n);
        g[c.y][c.x] = 1;
      }
    }
    if (wall_ahead && self && Number.isFinite(Number(self.nx))) {
      const c = cellOf(self.nx, self.ny, n);
      const rad = ((Number(facing_deg) || 0) * Math.PI) / 180;
      const fx = Math.sin(rad);
      const fy = -Math.cos(rad);
      for (let s = 1; s <= 4; s++) {
        const x = Math.round(c.x + fx * s);
        const y = Math.round(c.y + fy * s);
        if (x >= 0 && y >= 0 && x < n && y < n) g[y][x] = 1;
      }
    }
  }
  carve(g, self, n);
  carve(g, goal, n);
  return g;
}

function carve(g, p, n) {
  if (!p || !Number.isFinite(Number(p.nx))) return;
  const c = cellOf(p.nx, p.ny, n);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x >= 0 && y >= 0 && x < n && y < n) g[y][x] = 0;
    }
  }
}

export function nearestWalk(grid, start) {
  const h = grid.length;
  const w = grid[0]?.length || 0;
  const inb = (c) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h;
  const q = [{ ...start }];
  const seen = new Set([start.x + "," + start.y]);
  while (q.length) {
    const c = q.shift();
    if (inb(c) && grid[c.y][c.x] !== 1) return c;
    for (const n of [
      { x: c.x + 1, y: c.y },
      { x: c.x - 1, y: c.y },
      { x: c.x, y: c.y + 1 },
      { x: c.x, y: c.y - 1 }
    ]) {
      const k = n.x + "," + n.y;
      if (!inb(n) || seen.has(k)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return start;
}

export function astar(grid, start, goal) {
  const h = grid.length;
  const w = grid[0]?.length || 0;
  if (!h || !w) return [];
  const key = (c) => c.x + "," + c.y;
  const inb = (c) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h;
  const walk = (c) => inb(c) && grid[c.y][c.x] !== 1;
  start = nearestWalk(grid, start);
  goal = nearestWalk(grid, goal);
  if (!walk(start) || !walk(goal)) return [];
  const open = [{ ...start, g: 0, f: heur(start, goal) }];
  const came = new Map();
  const gBest = new Map([[key(start), 0]]);
  const seen = new Set();
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (cur.x === goal.x && cur.y === goal.y) return rebuild(came, cur);
    const ck = key(cur);
    if (seen.has(ck)) continue;
    seen.add(ck);
    for (const n of [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
      { x: cur.x + 1, y: cur.y + 1 },
      { x: cur.x - 1, y: cur.y - 1 },
      { x: cur.x + 1, y: cur.y - 1 },
      { x: cur.x - 1, y: cur.y + 1 }
    ]) {
      if (!walk(n)) continue;
      const diag = n.x !== cur.x && n.y !== cur.y;
      const ng = cur.g + (diag ? 1.4 : 1);
      const nk = key(n);
      if (ng >= (gBest.get(nk) ?? Infinity)) continue;
      gBest.set(nk, ng);
      came.set(nk, cur);
      open.push({ ...n, g: ng, f: ng + heur(n, goal) });
    }
  }
  return [];
}

function heur(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function rebuild(came, cur) {
  const out = [{ x: cur.x, y: cur.y }];
  let k = cur.x + "," + cur.y;
  while (came.has(k)) {
    cur = came.get(k);
    out.push({ x: cur.x, y: cur.y });
    k = cur.x + "," + cur.y;
  }
  return out.reverse();
}
