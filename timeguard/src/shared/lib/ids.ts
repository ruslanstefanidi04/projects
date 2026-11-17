import { randomBytes } from "crypto";

/** Compact cuid-like id without extra deps. */
export function createId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}
