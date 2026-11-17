# Screen vision: mss/PrintWindow + OpenCV -> HV click. Never opens RDP.
"""
deps: pip install -r requirements.txt
run:  python see_click.py --once
      python see_click.py --loop
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import mss
import numpy as np
import requests

HV = "http://127.0.0.1:39201"
ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
OUT = Path("D:/FarmVMs/ops/vision")


def list_candidate_windows():
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found = {}

    def add_hwnd(hwnd, title_hint=""):
        if not hwnd or user32.IsIconic(hwnd):
            return
        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        if w < 400 or h < 300 or rect.left < -5000:
            return
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        if n > 0:
            user32.GetWindowTextW(hwnd, buf, n + 1)
        title = buf.value or title_hint
        low = title.lower()
        keys = ("remote desktop", "10.250", "csfarm", "virtual machine connection")
        if title_hint != "vmconnect" and not any(k in low for k in keys):
            return
        found[int(hwnd)] = {
            "hwnd": int(hwnd),
            "title": title,
            "left": rect.left,
            "top": rect.top,
            "w": w,
            "h": h,
        }

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _lp):
        n = user32.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        t = buf.value
        low = t.lower()
        if any(k in low for k in ("remote desktop", "10.250", "csfarm", "virtual machine connection")):
            add_hwnd(hwnd, t)
        return True

    user32.EnumWindows(cb, 0)
    try:
        ps = (
            "Get-Process vmconnect -EA SilentlyContinue | "
            "Where-Object { $_.MainWindowHandle -ne 0 } | "
            "ForEach-Object { $_.MainWindowHandle }"
        )
        out = subprocess.check_output(["powershell", "-NoProfile", "-Command", ps], text=True, timeout=5)
        for line in out.splitlines():
            line = line.strip()
            if line.isdigit():
                add_hwnd(int(line), "vmconnect")
    except Exception:
        pass
    return list(found.values())


def grab_window(win: dict) -> np.ndarray:
    """PrintWindow by HWND so we never grab Cursor/Telegram by accident."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    hwnd = int(win["hwnd"])

    crect = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(crect))
    cw = max(64, crect.right - crect.left)
    ch = max(64, crect.bottom - crect.top)

    hwnd_dc = user32.GetDC(hwnd)
    mem_dc = gdi32.CreateCompatibleDC(hwnd_dc)
    bmp = gdi32.CreateCompatibleBitmap(hwnd_dc, cw, ch)
    old = gdi32.SelectObject(mem_dc, bmp)
    ok = user32.PrintWindow(hwnd, mem_dc, 2) or user32.PrintWindow(hwnd, mem_dc, 0)

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD),
            ("biWidth", wintypes.LONG),
            ("biHeight", wintypes.LONG),
            ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD),
            ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD),
            ("biXPelsPerMeter", wintypes.LONG),
            ("biYPelsPerMeter", wintypes.LONG),
            ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    class BITMAPINFO(ctypes.Structure):
        _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]

    bmi = BITMAPINFO()
    bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = cw
    bmi.bmiHeader.biHeight = -ch
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = 0
    buf = (ctypes.c_ubyte * (cw * ch * 4))()
    gdi32.GetDIBits(mem_dc, bmp, 0, ch, buf, ctypes.byref(bmi), 0)
    gdi32.SelectObject(mem_dc, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(hwnd, hwnd_dc)

    arr = np.frombuffer(buf, dtype=np.uint8).reshape((ch, cw, 4))
    bgr = arr[:, :, :3].copy()
    mean = float(np.mean(bgr))
    if ok and mean > 2.0:
        return bgr

    # fallback: on-screen mss only for non-minimized windows
    inset_y = 32 if "remote desktop" in win["title"].lower() else 8
    inset_x = 8
    left = win["left"] + inset_x
    top = win["top"] + inset_y
    width = max(64, win["w"] - 2 * inset_x)
    height = max(64, win["h"] - inset_y - 8)
    with mss.MSS() as sct:
        shot = sct.grab({"left": left, "top": top, "width": width, "height": height})
        return np.array(shot)[:, :, :3]


def match_template(screen: np.ndarray, templ: np.ndarray, threshold: float = 0.82):
    if templ is None or templ.size == 0:
        return None
    sh, sw = screen.shape[:2]
    th, tw = templ.shape[:2]
    if th >= sh or tw >= sw:
        return None
    res = cv2.matchTemplate(screen, templ, cv2.TM_CCOEFF_NORMED)
    _min_v, max_v, _min_l, max_l = cv2.minMaxLoc(res)
    if max_v < threshold:
        return None
    x, y = max_l
    cx = x + tw / 2
    cy = y + th / 2
    return {
        "confidence": float(max_v),
        "x_pct": round(100.0 * cx / sw, 2),
        "y_pct": round(100.0 * cy / sh, 2),
        "px": int(cx),
        "py": int(cy),
        "w": tw,
        "h": th,
    }


def find_green_buttons(screen: np.ndarray, max_spots: int = 8):
    b, g, r = cv2.split(screen)
    mask = (g > 130) & (g > r + 30) & (g > b + 30) & (r < 130)
    mask_u8 = mask.astype(np.uint8) * 255
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, _labels, stats, cents = cv2.connectedComponentsWithStats(mask_u8, 8)
    sh, sw = screen.shape[:2]
    spots = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 80 or w < 18 or h < 8:
            continue
        aspect = w / max(1, h)
        cx, cy = cents[i]
        xp = 100.0 * cx / sw
        yp = 100.0 * cy / sh
        score = float(area)
        if aspect >= 1.8:
            score *= 2.2
        if aspect < 1.2 and h > 80:
            score *= 0.15
        if xp <= 40 and 28 <= yp <= 58 and aspect >= 1.6:
            score *= 1.8
        if xp >= 75 and yp >= 78 and aspect >= 1.6:
            score *= 1.6
        if yp < 12:
            score *= 0.2
        spots.append(
            {
                "x_pct": round(xp, 2),
                "y_pct": round(yp, 2),
                "score": round(score, 1),
                "w": int(w),
                "h": int(h),
                "aspect": round(aspect, 2),
            }
        )
    spots.sort(key=lambda s: s["score"], reverse=True)
    return spots[:max_spots]


def hv_click(x_pct: float, y_pct: float) -> bool:
    try:
        r = requests.post(f"{HV}/click", json={"x": x_pct, "y": y_pct}, timeout=20)
        return r.ok and r.json().get("ok", False)
    except Exception as e:
        print("hv click fail", e)
        return False


def hv_ping() -> bool:
    try:
        return requests.get(f"{HV}/ping", timeout=3).json().get("ok", False)
    except Exception:
        return False


def run_once(click: bool = True) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    wins = list_candidate_windows()
    if not wins:
        return {
            "ok": False,
            "error": "no visible RDP/vmconnect window (un-minimize vmconnect yourself; agent will not open RDP)",
        }
    win = sorted(wins, key=lambda w: w["w"] * w["h"], reverse=True)[0]
    screen = grab_window(win)
    cv2.imwrite(str(OUT / "shot.png"), screen)

    hits = []
    if ASSETS.exists():
        for p in sorted(ASSETS.glob("*.png")):
            templ = cv2.imread(str(p), cv2.IMREAD_COLOR)
            m = match_template(screen, templ)
            if m:
                m["name"] = p.stem
                hits.append(m)

    greens = find_green_buttons(screen)
    result = {
        "ok": True,
        "window": win["title"],
        "size": {"w": int(screen.shape[1]), "h": int(screen.shape[0])},
        "mean": round(float(np.mean(screen)), 2),
        "templates": hits,
        "greens": greens,
        "hv": hv_ping(),
    }
    (OUT / "shot.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    target = None
    if hits:
        best = max(hits, key=lambda h: h["confidence"])
        target = {
            "x": best["x_pct"],
            "y": best["y_pct"],
            "via": "template:" + best["name"],
            "conf": best["confidence"],
        }
    elif greens:
        g0 = greens[0]
        target = {"x": g0["x_pct"], "y": g0["y_pct"], "via": "green", "score": g0["score"]}

    if target and click and result["hv"]:
        ok = hv_click(target["x"], target["y"])
        target["clicked"] = ok
        print("click", target)
    elif target:
        print("target", target, "(no click)")
    else:
        print("no target mean=", result["mean"])

    result["target"] = target
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--no-click", action="store_true")
    ap.add_argument("--interval", type=float, default=2.5)
    args = ap.parse_args()
    click = not args.no_click
    if args.loop:
        while True:
            r = run_once(click=click)
            print(json.dumps({k: r.get(k) for k in ("ok", "error", "target", "hv", "mean")}, ensure_ascii=True))
            time.sleep(args.interval)
    else:
        r = run_once(click=click)
        print(json.dumps(r, ensure_ascii=True, indent=2))
        sys.exit(0 if r.get("ok") else 1)


if __name__ == "__main__":
    main()
