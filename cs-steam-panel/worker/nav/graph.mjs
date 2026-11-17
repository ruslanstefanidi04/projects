import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "maps");
const cache = new Map();

export function loadMapGraph(mapName) {
  const key = String(mapName || "")
    .toLowerCase()
    .replace(/^de_/, "de_");
  const file = key.includes("dust2") ? "de_dust2.json" : key.includes("mirage") ? "de_mirage.json" : "";
  if (!file) return null;
  if (cache.has(file)) return cache.get(file);
  const g = JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
  cache.set(file, g);
  return g;
}

export function nearestNode(graph, pose) {
  if (!graph?.nodes?.length || !pose) return null;
  let best = null;
  let bestD = Infinity;
  for (const n of graph.nodes) {
    const d = Math.hypot(Number(n.nx) - Number(pose.nx), Number(n.ny) - Number(pose.ny));
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best && bestD < 0.22 ? { node: best, dist: bestD } : null;
}

export function nodeById(graph, id) {
  return graph?.nodes?.find((n) => n.id === id) || null;
}

export function graphPath(graph, startId, goalId) {
  if (!graph || !startId || !goalId) return [];
  if (startId === goalId) return [startId];
  const by = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const q = [startId];
  const prev = { [startId]: null };
  while (q.length) {
    const cur = q.shift();
    if (cur === goalId) break;
    for (const nxt of by[cur]?.links || []) {
      if (prev[nxt] !== undefined) continue;
      prev[nxt] = cur;
      q.push(nxt);
    }
  }
  if (prev[goalId] === undefined && goalId !== startId) return [];
  const out = [];
  let c = goalId;
  while (c) {
    out.push(c);
    c = prev[c];
  }
  out.reverse();
  return out;
}

export function pathPoints(graph, ids) {
  return (ids || []).map((id) => {
    const n = nodeById(graph, id);
    return n ? { id: n.id, nx: n.nx, ny: n.ny, z: n.z } : null;
  }).filter(Boolean);
}

export function goalNodeId(graph, goal) {
  if (!graph || !goal) return null;
  if (goal.id && nodeById(graph, goal.id)) return goal.id;
  const hit = nearestNode(graph, goal);
  return hit?.node?.id || null;
}
