// host helper: queue Hyper-V console job for CSFarmHostOps (SYSTEM) and wait for view png
import { writeFileSync, readFileSync, existsSync, unlinkSync, copyFileSync } from "fs";
import { spawnSync } from "child_process";

const ops = "D:\\FarmVMs\\ops";
const job = `${ops}\\run.ps1`;
const log = `${ops}\\last.log`;
const view = `${ops}\\view.png`;

const mode = process.argv[2] || "cs";

if (mode === "see") {
  writeFileSync(
    job,
    `
$ErrorActionPreference = "Stop"
& powershell -NoProfile -ExecutionPolicy Bypass -File "D:\\FarmVMs\\vm-console.ps1" -Action see -OutPng "D:\\FarmVMs\\ops\\view.png" | Tee-Object "D:\\FarmVMs\\ops\\last.log"
`
  );
} else if (mode === "cs") {
  // keep existing run.ps1 content if present; else write minimal
  if (!existsSync(job)) {
    console.error("missing run.ps1");
    process.exit(2);
  }
} else if (mode === "type") {
  const text = process.argv.slice(3).join(" ");
  writeFileSync(
    job,
    `
$ErrorActionPreference = "Stop"
& powershell -NoProfile -ExecutionPolicy Bypass -File "D:\\FarmVMs\\vm-console.ps1" -Action type -Text @'
${text.replace(/'/g, "''")}
'@ | Tee-Object "D:\\FarmVMs\\ops\\last.log"
& powershell -NoProfile -ExecutionPolicy Bypass -File "D:\\FarmVMs\\vm-console.ps1" -Action see -OutPng "D:\\FarmVMs\\ops\\view.png"
`
  );
} else {
  console.error("usage: node vm-console-host.mjs see|cs|type <text>");
  process.exit(2);
}

// try start scheduled task (works if registered)
spawnSync("schtasks", ["/Run", "/TN", "CSFarmHostOps"], { encoding: "utf8" });

const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  await new Promise((r) => setTimeout(r, 2000));
  if (existsSync(log)) {
    const t = readFileSync(log, "utf8");
    if (/DONE|SEE |TYPED|PING/.test(t)) {
      console.log(t.trim());
      if (existsSync(view)) console.log("VIEW", view, (await import("fs")).statSync(view).size);
      process.exit(0);
    }
  }
}
console.error("timeout waiting HostOps");
if (existsSync(log)) console.log(readFileSync(log, "utf8"));
process.exit(2);
