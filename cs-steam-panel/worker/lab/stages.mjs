// lab stage manifest on disk. ready only after a confirmed in-vm test, never from file counts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { FARM_ROOT } from "../vm/defaults.mjs";

export const STAGES_FILE = path.join(FARM_ROOT, "ops", "vision", "lab-stages.json");

const IDS = ["eyes", "walk", "aim", "fire", "strafe", "build"];

export function defaultStages() {
  return {
    currentId: "walk",
    updatedAt: null,
    stages: [
      {
        id: "eyes",
        name: "Зрение",
        status: "Не проверено",
        implemented: [
          "кадр JPEG loop из guest",
          "Priler yolov8m 640 ONNX DirectML",
          "превью CS2 AI Vision",
          "стекло поверх CS2, Hide-Glass выключен"
        ],
        verified: [],
        lastResult: "",
        next: "Проверить рамки на кадре с живыми ботами в раунде"
      },
      {
        id: "walk",
        name: "Ходьба и карта",
        status: "В работе",
        implemented: [
          "A* по occupancy 32x32 с миникарты",
          "цель кликом по радару",
          "остановка с отпусканием клавиш"
        ],
        verified: [],
        lastResult: "",
        next: "Короткий маршрут в VM с нескольких стартов без застревания"
      },
      {
        id: "aim",
        name: "Прицеливание",
        status: "Не начато",
        implemented: ["код PID и Kalman в репозитории, к игре не подключён"],
        verified: [],
        lastResult: "",
        next: "Сначала подтвердить ходьбу"
      },
      {
        id: "fire",
        name: "Стрельба",
        status: "Не начато",
        implemented: ["правила выстрела в коде, к VM не подключены"],
        verified: [],
        lastResult: "",
        next: "После прицеливания"
      },
      {
        id: "strafe",
        name: "Стрейф и бой",
        status: "Не начато",
        implemented: ["заготовка стрейфа в коде, не подключена"],
        verified: [],
        lastResult: "",
        next: "После стрельбы"
      },
      {
        id: "build",
        name: "Сборка агента",
        status: "Не начато",
        implemented: ["лаборатория по умолчанию стоит в режиме ожидания"],
        verified: [],
        lastResult: "",
        next: "Соединять навыки только после отдельных тестов"
      }
    ]
  };
}

export function mergeStages(file) {
  const base = defaultStages();
  if (!file || typeof file !== "object") return base;
  if (typeof file.currentId === "string" && IDS.includes(file.currentId)) base.currentId = file.currentId;
  if (file.updatedAt) base.updatedAt = file.updatedAt;
  const byId = new Map((file.stages || []).map((s) => [s.id, s]));
  base.stages = base.stages.map((d) => {
    const o = byId.get(d.id);
    if (!o) return d;
    const status = String(o.status || d.status);
    return {
      ...d,
      ...o,
      id: d.id,
      name: d.name,
      status: status === "Готово" && !(Array.isArray(o.verified) && o.verified.length) ? d.status : status,
      implemented: Array.isArray(o.implemented) ? o.implemented : d.implemented,
      verified: Array.isArray(o.verified) ? o.verified : d.verified,
      lastResult: o.lastResult != null ? String(o.lastResult) : d.lastResult,
      next: o.next != null ? String(o.next) : d.next
    };
  });
  return base;
}

export function readStages() {
  try {
    if (!existsSync(STAGES_FILE)) return defaultStages();
    return mergeStages(JSON.parse(readFileSync(STAGES_FILE, "utf8")));
  } catch {
    return defaultStages();
  }
}

export function writeStages(next) {
  const cur = mergeStages({ ...readStages(), ...next, updatedAt: new Date().toISOString() });
  mkdirSync(path.dirname(STAGES_FILE), { recursive: true });
  writeFileSync(STAGES_FILE, JSON.stringify(cur, null, 2), "utf8");
  return cur;
}

export function patchStage(id, patch) {
  const cur = readStages();
  const stages = cur.stages.map((s) => {
    if (s.id !== id) return s;
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (v !== undefined) clean[k] = v;
    }
    const next = { ...s, ...clean, id: s.id, name: s.name };
    if (next.status === "Готово" && !(Array.isArray(next.verified) && next.verified.length)) {
      next.status = s.status === "Готово" ? "Не проверено" : s.status;
    }
    return next;
  });
  return writeStages({ ...cur, stages });
}
