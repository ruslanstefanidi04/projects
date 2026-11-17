import { spawnSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { boxPids, sandboxieStart } from "./sandbox.mjs";
import { sleep } from "./pace.mjs";

function shotDir() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "sess");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cefDebugPort(box) {
  let h = 0;
  for (const c of String(box || "csfarm")) h = (Math.imul(h, 33) + c.charCodeAt(0)) >>> 0;
  return 8700 + (h % 200);
}

export function cefDebugArgs(box) {
  return ["-cef-enable-remote-debugging", "-cef-enable-debugging", `--remote-debugging-port=${cefDebugPort(box)}`];
}

async function jsonAt(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) });
  if (!r.ok) return null;
  const list = await r.json();
  return Array.isArray(list) ? list : null;
}

function listenPorts(pids) {
  if (!pids || !pids.length) return [];
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { @(${pids.join(",")}) -contains $_.OwningProcess } | Select-Object -ExpandProperty LocalPort`
    ],
    { encoding: "utf8", windowsHide: true, timeout: 8000 }
  );
  return [...new Set(String(r.stdout || "").match(/\d+/g) || [])].map(Number).filter((p) => p >= 1024 && p < 60000);
}

async function findCdp(ms = 18000, box = "") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const owned = box ? listenPorts(boxPids(box)) : [];
    const want = box ? cefDebugPort(box) : 0;
    const ports = [];
    if (want) ports.push(want);
    for (const p of owned) {
      if (!ports.includes(p)) ports.push(p);
    }
    if (!box) {
      for (let p = 8080; p <= 8099; p++) ports.push(p);
      for (let p = 9222; p <= 9235; p++) ports.push(p);
    }
    for (const port of ports) {
      try {
        const list = await jsonAt(port);
        if (list && list.length) return { port, list };
      } catch {}
    }
    await sleep(400);
  }
  return null;
}

function fillExpr(login, password, guard) {
  const u = JSON.stringify(login);
  const p = JSON.stringify(password);
  const g = JSON.stringify(guard || "");
  return `(() => {
    function setVal(el, val) {
      if (!el) return false;
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      if (desc && desc.set) desc.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      return true;
    }
    function deepInputs(root, acc) {
      if (!root) return acc;
      root.querySelectorAll("input").forEach((i) => acc.push(i));
      root.querySelectorAll("*").forEach((n) => { if (n.shadowRoot) deepInputs(n.shadowRoot, acc); });
      return acc;
    }
    const inputs = deepInputs(document, []);
    const vis = inputs.filter((i) => i.type !== "hidden" && i.type !== "checkbox");
    const text = ((document.body && document.body.innerText) || "") + " " + document.title;
    const kinds = vis.map((i) => (i.type || "text") + ":" + String(i.maxLength || "") + ":" + String(i.placeholder || i.autocomplete || "").slice(0, 24));
    const isGuard = /authenticator|steam guard|guard code|enter the code|confirmation code|email code|two-factor|two factor|mobile authenticator/i.test(text)
      || vis.filter((i) => Number(i.maxLength) === 1).length >= 4
      || (!vis.some((i) => i.type === "password") && vis.length >= 4 && vis.length <= 8);
    if (isGuard && !${g}) {
      return { skip: "guard", inputs: vis.length, kinds, url: location.href, title: document.title };
    }
    if (${g}) {
      const digits = vis.filter((i) => Number(i.maxLength) === 1);
      if (digits.length >= 4) {
        const code = String(${g}).replace(/\\s/g, "");
        digits.forEach((el, i) => { if (code[i]) setVal(el, code[i]); });
        const btn = [...document.querySelectorAll("button, input[type=submit], [role=button]")].find((b) => /submit|continue|confirm|далее|отправить|sign in/i.test((b.innerText || b.value || "") + " " + (b.className || "")));
        if (btn) btn.click();
        return { okG: true, inputs: vis.length, kinds, title: document.title };
      }
      const codeEl = vis.find((i) => /guard|auth|twofactor|code/i.test(i.name + i.id + (i.placeholder || ""))) || vis[0];
      const okG = setVal(codeEl, ${g});
      const btn = [...document.querySelectorAll("button, input[type=submit], [role=button]")].find((b) => /submit|continue|confirm|далее|отправить|sign in/i.test((b.innerText || b.value || "") + " " + (b.className || "")));
      if (btn && okG) btn.click();
      return { okG, inputs: vis.length, kinds, title: document.title };
    }
    const pass = vis.find((i) => i.type === "password") || vis.find((i) => /pass/i.test((i.name || "") + (i.id || "") + (i.placeholder || "") + (i.autocomplete || "")));
    const user = vis.find((i) => i !== pass && (i.type === "text" || i.type === "email" || /user|account|login/i.test((i.name || "") + (i.id || "") + (i.placeholder || "") + (i.autocomplete || "")))) || vis.find((i) => i !== pass && i.type !== "password");
    const remotes = [...document.querySelectorAll("input[type=checkbox]")];
    for (const rem of remotes) {
      const t = ((rem.name || "") + " " + (rem.id || "") + " " + (rem.parentElement && rem.parentElement.innerText || "")).toLowerCase();
      if (/don.?t remember|do not remember|не запомин/i.test(t)) {
        if (rem.checked) rem.click();
      } else if (/remember|keep me|запомн|this computer|this machine/i.test(t)) {
        if (!rem.checked) rem.click();
      }
    }
    const okU = ${u} && user ? setVal(user, ${u}) : false;
    const okP = ${p} && pass ? setVal(pass, ${p}) : false;
    const btn = [...document.querySelectorAll("button, input[type=submit], [role=button]")].find((b) => /sign in|sign-in|войти|submit|continue|confirm|далее|отправить/i.test((b.innerText || b.value || "") + " " + (b.className || "")));
    if (btn && (okP || (okU && !pass))) btn.click();
    return { inputs: vis.length, kinds, okU, okP, okG: false, btn: Boolean(btn), url: location.href, title: document.title };
  })()`;
}

async function cdpEval(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws timeout")), 8000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("ws error"));
    });
  });
  let n = 1;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = n++;
      const t = setTimeout(() => reject(new Error(method + " timeout")), 8000);
      const onMsg = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== id) return;
        ws.removeEventListener("message", onMsg);
        clearTimeout(t);
        if (msg.error) reject(new Error(msg.error.message || method));
        else resolve(msg.result);
      };
      ws.addEventListener("message", onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await call("Runtime.enable", {});
    const res = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
    return res?.result?.value;
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

function pickerExpr(wantNew) {
  return `(() => {
    const text = ((document.body && document.body.innerText) || "") + " " + document.title;
    const who = /who.?s playing/i.test(text);
    const plus = [...document.querySelectorAll("button, a, [role=button], div")].find((el) => {
      const s = String(el.innerText || el.textContent || "").trim();
      return s === "+" || /add (an )?account|another account|добавить/i.test(s);
    });
    if (${wantNew ? "true" : "false"}) {
      if (plus) { plus.click(); return { who, clicked: "plus" }; }
      return { who, clicked: false, title: document.title };
    }
    if (!who) return { who: false, clicked: false, title: document.title };
    const imgs = [...document.querySelectorAll("img")].filter((i) => (i.naturalWidth || i.width) > 40);
    if (imgs[0]) {
      const wrap = imgs[0].closest("button, a, [role=button]") || imgs[0];
      wrap.click();
      return { who, clicked: "avatar" };
    }
    return { who, clicked: false, title: document.title };
  })()`;
}

async function evalOnPages(expression, box) {
  const found = await findCdp(12000, box);
  if (!found) return null;
  const pages = found.list.filter((t) => t.webSocketDebuggerUrl && (t.type === "page" || t.type === "iframe" || !t.type));
  let last = null;
  for (const t of pages) {
    try {
      last = await cdpEval(t.webSocketDebuggerUrl, expression);
      console.log("cdp picker", t.title || t.url, JSON.stringify(last));
      if (last && last.clicked) return last;
    } catch (e) {
      console.log("cdp picker fail", t.title || "", String(e.message || e));
    }
  }
  return last;
}

export async function steamSkipPicker(wantNew, box) {
  try {
    return await evalOnPages(pickerExpr(Boolean(wantNew)), box);
  } catch (e) {
    console.log("picker error", String(e.message || e));
    return null;
  }
}

function scanExpr() {
  return `(() => {
    const text = ((document.body && document.body.innerText) || "").replace(/\\s+/g, " ").trim();
    const nodes = [...document.querySelectorAll("button, [role=button], a, input[type=button], input[type=submit]")];
    const names = nodes.map((b) => String(b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim()).filter(Boolean).slice(0, 24);
    const label = (b) => String(b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
    const pos = nodes.find((b) => /play anyway|play now|continue to play|i understand|i agree|^ok$|^okay$|accept|confirm|продолж|играть всё равно|всё равно/i.test(label(b)));
    if (pos) {
      pos.click();
      return { clicked: label(pos).slice(0, 48), text: text.slice(0, 220), names, cloud: /cloud out of date|not yet in the cloud|conflict/i.test(text) };
    }
    return { clicked: false, text: text.slice(0, 220), names, cloud: /cloud out of date|not yet in the cloud|conflict/i.test(text) };
  })()`;
}

async function cdpShot(wsUrl, file) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("shot timeout")), 8000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("shot ws"));
    });
  });
  let n = 1;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = n++;
      const t = setTimeout(() => reject(new Error(method + " timeout")), 8000);
      const onMsg = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== id) return;
        ws.removeEventListener("message", onMsg);
        clearTimeout(t);
        if (msg.error) reject(new Error(msg.error.message || method));
        else resolve(msg.result);
      };
      ws.addEventListener("message", onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await call("Page.enable", {});
    const res = await call("Page.captureScreenshot", { format: "png" });
    if (res && res.data) writeFileSync(file, Buffer.from(res.data, "base64"));
  } finally {
    try {
      ws.close();
    } catch {}
  }
}

function uiaPlayAnyway(box) {
  const ids = boxPids(box).join(",");
  const extra = ids ? `Get-Process -Id @(${ids}) -ErrorAction SilentlyContinue` : "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'steam' }";
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$procs = @(${extra}) | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
$clicked = @()
foreach ($p in $procs) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
  if (-not $root) { continue }
  $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $btns = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
  for ($i = 0; $i -lt $btns.Count; $i++) {
    $name = [string]$btns.Item($i).Current.Name
    if ($name -match 'Play anyway|Play Anyway|Play now|Continue') {
      try {
        $inv = $btns.Item($i).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $inv.Invoke()
        $clicked += ($p.ProcessName + ':' + $name)
      } catch {}
    }
  }
}
if ($clicked.Count) { Write-Output ($clicked -join ',') } else { Write-Output 'uia-none' }
`;
  const r = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", ps], {
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true
  });
  return String(r.stdout || "").trim();
}

function shotHwnd(box) {
  const ids = boxPids(box).join(",");
  if (!ids) return;
  const file = path.join(shotDir(), "tmp-ui.png").replace(/'/g, "''");
  const ps = `
Add-Type -AssemblyName System.Drawing
$ids = @(${ids})
$p = Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }
$hit = $p | Where-Object { $_.MainWindowTitle -like '*${box}*' } | Select-Object -First 1
if (-not $hit) { $hit = $p | Where-Object { $_.ProcessName -match 'steam' } | Select-Object -First 1 }
$p = $hit
if (-not $p) { return }
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Cap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$r = New-Object Cap+RECT
[Cap]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = [Math]::Max(8, $r.R - $r.L)
$h = [Math]::Max(8, $r.B - $r.T)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[Cap]::PrintWindow($p.MainWindowHandle, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ($p.ProcessName + ' ' + $p.MainWindowTitle + ' ' + $w + 'x' + $h)
`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    timeout: 12000,
    windowsHide: true
  });
  const out = String(r.stdout || "").trim();
  if (out) console.log("ui shot", out);
}

export async function steamDismissUi(box) {
  const expr = scanExpr();
  let r = null;
  try {
    r = await evalOnPages(expr, box);
    if (r && (r.clicked || r.cloud || (r.text && /cloud|anyway|conflict/i.test(r.text)))) {
      console.log("steam ui", JSON.stringify(r));
    } else if (r && r.clicked) {
      console.log("steam ui", JSON.stringify(r));
    }
    const found = await findCdp(1500, box);
    const page = found && found.list.find((t) => t.webSocketDebuggerUrl && (t.type === "page" || !t.type));
    if (page && r && (r.cloud || r.clicked)) {
      try {
        await cdpShot(page.webSocketDebuggerUrl, path.join(shotDir(), "tmp-ui.png"));
      } catch {}
    }
  } catch (e) {
    console.log("steam ui fail", String(e.message || e));
  }
  if (box) {
    try {
      shotHwnd(box);
    } catch {}
    const uia = uiaPlayAnyway(box);
    if (uia && uia !== "uia-none") console.log("steam uia", uia);
  }
  return r;
}

async function fillViaCdp(acc) {
  const found = await findCdp(20000, acc.box);
  if (!found) {
    console.log("cdp none");
    return null;
  }
  console.log("cdp port", found.port, "box", acc.box || "-", "targets", found.list.length);
  const pages = found.list.filter((t) => t.webSocketDebuggerUrl && (t.type === "page" || t.type === "iframe" || !t.type));
  const expr = fillExpr(acc.login, acc.password, acc.guard);
  let last = null;
  for (const t of pages) {
    try {
      last = await cdpEval(t.webSocketDebuggerUrl, expr);
      console.log("cdp page", t.title || t.url, JSON.stringify(last));
      if (last && last.okU && last.okP) return last;
    } catch (e) {
      console.log("cdp fail", t.title || "", String(e.message || e));
    }
  }
  return last;
}

function fillViaUia(acc) {
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$box = $env:CSF_BOX
$ids = @()
if ($env:CSF_PIDS) { $ids = $env:CSF_PIDS.Split(',') | Where-Object { $_ } }
$cands = @()
if ($ids.Count) { $cands = Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } }
else { $cands = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.ProcessName -match 'steam' } }
$hit = $null
if ($box) { $hit = $cands | Where-Object { $_.MainWindowTitle -like ('*' + $box + '*') } | Select-Object -First 1 }
if (-not $hit) { $hit = $cands | Where-Object { $_.ProcessName -match 'steam' } | Select-Object -First 1 }
if (-not $hit) { Write-Output "no-window"; exit 2 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hit.MainWindowHandle)
if (-not $root) { Write-Output "no-uia-root"; exit 3 }
$editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
Write-Output ("edits-" + $edits.Count)
function Set-UiaValue($el, $text) {
  if (-not $el) { return $false }
  try {
    $p = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $p.SetValue($text)
    return $true
  } catch { return $false }
}
$okU = $false
$okP = $false
if ($edits.Count -ge 1) { $okU = Set-UiaValue $edits.Item(0) $env:CSF_U }
if ($edits.Count -ge 2) { $okP = Set-UiaValue $edits.Item(1) $env:CSF_P }
Write-Output ("set-user-" + $okU)
Write-Output ("set-pass-" + $okP)
$btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$btns = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
$clicked = $false
for ($i = 0; $i -lt $btns.Count; $i++) {
  $name = $btns.Item($i).Current.Name
  if ($name -match 'Sign in|Sign In|Войти') {
    try {
      $inv = $btns.Item($i).GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $inv.Invoke()
      $clicked = $true
      Write-Output ("invoke-" + $name)
      break
    } catch {}
  }
}
Write-Output ("clicked-" + $clicked)
if ($okU -and $okP) { exit 0 } else { exit 4 }
`;
  const r = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", ps], {
    encoding: "utf8",
    timeout: 25000,
    windowsHide: true,
    env: {
      ...process.env,
      CSF_U: String(acc.login || ""),
      CSF_P: String(acc.password || ""),
      CSF_BOX: acc.box || "",
      CSF_PIDS: boxPids(acc.box).join(",")
    }
  });
  return String(r.stdout || "").trim() || "status " + r.status;
}

function boxTitles(box) {
  const ids = boxPids(box).join(",");
  if (!ids) return [];
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName + '|' + $_.MainWindowTitle }`
    ],
    { encoding: "utf8", windowsHide: true, timeout: 8000 }
  );
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function steamLooksHung(box) {
  return /not responding/i.test(boxTitles(box).join("\n"));
}

export async function steamClientReady(ms = 180000, acc = null) {
  const t0 = Date.now();
  let lastFill = 0;
  while (Date.now() - t0 < ms) {
    try {
      const titles = acc && acc.box ? boxTitles(acc.box) : [];
      const blob = titles.join("\n").toLowerCase();
      if (titles.length) console.log("box windows", titles.filter((t) => t.includes("|") && t.split("|")[1]).join(" || ") || titles.join(" || "));
      const sign = /sign in to steam/.test(blob);
      const lib = titles.some((t) => {
        const name = t.split("|")[1] || "";
        return /^#?.*steam$/i.test(name.trim()) || /library/i.test(name);
      });
      if (!sign && lib) {
        console.log("steam ready windows");
        return true;
      }
      const found = await findCdp(1200, acc && acc.box);
      if (found && found.list && found.list.length) {
        const titles = found.list.map((p) => String(p.title || "").toLowerCase());
        const blob = found.list.map((p) => `${p.title || ""} ${p.url || ""}`).join("\n").toLowerCase();
        const sign = blob.includes("sign in to steam") || blob.includes("login.steampowered");
        const guard = /guard|steamcommunity\.com\/login|twofactor|emailauth|authcode/i.test(blob);
        const lib = titles.some((t) => t === "steam" || t.includes("library")) || blob.includes("dynamicstore") || blob.includes("clientui");
        if (guard) {
          console.log("wait steam guard in boxed window", found.list.map((p) => p.title || "no-title").join("|"));
        } else if (!sign && lib) {
          console.log("steam ready", found.list.map((p) => p.title || p.url).join(" | "));
          return true;
        }
        if (!sign && !guard && blob.includes("steamloopback.host") && !blob.includes("index.html?")) {
          console.log("steam ready-ish", found.list.map((p) => p.title || "").join(" | "));
          return true;
        }
        console.log("steam wait", guard ? "guard" : sign ? "login" : "loading", found.list.map((p) => p.title || "no-title").join("|"));
        if (acc && sign && Date.now() - lastFill > 18000) {
          lastFill = Date.now();
          try {
            const r = await fillViaCdp(acc);
            if (r && r.skip === "guard") {
              console.log("wait steam guard in boxed window, do not overwrite");
              lastFill = Date.now() + 10 * 60 * 1000;
            }
          } catch {}
        }
      }
    } catch {}
    await sleep(2500);
  }
  console.log("steam ready timeout");
  return false;
}

export async function steamUiLogin(acc) {
  const start = sandboxieStart();
  let pids = [];
  for (let i = 0; i < 20 && !pids.length; i++) {
    await sleep(500);
    pids = boxPids(acc.box);
  }
  console.log("box pids", acc.box, pids.join(",") || "none");
  await steamSkipPicker(!acc.reuseSession, acc.box);
  await sleep(1500);
  let cdp = null;
  try {
    cdp = await fillViaCdp(acc);
  } catch (e) {
    console.log("cdp error", String(e.message || e));
  }
  if (cdp && cdp.skip === "guard") {
    console.log("ui-login already on guard, wait boxed window");
    return true;
  }
  if (cdp && cdp.okU && !cdp.okP) {
    await sleep(2000);
    try {
      cdp = await fillViaCdp(acc);
    } catch {}
  }
  if (cdp && cdp.okU && cdp.okP) {
    console.log("ui-login cdp-ok", start ? "sbie" : "no-sbie");
    if (acc.guard) {
      await sleep(4000);
      try {
        await fillViaCdp({ ...acc });
      } catch {}
    }
    return true;
  }
  console.log("ui-login cdp miss, no host uia");
  return false;
}

export async function steamUiGuard(acc, code) {
  const digits = String(code || "").replace(/\s/g, "");
  if (!digits) return false;
  console.log("guard fill", acc.login, "len", digits.length);
  try {
    const cdp = await fillViaCdp({ login: "", password: "", guard: digits, box: acc.box });
    console.log("ui-guard", cdp ? JSON.stringify(cdp) : "none");
    return Boolean(cdp && cdp.okG);
  } catch (e) {
    console.log("ui-guard error", String(e.message || e));
    return false;
  }
}
