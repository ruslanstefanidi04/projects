const COLORS = ["#66ccff", "#99ddff", "#ffaa66", "#ff8866", "#cc4444", "#888", "#888", "#ddaa66", "#888", "#888", "#88ff66", "#9a8a7a"];
const NAME_CLS = { c: 0, ch: 1, t: 2, th: 3, ct: 0, cthead: 1, thead: 3 };
let yoloDets = [];
let boxes = [];
let cls = 1;
let drag = null;
const bg = document.getElementById("bg");
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");

function showTab(id) {
  document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("on", x.dataset.tab === id));
  document.querySelectorAll(".panel").forEach((p) => {
    const on = p.id === "p-" + id;
    p.classList.toggle("on", on);
    p.hidden = !on;
  });
}

document.querySelectorAll(".nav button").forEach((b) => {
  b.onclick = () => showTab(b.dataset.tab);
});
document.querySelectorAll(".cls button").forEach((b) => {
  b.onclick = () => {
    cls = Number(b.dataset.cls);
    document.querySelectorAll(".cls button").forEach((x) => x.classList.toggle("on", x === b));
  };
});

function nat() {
  return { w: bg.naturalWidth || 1, h: bg.naturalHeight || 1, dw: bg.clientWidth || 1, dh: bg.clientHeight || 1 };
}
function draw() {
  if (!cv) return;
  const { dw, dh } = nat();
  cv.width = dw;
  cv.height = dh;
  ctx.clearRect(0, 0, dw, dh);
  for (const b of boxes) {
    const x = (b.cx - b.w / 2) * dw;
    const y = (b.cy - b.h / 2) * dh;
    ctx.strokeStyle = COLORS[b.cls] || "#fff";
    ctx.strokeRect(x, y, b.w * dw, b.h * dh);
  }
  if (drag) {
    ctx.strokeStyle = "#fff";
    ctx.setLineDash([]);
    ctx.strokeRect(drag.x, drag.y, drag.w, drag.h);
  }
}
function pos(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
cv.onmousedown = (e) => {
  const p = pos(e);
  drag = { x: p.x, y: p.y, w: 0, h: 0 };
};
window.onmousemove = (e) => {
  if (!drag) return;
  const p = pos(e);
  drag.w = p.x - drag.x;
  drag.h = p.y - drag.y;
  draw();
};
window.onmouseup = () => {
  if (!drag) return;
  if (Math.abs(drag.w) > 6 && Math.abs(drag.h) > 6) {
    const { w, h, dw, dh } = nat();
    const sx = w / dw;
    const sy = h / dh;
    const x0 = Math.min(drag.x, drag.x + drag.w) * sx;
    const y0 = Math.min(drag.y, drag.y + drag.h) * sy;
    const x1 = Math.max(drag.x, drag.x + drag.w) * sx;
    const y1 = Math.max(drag.y, drag.y + drag.h) * sy;
    const bw = (x1 - x0) / w;
    const bh = (y1 - y0) / h;
    boxes.push({ cls, cx: x0 / w + bw / 2, cy: y0 / h + bh / 2, w: bw, h: bh });
  }
  drag = null;
  draw();
};
function loadFrame() {
  bg.onload = draw;
  bg.src = "/live.png?t=" + Date.now();
  bg.onerror = () => {
    document.getElementById("eyesOut").textContent = "нет live.png";
  };
}
document.getElementById("undo").onclick = () => {
  boxes.pop();
  draw();
};
document.getElementById("refresh").onclick = async () => {
  boxes = [];
  await fetch("/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  loadFrame();
};

function paintOverlayBtn(on) {
  const b = document.getElementById("overlayYolo");
  if (!b) return;
  b.classList.toggle("on", on);
  b.textContent = on ? "оверлей YOLO: вкл" : "оверлей YOLO: выкл";
}

async function setOverlay(on) {
  paintOverlayBtn(on);
  try {
    localStorage.setItem("labOverlayYolo", on ? "1" : "0");
  } catch {}
  await fetch("/api/overlay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: on })
  });
  if (!on) {
    await new Promise((r) => setTimeout(r, 250));
    await fetch("/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    loadFrame();
  }
}

document.getElementById("overlayYolo").onclick = () => {
  const on = !document.getElementById("overlayYolo").classList.contains("on");
  setOverlay(on);
};

(async () => {
  let on = true;
  try {
    on = localStorage.getItem("labOverlayYolo") !== "0";
  } catch {}
  paintOverlayBtn(on);
  try {
    await setOverlay(on);
  } catch {}
})();
document.getElementById("save").onclick = async () => {
  const r = await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ boxes, walk: "", aim: "", timing: "off" })
  });
  const j = await r.json();
  document.getElementById("eyesOut").textContent =
    (j.trained ? "ошибка: train от save" : "разметка сохранена, train не запускался") +
    "\n" +
    JSON.stringify(j.saved || j, null, 2);
  boxes = [];
  draw();
  loadFrame();
  tick();
};
document.getElementById("trainEyes").onclick = async () => {
  const r = await fetch("/api/train-eyes", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const j = await r.json();
  document.getElementById("eyesOut").textContent = "train очередь. бот не переключён.\n" + (j.say || "") + " " + (j.log || "");
};
document.getElementById("testEyes").onclick = async () => {
  const r = await fetch("/api/eyes/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const j = await r.json();
  document.getElementById("eyesOut").textContent =
    "проверка кадра, бот не тронут. объектов: " + (j.n ?? 0) + "\n" + JSON.stringify(j.dets || [], null, 2);
  tick();
};

const radar = document.getElementById("radar");
const radarPath = document.getElementById("radarPath");
const occView = document.getElementById("occView");
let lastOcc = null;

function drawOccView(occ, lab, self) {
  if (!occView) return;
  const n = (occ && occ.length) || 32;
  const s = 320;
  occView.width = s;
  occView.height = s;
  const g = occView.getContext("2d");
  const cell = s / n;
  g.fillStyle = "#101810";
  g.fillRect(0, 0, s, s);
  if (Array.isArray(occ)) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (occ[y] && Number(occ[y][x]) > 0.5) {
          g.fillStyle = "rgba(220,40,40,0.85)";
          g.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    }
  }
  const path = (lab && lab.path) || [];
  if (path.length > 1) {
    g.beginPath();
    g.strokeStyle = "#ffe14a";
    g.lineWidth = 2;
    path.forEach((p, i) => {
      const x = Number(p.nx) * s;
      const y = Number(p.ny) * s;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
  function dot(p, color, r) {
    if (!p) return;
    const x = Number(p.nx) * s;
    const y = Number(p.ny) * s;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  dot(self, "#4ad6ff", 5);
  if (lab && lab.goal) dot(lab.goal, "#ff5ad6", 5);
}

function drawRadarPath(lab, self) {
  if (!radarPath || !radar) return;
  const w = radar.clientWidth;
  const h = radar.clientHeight;
  if (!w || !h) return;
  if (radarPath.width !== w || radarPath.height !== h) {
    radarPath.width = w;
    radarPath.height = h;
  }
  const g = radarPath.getContext("2d");
  g.clearRect(0, 0, w, h);
  const path = (lab && lab.path) || [];
  if (path.length > 1) {
    g.beginPath();
    g.strokeStyle = "#ffe14a";
    g.lineWidth = 3;
    g.lineJoin = "round";
    g.lineCap = "round";
    path.forEach((p, i) => {
      const x = Number(p.nx) * w;
      const y = Number(p.ny) * h;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
  function dot(p, color, r) {
    if (!p) return;
    const x = Number(p.nx) * w;
    const y = Number(p.ny) * h;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  dot(self, "#4ad6ff", 6);
  const hint = (lastWalk && lastWalk.selfHint) || null;
  if (hint) {
    g.strokeStyle = "#4ad6ff";
    g.lineWidth = 2;
    const x = Number(hint.nx) * w;
    const y = Number(hint.ny) * h;
    g.beginPath();
    g.arc(x, y, 11, 0, Math.PI * 2);
    g.stroke();
  }
  if (lab && lab.goal) {
    g.strokeStyle = "#ff5ad6";
    g.lineWidth = 2;
    const x = Number(lab.goal.nx) * w;
    const y = Number(lab.goal.ny) * h;
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.stroke();
    dot(lab.goal, "#ff5ad6", 4);
  }
}

radar.addEventListener("load", () => {
  lastWalk && drawRadarPath(lastWalk.lab, lastWalk.liveSelf || lastWalk.selfRadar);
});
function radarNorm(e) {
  const r = radar.getBoundingClientRect();
  return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
}
radar.onclick = async (e) => {
  const { nx, ny } = radarNorm(e);
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-goal", nx, ny })
    })
  ).json();
  document.getElementById("walkOut").textContent = (j.say || "") + " nx=" + nx.toFixed(3) + " ny=" + ny.toFixed(3);
  reloadRadarImg();
  tick();
};
radar.oncontextmenu = async (e) => {
  e.preventDefault();
  const { nx, ny } = radarNorm(e);
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-self", nx, ny })
    })
  ).json();
  document.getElementById("walkOut").textContent = (j.say || "") + " я nx=" + nx.toFixed(3) + " ny=" + ny.toFixed(3);
  tick();
};
function reloadRadarImg() {
  radar.src = "/radar.png?t=" + Date.now();
}
document.getElementById("walkKick").onclick = async () => {
  if (!confirm("Кикнуть всех ботов в VM и поставить quota 0? Останется пустая карта для ходьбы.")) return;
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "kick-bots" })
    })
  ).json();
  document.getElementById("walkOut").textContent = j.say || JSON.stringify(j, null, 2);
  tick();
};
document.getElementById("walkSnap").onclick = async () => {
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "snapshot" })
    })
  ).json();
  document.getElementById("walkOut").textContent = j.say || "";
  reloadRadarImg();
  tick();
};
document.getElementById("walkPlan").onclick = async () => {
  const j = await (
    await fetch("/api/lab/walk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "plan" }) })
  ).json();
  const shown = j.plan
    ? { ...j.plan, debug: { ...(j.plan.debug || {}), occupancy: j.plan.debug && j.plan.debug.occupancy ? "32x32" : null } }
    : j;
  document.getElementById("walkOut").textContent = (j.say || "") + "\n" + JSON.stringify(shown, null, 2);
  lastOcc = j.plan && j.plan.debug && j.plan.debug.occupancy;
  reloadRadarImg();
  tick();
};
document.getElementById("walkStart").onclick = async () => {
  if (!confirm("Запустить ходьбу в VM через guest-input? Это нажмёт WASD.")) return;
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", confirm: true })
    })
  ).json();
  document.getElementById("walkOut").textContent =
    (j.say || "") +
    "\n" +
    JSON.stringify({ lab: j.lab || {}, input: j.input || [], drive: j.drive, ok: j.ok }, null, 2);
  tick();
};
document.getElementById("walkStop").onclick = async () => {
  const j = await (
    await fetch("/api/lab/walk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) })
  ).json();
  document.getElementById("walkOut").textContent = j.say || "";
  tick();
};
document.getElementById("walkNudge").onclick = async () => {
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "nudge" })
    })
  ).json();
  document.getElementById("walkOut").textContent = (j.say || "") + "\n" + JSON.stringify(j.input || {}, null, 2);
  tick();
};
document.getElementById("walkClearSelf").onclick = async () => {
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clear-self" })
    })
  ).json();
  document.getElementById("walkOut").textContent = j.say || "";
  tick();
};
async function gradeWalk(ok) {
  const j = await (
    await fetch("/api/lab/walk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "grade", ok })
    })
  ).json();
  document.getElementById("walkOut").textContent = j.say || "";
  tick();
}
document.getElementById("copyWalkLog").onclick = async () => {
  const j = await (await fetch("/api/lab/walk-log")).json();
  const text = (j.text || "") + "\n--- ui ---\n" + (document.getElementById("walkOut").textContent || "");
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("copyWalkLog").textContent = "скопировано";
    setTimeout(() => {
      document.getElementById("copyWalkLog").textContent = "копировать лог";
    }, 1200);
  } catch {
    document.getElementById("walkOut").textContent = text;
  }
};
document.getElementById("walkGradeOk").onclick = () => gradeWalk(true);
document.getElementById("walkGradeBad").onclick = () => gradeWalk(false);

let tuneT = 0;
function pushTune() {
  const t = {
    wall_max: Number(document.getElementById("wallMax").value),
    wall_fill: Number(document.getElementById("wallFill").value),
    occ_n: Number(document.getElementById("occN").value)
  };
  document.getElementById("vWallMax").textContent = t.wall_max;
  document.getElementById("vWallFill").textContent = t.wall_fill;
  document.getElementById("vOccN").textContent = t.occ_n;
  clearTimeout(tuneT);
  tuneT = setTimeout(() => {
    fetch("/api/lab/radar-tune", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(t)
    }).catch(() => {});
  }, 60);
}
["wallMax", "wallFill", "occN"].forEach((id) => {
  const n = document.getElementById(id);
  if (n) n.oninput = pushTune;
});

let lastWalk = null;

function fmt(v) {
  if (v == null || v === "") return "Нет данных";
  if (typeof v === "boolean") return v ? "да" : "Нет данных";
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v * 1000) / 1000);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function stClass(s) {
  if (s === "Готово") return "st-ok";
  if (s === "В работе") return "st-work";
  return "st-wait";
}
function renderHome(j) {
  const stages = (j.stages && j.stages.stages) || [];
  const ready = stages.filter((s) => s.status === "Готово").length;
  document.getElementById("prog").innerHTML = stages
    .map(
      (s) =>
        "<div class=\"p\"><b>" +
        s.name +
        "</b><span class=\"" +
        stClass(s.status) +
        "\">" +
        s.status +
        "</span></div>"
    )
    .join("");
  const walk = stages.find((s) => s.id === "walk") || {};
  let banner = "Сейчас работаем над: Ходьба и карта";
  if (j.lab && j.lab.moving) banner = "Идёт тест ходьбы в VM. Этап всё ещё не подтверждён.";
  else if (ready === 0) banner = "Сейчас работаем над: Ходьба и карта. Готовых этапов: 0 из 6 (тест в игре не подтверждался).";
  document.getElementById("nowBanner").textContent = banner;
  document.getElementById("homeNext").textContent =
    "Следующее действие: " + (walk.next || "открыть «Ходьба и карта» и проверить данные карты.");
}
function renderEyes(j) {
  const w = j.weights || {};
  document.getElementById("eyesKv").innerHTML = [
    ["модель", w.exists ? "YOLO, файл весов есть" : "Нет данных"],
    ["путь весов", w.path || "Нет данных"],
    ["размер весов", w.exists ? w.bytes + " байт" : "Нет данных"],
    ["размеченных картинок", j.labeled == null ? "Нет данных" : String(j.labeled)],
    ["классы", (j.classes || []).map((c) => c.label || c.name).join(", ") || "CT/T тело и голова"],
    ["объектов на кадре", String(j.yoloN ?? 0)],
    ["backend", j.yoloBackend || "Нет данных"],
    ["yolo ms", j.yoloMs == null ? "Нет данных" : String(j.yoloMs)],
    ["обучение сейчас", j.trainOn ? "идёт (отдельный процесс)" : "нет"],
    ["последняя проверка", ((j.stages && j.stages.stages) || []).find((s) => s.id === "eyes")?.lastResult || "ещё не жали «проверить»"]
  ]
    .map((r) => "<span>" + r[0] + "</span><span>" + r[1] + "</span>")
    .join("");
}
function renderWalk(j) {
  const lab = j.lab || {};
  document.getElementById("walkKv").innerHTML = [
    ["карта", j.map || "Нет данных"],
    ["геометрия", "Нет данных"],
    ["navmesh", "Нет данных"],
    ["преобразование координат", j.pos ? "есть xyz из GSI" : "Нет данных"],
    ["координаты игрока", j.pos ? fmt(j.pos) : "Нет данных"],
    ["направление камеры", j.forward ? fmt(j.forward) : j.facing != null ? fmt(j.facing) + " deg" : "Нет данных"],
    ["я на радаре", j.selfRadar ? fmt(j.selfRadar) : "Нет данных"],
    ["я live", j.liveSelf ? fmt(j.liveSelf) : j.radarHeld ? "держим прошлую точку" : "Нет данных"],
    ["метка я", j.selfHint ? fmt(j.selfHint) : "нет, ПКМ по радару"],
    ["радар ok", j.radarOk ? "да" : "нет"],
    ["радар reason", j.radarReason || ""],
    ["порог стены", j.wallCut == null ? "Нет данных" : String(j.wallCut)],
    ["occupancy", j.occupancyN ? j.occupancyN + "x" + j.occupancyN : "Нет данных"],
    ["файл радара", j.radarFrozen ? "снимок" : j.radarFile ? "живой кроп" : "Нет данных"],
    ["цель", lab.goal ? fmt(lab.goal) : "Нет данных"],
    ["точек пути", Array.isArray(lab.path) ? String(lab.path.length) : "Нет данных"],
    ["путь на walk-клетках", lab.pathFit == null ? "Нет данных" : lab.pathFit + "%"],
    ["оценка маршрута", lab.grade === "ok" ? "верный" : lab.grade === "bad" ? "врёт" : "ещё нет"],
    ["движение", lab.moving ? "идёт" : "стоит"],
    ["причина остановки", lab.stopReason || "Нет данных"],
    ["ошибка", lab.error || ""],
    ["drive", j.drive && j.drive.running ? "тик " + j.drive.ticks + " hold " + (j.drive.held || "-") + " " + (j.drive.reason || "") : "стоит"],
    ["guest input", (j.drive && (j.drive.error || j.drive.guest)) || ""]
  ]
    .map((r) => "<span>" + r[0] + "</span><span>" + r[1] + "</span>")
    .join("");
  const fitEl = document.getElementById("pathFitLine");
  if (fitEl) {
    if (!Array.isArray(lab.path) || !lab.path.length) fitEl.textContent = "Сначала клик и «рассчитать маршрут».";
    else {
      const fit = lab.pathFit == null ? "?" : lab.pathFit;
      fitEl.textContent =
        "Линия на радаре: " +
        lab.path.length +
        " точек. На проходимых клетках сетки: " +
        fit +
        "%. Это не «насколько я прав глазами».";
    }
  }
  lastWalk = j;
  drawRadarPath(lab, j.liveSelf || j.selfRadar);
  drawOccView(j.occupancy || lastOcc, lab, j.liveSelf || j.selfRadar);
  const t = j.tune;
  const el = (id) => document.getElementById(id);
  if (t && el("wallMax") && document.activeElement !== el("wallMax")) {
    el("wallMax").value = t.wall_max;
    el("vWallMax").textContent = t.wall_max;
  }
  if (t && el("wallFill") && document.activeElement !== el("wallFill")) {
    el("wallFill").value = t.wall_fill;
    el("vWallFill").textContent = t.wall_fill;
  }
  if (el("occN") && t && document.activeElement !== el("occN")) {
    el("occN").value = t.occ_n;
    el("vOccN").textContent = t.occ_n;
  }
  const dlog = document.getElementById("walkDriveLog");
  if (dlog) {
    const d = j.drive || {};
    dlog.textContent = d.running
      ? "тик " +
        d.ticks +
        " reason=" +
        (d.reason || "") +
        " hold=" +
        (d.held || "-") +
        " guest=" +
        (d.guest || "") +
        (d.error ? " ERR " + d.error : "") +
        (d.sample ? "\n" + String(d.sample).slice(0, 240) : "")
      : "drive выкл. " + (d.guest || d.error || d.reason || "");
  }
}
function renderDiag(j) {
  document.getElementById("diagKv").innerHTML = [
    ["guest GSI файл", j.selfAgeMs == null ? "Нет данных" : j.selfAgeMs + " мс назад"],
    ["живой кадр", j.hasLive ? "есть" : "нет"],
    ["навык лаборатории", (j.lab && j.lab.skill) || "idle"],
    ["подтверждена ходьба", j.lab && j.lab.confirmed ? "да" : "нет"],
    ["контроллер", "guest-input, лаборатория по умолчанию ждёт"]
  ]
    .map((r) => "<span>" + r[0] + "</span><span>" + r[1] + "</span>")
    .join("");
}
async function tick() {
  const j = await (await fetch("/api/lab")).json();
  renderHome(j);
  renderEyes(j);
  renderWalk(j);
  renderDiag(j);
  try {
    const h = await (await fetch("/api/hud")).json();
    document.getElementById("diagOut").textContent =
      "экран: " +
      (h.screen || "") +
      "\nпричина: " +
      (h.reason || "") +
      "\nзапись: " +
      JSON.stringify(h.record || {}) +
      "\nmean=" +
      h.mean +
      " yoloN=" +
      h.yoloN;
  } catch {
    document.getElementById("diagOut").textContent = "hud недоступен";
  }
}
setInterval(tick, 1200);
setInterval(() => {
  const p = document.getElementById("p-eyes");
  const img = document.getElementById("yoloPrev");
  if (!p || !img || p.hidden) return;
  img.src = "/preview.jpg?t=" + Date.now();
}, 180);
loadFrame();
tick();
showTab("home");
