// aim/fire need a current picture. nav may use radar/gsi without yolo.
export const AIM_MAX_AGE_MS = 800;
export const NAV_MAX_AGE_MS = 12000;

export function frameAgeMs(frame) {
  const n = Number(frame?.age_ms);
  return Number.isFinite(n) ? n : null;
}

export function isFreshForAim(frame) {
  const age = frameAgeMs(frame);
  if (age == null) return false;
  return age <= AIM_MAX_AGE_MS;
}

export function isFreshForNav(frame) {
  const age = frameAgeMs(frame);
  if (age == null) return true;
  return age <= NAV_MAX_AGE_MS;
}
