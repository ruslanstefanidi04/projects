import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve("web");
const dest = resolve("public");
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
