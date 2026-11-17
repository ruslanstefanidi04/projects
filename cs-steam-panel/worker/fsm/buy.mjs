import { VK } from "../input.mjs";

// cs2 buy: B, digits, B. never console "buy ak47".
// user seq: b 4 2, b 4 6, b 1 4

export function buyMenuSeq(gsi) {
  const money = Number(gsi?.money || 0);
  if (money < 200) return [];
  const seq = [];
  if (money >= 300) seq.push(["4", "2"]);
  if (money >= 400) seq.push(["4", "6"]);
  if (money >= 2700) seq.push(["1", "4"]);
  return seq;
}

export function buyMenuKeys(gsi) {
  return buyMenuSeq(gsi).flat();
}

export function buyHint(gsi) {
  const money = Number(gsi?.money || 0);
  if (alreadyArmed(gsi)) return "уже броня и ствол, закуп не жми";
  if (money < 200) return "$" + money + " мало, ничего";
  const seq = buyMenuSeq(gsi);
  const names = seq.map((keys) => {
    const k = keys.join(" ");
    if (k === "4 2") return "броня B 4 2";
    if (k === "4 6") return "экип B 4 6";
    if (k === "1 4") return "винтовка B 1 4";
    return "B " + k;
  });
  return "$" + money + " можно: " + names.join(", ");
}

export function alreadyArmed(gsi) {
  const gun = Boolean(gsi?.hasRifle) ||
    /ak47|m4a1|awp|galilar|famas|sg556|aug|scar20|g3sg1|ssg08|mp9|mac10|ump|p90|mp7|mp5|bizon|nova|xm1014|mag7|sawedoff|negev|m249/i.test(
      String(gsi?.weapon || "")
    );
  const armor = Number(gsi?.armor || 0) >= 50;
  return gun && armor;
}

function digitVk(k) {
  return 0x30 + Number(k);
}

export async function runBuyMenu(gsi, tapVk, sleep) {
  const seq = buyMenuSeq(gsi);
  if (!seq.length) return false;
  for (const keys of seq) {
    await tapVk(VK.B);
    await sleep(140);
    for (const k of keys) {
      await tapVk(digitVk(k));
      await sleep(70);
    }
    await sleep(60);
    await tapVk(VK.B);
    await sleep(80);
  }
  return true;
}
