import { EventEmitter } from "node:events";
import type { Alert } from "../entities/listing.js";

export const bus = new EventEmitter();

export function emitAlerts(alerts: Alert[]) {
  if (alerts.length) bus.emit("alerts", alerts);
}

export function emitTick(payload: unknown) {
  bus.emit("tick", payload);
}
