// instruction prior + live host prompt from farm teach
import { existsSync, readFileSync } from "fs";

export const RULES = [
  "leave-spawn",
  "rifle-not-c4",
  "run-waypoints",
  "no-walk-into-wall",
  "kills-first",
  "plant-only-on-site"
];

const PROMPT = "D:/FarmVMs/ops/yolo/human/live-prompt.txt";
const INTENT = "D:/FarmVMs/ops/yolo/human/live-intent.json";

export const PROMPT_SAY = {
  wait: "стою, не стреляю",
  reload: "перезаряжаюсь",
  plant: "иду ставить бомбу на сайт",
  defuse: "разминирую",
  "fight-peek": "peek из укрытия",
  "curb-jump": "прыжок / climb",
  "radar-turn": "разворачиваюсь в другую сторону",
  "fight-push": "цельюсь и стреляю",
  "strafe-advance": "иду вперёд",
  "walk-w": "иду прямо (W)",
  "walk-a": "иду налево (A)",
  "walk-d": "иду направо (D)",
  "walk-s": "иду назад (S)",
  "walk-wa": "иду прямо и налево (W+A)",
  "walk-wd": "иду прямо и направо (W+D)",
  "walk-sa": "иду назад и налево (S+A)",
  "walk-sd": "иду назад и направо (S+D)",
  pickup: "подбираю калаш/авик с пола (E)"
};

const RULES_MATCH = [
  [/wait|жди|стой|стоп|не стрел|замер/, "wait"],
  [/reload|перезаряд/, "reload"],
  [/plant|завод|бомб|сайт/, "plant"],
  [/defuse|размин/, "defuse"],
  [/подбер|лут|калаш|авик|awp|ak47|ган на полу/, "pickup"],
  [/peek|угол|укрыт|выглян/, "fight-peek"],
  [/jump|прыг|climb|залез/, "curb-jump"],
  [/развер|оглян|верни|turn around|behind|смотр|глян/, "radar-turn"],
  [/aim|kill|стреля|хед|head|враг|enemy|цель/, "fight-push"]
];

function matchWalk(t) {
  if (/^walk-[wasd]{1,2}$/.test(t)) return t;
  if (/развер|оглян|верни камер/.test(t)) return null;
  if (/смотр|глян/.test(t) && !/иди|идти|беги|walk|вперёд|вперед|прям/.test(t)) return null;
  const left = /налев|влево|(^| )a\b|(^| )left\b/.test(t);
  const right = /направ|вправо|(^| )d\b|(^| )right\b/.test(t);
  const back = /назад|(^| )back\b|(^| )s\b/.test(t);
  const go = /иди|идти|беги|гуляй|walk|forward|вперёд|вперед|прям|держи w|hold w|(^| )w\b/.test(t);
  const strafeOnly = /стрейф|strafe|только a|только d/.test(t);
  if (!left && !right && !back && !go) return null;
  let keys = "";
  const fwd = !back && (go || /прям|вперёд|вперед|forward/.test(t));
  if (back) keys += "s";
  else if (fwd && !strafeOnly) keys += "w";
  else if (go && !strafeOnly && (left || right)) keys += "w";
  if (left && !right) keys += "a";
  if (right && !left) keys += "d";
  if (!keys) return null;
  return "walk-" + keys;
}

export function readLivePrompt() {
  try {
    if (!existsSync(PROMPT)) return "";
    return readFileSync(PROMPT, "utf8").trim().slice(0, 2000);
  } catch {
    return "";
  }
}

export function matchPrompt(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;
  const walk = matchWalk(t);
  if (walk) return walk;
  for (const [re, action] of RULES_MATCH) {
    if (re.test(t)) return action;
  }
  return null;
}

export function parsePrompt(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { ok: false, understood: false, action: null, say: "пусто. напиши что делать" };
  }
  const action = matchPrompt(raw);
  if (!action) {
    return {
      ok: true,
      understood: false,
      action: null,
      say: "не понял. можно: иди прямо, иди налево, прямо и налево, направо, назад, стреляй, прыгай, жди, развернись"
    };
  }
  return {
    ok: true,
    understood: true,
    action,
    say: "понял: " + (PROMPT_SAY[action] || action)
  };
}

export function readLiveIntent() {
  try {
    if (!existsSync(INTENT)) return { walk: "walk-wa", aim: "yolo-head", timing: "auto" };
    return { walk: "walk-wa", aim: "yolo-head", timing: "auto", ...JSON.parse(readFileSync(INTENT, "utf8") || "{}") };
  } catch {
    return { walk: "walk-wa", aim: "yolo-head", timing: "auto" };
  }
}

export function preferByPrompt() {
  const i = readLiveIntent();
  if (i.walk === "wait") return "wait";
  if (i.walk && /^walk-[wasd]+$/.test(String(i.walk))) return i.walk;
  if (i.aim === "yolo-head" || i.aim === "yolo-body") return "fight-push";
  return matchPrompt(readLivePrompt());
}

export function preferByRules(gsi) {
  if (!gsi || !gsi.alive) return null;
  const zone = String(gsi.zone || "");
  if (zone.includes("spawn")) return "walk-w";
  if (gsi.wallAhead) return "unstick-wall";
  if (gsi.holdingC4 && !gsi.atSite) return "explore";
  return null;
}
