// thin farm vm defaults: win10 guest, dynamic ram, no cs launch yet
export const FARM_ROOT = process.env.FARM_VM_ROOT || "D:\\FarmVMs";
export const GOLDEN_NAME = process.env.FARM_GOLDEN || "csfarm-golden";
export const SWITCH_NAME = process.env.FARM_SWITCH || "csfarm-int";
export const AGENT_PORT = Number(process.env.FARM_AGENT_PORT || 39200) || 39200;
export const AGENT_TOKEN = process.env.FARM_AGENT_TOKEN || process.env.WORKER_TOKEN || "csfarm";

// working set target for min cs2 window later; idle reclaims via dynamic memory
// GPU-PV needs fixed RAM; defaults sized for CS2 micro-window on discrete GPU
export const MEM_STARTUP_MB = Number(process.env.FARM_MEM_START_MB || 14336) || 14336;
export const MEM_MIN_MB = Number(process.env.FARM_MEM_MIN_MB || 8192) || 8192;
export const MEM_MAX_MB = Number(process.env.FARM_MEM_MAX_MB || 14336) || 14336;
export const GPU_PV = process.env.FARM_GPU_PV !== "0";
export const VCPU = Number(process.env.FARM_VCPU || 6) || 6;
export const DISK_GB = Number(process.env.FARM_DISK_GB || 80) || 80;

export function slotName(accOrLogin) {
  if (accOrLogin && typeof accOrLogin === "object" && accOrLogin.vmSlot) {
    const forced = String(accOrLogin.vmSlot)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "")
      .slice(0, 32);
    if (forced) return forced.startsWith("csf-") ? forced : ("csf-" + forced).slice(0, 32);
  }
  const raw =
    typeof accOrLogin === "string"
      ? accOrLogin
      : accOrLogin?.ipcName || accOrLogin?.login || accOrLogin?.id || "slot";
  const clean = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return ("csf-" + (clean || "slot")).slice(0, 32);
}
