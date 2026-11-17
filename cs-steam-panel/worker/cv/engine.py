# cv engine: pixels -> structured JSON only. decision engine must not parse pixels.
"""
usage:
  python engine.py --image D:/FarmVMs/ops/vision/live.png --out D:/FarmVMs/ops/vision/frame.json
  python engine.py --loop --image ... --out ... --interval 0.4
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from yolo_infer import detect_bgr

_GLASS_KEY = None


def pct(x: float, y: float, w: int, h: int) -> dict:
    return {
        "x": round(100.0 * x / max(1, w), 2),
        "y": round(100.0 * y / max(1, h), 2),
        "px": int(x),
        "py": int(y),
    }


def match_template(img: np.ndarray, templ: np.ndarray, threshold: float = 0.78):
    if templ is None or templ.size == 0 or img is None:
        return None
    ih, iw = img.shape[:2]
    th, tw = templ.shape[:2]
    if th >= ih or tw >= iw:
        return None
    res = cv2.matchTemplate(img, templ, cv2.TM_CCOEFF_NORMED)
    _mn, mx, _ml, max_loc = cv2.minMaxLoc(res)
    if mx < threshold:
        return None
    cx = max_loc[0] + tw / 2
    cy = max_loc[1] + th / 2
    return {"confidence": float(mx), **pct(cx, cy, iw, ih), "w": tw, "h": th}


def find_greens(img: np.ndarray, max_n: int = 10):
    b, g, r = cv2.split(img)
    mask = (g > 130) & (g > r + 30) & (g > b + 30) & (r < 140)
    u8 = mask.astype(np.uint8) * 255
    u8 = cv2.morphologyEx(u8, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, _lab, stats, cents = cv2.connectedComponentsWithStats(u8, 8)
    h, w = img.shape[:2]
    out = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < 120 or bw < 20 or bh < 10:
            continue
        cx, cy = cents[i]
        xp, yp = 100.0 * cx / w, 100.0 * cy / h
        aspect = bw / max(1, bh)
        score = float(area)
        # downrank left promo strip / store buy column
        if xp <= 18:
            score *= 0.12
        if yp < 10:
            score *= 0.35
        if aspect >= 1.6:
            score *= 1.8
        if 18 < xp <= 45 and 28 <= yp <= 62 and aspect >= 1.4:
            score *= 2.0  # training-day-ish tile
        if xp >= 70 and yp >= 78 and aspect >= 1.5:
            score *= 1.7  # bottom-right GO
        kind = "green_cta"
        if xp <= 18:
            kind = "promo_green"
        elif xp < 35 and 30 <= yp <= 50 and aspect >= 2.0:
            kind = "buy_button"
        elif xp >= 70 and yp >= 78:
            kind = "go_button"
        elif 18 < xp <= 45 and 28 <= yp <= 62:
            kind = "mode_go"
        out.append(
            {
                "type": kind,
                "confidence": min(0.99, 0.55 + score / 50000.0),
                "score": round(score, 1),
                "aspect": round(aspect, 2),
                **pct(cx, cy, w, h),
                "w": int(bw),
                "h": int(bh),
            }
        )
    out.sort(key=lambda o: o["score"], reverse=True)
    return out[:max_n]


def classify_screen(img: np.ndarray, objects: list) -> tuple[str, float]:
    h, w = img.shape[:2]
    mean = float(np.mean(img))
    std = float(np.std(img))
    if mean < 8:
        return "BLACK", 0.95
    if mean < 25 and std < 20:
        return "LOADING", 0.8

    nav = [o for o in objects if str(o.get("type", "")).startswith("nav_") and o.get("confidence", 0) >= 0.8]
    promo = any(o["type"] == "promo_green" for o in objects)
    buy = any(o["type"] == "buy_button" for o in objects)
    mode = any(o["type"] in ("mode_go", "go_button") for o in objects)

    # in-game: no main-menu nav chrome, lively frame
    top = img[0 : int(h * 0.1), int(w * 0.3) : int(w * 0.7)]
    top_std = float(np.std(top))
    if not nav and not promo and mean > 60 and (top_std > 40 or std > 40):
        return "IN_GAME", 0.9

    if promo and mean > 80:
        return "MAIN_MENU", 0.92

    if buy:
        return "STORE", 0.92
    if mode:
        return "PLAY_MENU", 0.9

    body = img[int(h * 0.1) : int(h * 0.92), int(w * 0.05) : int(w * 0.95)]
    edges = cv2.Canny(cv2.cvtColor(body, cv2.COLOR_BGR2GRAY), 40, 120)
    edge_density = float(np.mean(edges > 0))

    if edge_density >= 0.08 and 55 <= mean <= 110 and not promo and nav:
        return "INVENTORY", 0.78

    if mean > 100 and edge_density < 0.08 and nav:
        return "MAIN_MENU", 0.8

    if nav:
        # which nav tab is brightest
        tab_band = img[int(h * 0.06) : int(h * 0.09), :]
        tab_names = [
            ("INVENTORY", 0.12, 0.22),
            ("LOADOUT", 0.22, 0.32),
            ("PLAY_MENU", 0.32, 0.42),
            ("STORE", 0.42, 0.52),
        ]
        best_tab, best_score = "MAIN_MENU", -1.0
        for name, x0, x1 in tab_names:
            strip = tab_band[:, int(w * x0) : int(w * x1)]
            if strip.size == 0:
                continue
            b, g, r = cv2.split(strip)
            score = float(np.mean((b > 130) & (b > r + 15))) * 100 + float(np.mean(strip)) * 0.2
            if score > best_score:
                best_score = score
                best_tab = name
        if best_tab == "PLAY_MENU" and mean > 100:
            return "MAIN_MENU", 0.75
        return best_tab, 0.7

    # ambiguous: do not force IN_GAME. confirm layer + gsi decide
    return "UNKNOWN", 0.4


def detect_spec_hud(img: np.ndarray) -> str:
    """dead/spec from hud chrome: dark footer with many white glyphs (name, switch, you died)."""
    h, w = img.shape[:2]
    bot = img[int(h * 0.80) : int(h * 0.99), int(w * 0.22) : int(w * 0.78)]
    mid = img[int(h * 0.36) : int(h * 0.58), int(w * 0.22) : int(w * 0.78)]
    if bot.size == 0:
        return ""
    def glyph_n(bgr):
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        dark = float(np.mean(gray < 48))
        _, th = cv2.threshold(gray, 188, 255, cv2.THRESH_BINARY)
        n, _, stats, _ = cv2.connectedComponentsWithStats(th, 8)
        letters = 0
        for i in range(1, n):
            bw = int(stats[i, cv2.CC_STAT_WIDTH])
            bh = int(stats[i, cv2.CC_STAT_HEIGHT])
            area = int(stats[i, cv2.CC_STAT_AREA])
            if 2 <= bw <= 34 and 8 <= bh <= 44 and 12 <= area <= 720:
                letters += 1
        return dark, letters
    d_bot, n_bot = glyph_n(bot)
    d_mid, n_mid = glyph_n(mid) if mid.size else (0.0, 0)
    if d_mid > 0.25 and n_mid >= 12:
        return "DEAD"
    if d_bot > 0.4 and n_bot >= 18:
        return "SPECTATE"
    return ""


def _guest_view(img: np.ndarray) -> tuple[np.ndarray, int]:
    # guest-shot is the cs2 client. radar sits top-left of that frame.
    return img, 0


def _hud_side(guest: np.ndarray) -> int:
    h, w = guest.shape[:2]
    side = int(min(w, h) * 0.32)
    return max(140, min(side, 520, w, h))


def _gold_ring_circle(roi: np.ndarray):
    """cs2 minimap has a yellow ring. fit that, not the street below T start."""
    b, g, r = cv2.split(roi)
    gold = (
        (r.astype(np.int16) > 125)
        & (g.astype(np.int16) > 90)
        & (r > b + 12)
        & (g > b)
    ).astype(np.uint8)
    gold = cv2.morphologyEx(gold, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    ys, xs = np.where(gold > 0)
    if len(xs) < 50:
        return None
    pts = np.column_stack([xs.astype(np.float32), ys.astype(np.float32)])
    (cx, cy), rad = cv2.minEnclosingCircle(pts)
    rh, rw = roi.shape[:2]
    if rad < min(rw, rh) * 0.2 or rad > min(rw, rh) * 0.55:
        return None
    if cx > rw * 0.7 or cy > rh * 0.7:
        return None
    return float(cx), float(cy), float(rad)


def _hough_circle(roi: np.ndarray):
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.medianBlur(gray, 5)
    rh, rw = roi.shape[:2]
    min_r = max(28, int(min(rw, rh) * 0.2))
    max_r = int(min(rw, rh) * 0.5)
    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=float(min(rw, rh)),
        param1=90,
        param2=20,
        minRadius=min_r,
        maxRadius=max_r,
    )
    if circles is None:
        return None
    best = None
    best_s = -1.0
    for x, y, r in circles[0]:
        if x > rw * 0.7 or y > rh * 0.7:
            continue
        if r < min_r or r > max_r:
            continue
        score = float(r) - abs(float(x) - float(r)) * 0.15 - abs(float(y) - float(r)) * 0.15
        if score > best_s:
            best_s = score
            best = (float(x), float(y), float(r))
    return best


def _clip_disc(crop: np.ndarray) -> np.ndarray:
    # analysis must not see fence / t-start / boots outside the minimap circle
    if crop is None or crop.size == 0:
        return crop
    rh, rw = crop.shape[:2]
    yy, xx = np.ogrid[:rh, :rw]
    cx, cy = rw / 2.0, rh / 2.0
    rad = min(cx, cy) * 0.98
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= rad ** 2
    out = crop.copy()
    out[~inside] = 0
    return out


def _radar_crop(img: np.ndarray) -> tuple[np.ndarray, int, int, dict]:
    guest, offy = _guest_view(img)
    side = _hud_side(guest)
    roi = guest[:side, :side]
    hit = _gold_ring_circle(roi) or _hough_circle(roi)
    if hit:
        cx, cy, rad = hit
        # gold ring is the hud bezel; keep the inner map only
        r = rad * 0.98 + 1.0
        x0 = max(0, int(cx - r))
        y0 = max(0, int(cy - r))
        x1 = min(guest.shape[1], int(cx + r) + 1)
        y1 = min(guest.shape[0], int(cy + r) + 1)
        crop = _clip_disc(guest[y0:y1, x0:x1])
        meta = {"cx": int(round(cx)), "cy": int(round(offy + cy)), "r": int(round(rad))}
        return crop, x0, offy + y0, meta
    side = max(80, min(160, int(min(guest.shape[0], guest.shape[1]) * 0.15)))
    crop = _clip_disc(guest[2 : 2 + side, 2 : 2 + side])
    return crop, 2, offy + 2, {"cx": 2 + side // 2, "cy": offy + 2 + side // 2, "r": side // 2}


def _dump_radar_crop(radar: np.ndarray, ox: int, oy: int, extra: dict | None = None) -> dict:
    rh = int(radar.shape[0]) if radar is not None and radar.size else 0
    rw = int(radar.shape[1]) if radar is not None and radar.size else 0
    crop = {"ox": int(ox), "oy": int(oy), "w": rw, "h": rh, **(extra or {})}
    try:
        out_dir = Path(r"D:/FarmVMs/ops/vision")
        out_dir.mkdir(parents=True, exist_ok=True)
        if radar is not None and radar.size:
            cv2.imwrite(str(out_dir / "radar-crop.png"), radar)
        (out_dir / "radar-crop.json").write_text(json.dumps(crop), encoding="utf8")
    except Exception:
        pass
    return crop


def analyze_radar(img: np.ndarray) -> dict:
    """CS2 radar: blue = self, white triangle tip = facing, red = enemies, sectors for nav."""
    global _last_self
    radar, ox, oy, extra = _radar_crop(img)
    crop = _dump_radar_crop(radar, ox, oy, extra)
    if radar.size == 0:
        return {"ok": False, "crop": crop}
    rh, rw = radar.shape[:2]
    if rh < 40 or rw < 40:
        return {"ok": False, "reason": "tiny", "crop": crop}
    yy, xx = np.ogrid[:rh, :rw]
    disc = (xx - rw / 2.0) ** 2 + (yy - rh / 2.0) ** 2 <= (min(rw, rh) * 0.49) ** 2
    pix = radar[disc] if disc.any() else radar.reshape(-1, 3)
    mean_c = float(np.mean(pix))
    b_mean = float(np.mean(pix[:, 0]))
    g_mean = float(np.mean(pix[:, 1]))
    r_mean = float(np.mean(pix[:, 2]))
    # open console / vmconnect chrome is not a minimap
    if mean_c < 10 or (g_mean > r_mean + 22 and g_mean > b_mean + 12 and mean_c < 70):
        return {"ok": False, "reason": "not-radar", "crop": crop}
    _b, g, r = cv2.split(radar)

    # --- self: small bright cyan pip + white triangle, not the teal map fill ---
    hsv = cv2.cvtColor(radar, cv2.COLOR_BGR2HSV)
    hh, ss, vv = cv2.split(hsv)
    pip = disc & (vv >= 145) & (ss >= 45) & (hh >= 75) & (hh <= 112)
    pip = pip & (_b.astype(np.int16) > r.astype(np.int16) + 4)
    hint = radar_self_hint()
    if hint and hint.get("reset"):
        _last_self = None
        hint = None
    if hint:
        loose = disc & (hh >= 72) & (hh <= 115) & (ss >= 35) & (vv >= 70)
        pip = pip | loose
    blue = pip
    blue_u8 = (blue.astype(np.uint8) * 255)
    n, _lab, stats, cents = cv2.connectedComponentsWithStats(blue_u8, 8)
    hx = hy = None
    if hint and "nx" in hint:
        hx = float(hint["nx"]) * rw
        hy = float(hint["ny"]) * rh
    white_pip = (r > 200) & (g > 195) & (_b > 170) & (r.astype(np.int16) - _b.astype(np.int16) < 40)
    self_cx, self_cy = None, None
    self_area = 0
    self_src = "blue"
    best_blue = -1e18
    now = time.time()
    held = _last_self
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        if area < 3:
            continue
        if hx is None and area > 90:
            continue
        if area > 400:
            continue
        ex, ey = float(cents[i][0]), float(cents[i][1])
        ix, iy = min(rw - 1, max(0, int(ex))), min(rh - 1, max(0, int(ey)))
        if not disc[iy, ix]:
            continue
        compact = float(area) / float(max(1, bw * bh))
        v_here = float(vv[iy, ix])
        x0, x1 = max(0, ix - 16), min(rw, ix + 17)
        y0, y1 = max(0, iy - 16), min(rh, iy + 17)
        ys, xs = np.where(white_pip[y0:y1, x0:x1])
        if len(xs):
            d2 = (xs.astype(np.float32) + x0 - ex) ** 2 + (ys.astype(np.float32) + y0 - ey) ** 2
            white_n = int(np.count_nonzero((d2 >= 6.25) & (d2 <= 256.0)))
        else:
            white_n = 0
        if hx is not None:
            score = -((ex - hx) ** 2 + (ey - hy) ** 2) + 0.04 * float(area)
        else:
            score = compact * 90.0 + v_here * 0.35 + white_n * 8.0 - abs(area - 16) * 0.9
            if held and now - held[3] < 1.2:
                score -= 0.02 * ((ex - held[0]) ** 2 + (ey - held[1]) ** 2)
        if score > best_blue:
            best_blue = score
            self_cx, self_cy, self_area = ex, ey, area
            self_src = "hint-follow" if hint else "blue"
    if hint and hx is not None:
        max_d = 0.11 * float(min(rw, rh))
        if self_cx is None or ((self_cx - hx) ** 2 + (self_cy - hy) ** 2) ** 0.5 > max_d:
            self_cx, self_cy, self_area = hx, hy, max(self_area, 8)
            self_src = "hint"
        self_held = False
        _last_self = (self_cx, self_cy, self_area, now)
    else:
        self_held = False
        if self_cx is None and held and now - held[3] < 0.6:
            self_cx, self_cy, self_area = held[0], held[1], held[2]
            self_held = True
            self_src = "hold"
        if self_cx is not None and not self_held:
            _last_self = (self_cx, self_cy, self_area, now)

    if self_cx is None:
        wu = (white_pip.astype(np.uint8) * 255)
        n, _lab, stats, cents = cv2.connectedComponentsWithStats(wu, 8)
        best_w = -1e18
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            bw = int(stats[i, cv2.CC_STAT_WIDTH])
            bh = int(stats[i, cv2.CC_STAT_HEIGHT])
            if area < 6 or area > 55:
                continue
            if max(bw, bh) > 16 or min(bw, bh) < 3:
                continue
            ex, ey = float(cents[i][0]), float(cents[i][1])
            ix, iy = min(rw - 1, max(0, int(ex))), min(rh - 1, max(0, int(ey)))
            if not disc[iy, ix]:
                continue
            compact = float(area) / float(max(1, bw * bh))
            if compact < 0.38:
                continue
            score = compact * 100.0 + float(vv[iy, ix]) * 0.2 - abs(area - 18) * 1.2
            if held and now - held[3] < 1.2:
                score -= 0.03 * ((ex - held[0]) ** 2 + (ey - held[1]) ** 2)
            if score > best_w:
                best_w = score
                self_cx, self_cy, self_area = ex, ey, area
                self_src = "white"
        if self_cx is not None:
            _last_self = (self_cx, self_cy, self_area, now)

    if self_cx is not None and held and (now - held[3]) < 2.5:
        jump = float(np.hypot(self_cx - held[0], self_cy - held[1]) / max(1.0, float(min(rw, rh))))
        if jump > 0.035:
            self_cx, self_cy, self_area = held[0], held[1], held[2]
            self_src = "hold-jump"
        _last_self = (self_cx, self_cy, self_area, now)

    # --- facing: white triangle tip near blue (not map letters A/B) ---
    facing = 0.0
    facing_ok = False
    enemies = []
    allies = []
    if self_cx is not None:
        white = (r > 200) & (g > 195) & (_b > 170) & (r.astype(np.int16) - _b.astype(np.int16) < 40)
        white = white & ~blue
        yy, xx = np.ogrid[:rh, :rw]
        dist2 = (xx - self_cx) ** 2 + (yy - self_cy) ** 2
        tip_ring = (dist2 >= 3.0**2) & (dist2 <= 22.0**2)
        tip_ys, tip_xs = np.where(white & tip_ring)
        if len(tip_xs) >= 2:
            d = dist2[tip_ys, tip_xs]
            i = int(np.argmax(d))
            facing = float(np.degrees(np.arctan2(float(tip_xs[i]) - self_cx, self_cy - float(tip_ys[i]))))
            facing_ok = True
        else:
            tip2 = ((r > 185) & (g > 185) & (_b > 140) & ~blue) & tip_ring
            ys, xs = np.where(tip2)
            if len(xs) >= 3:
                d = dist2[ys, xs]
                i = int(np.argmax(d))
                facing = float(np.degrees(np.arctan2(float(xs[i]) - self_cx, self_cy - float(ys[i]))))
                facing_ok = True

        red = (r > 170) & (g < 110) & (_b < 110) & (r > g + 55) & (r > _b + 55) & ~blue
        mask = cv2.morphologyEx((red.astype(np.uint8) * 255), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        n, _lab, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < 5 or area > 90:
                continue
            ex, ey = float(cents[i][0]), float(cents[i][1])
            dist = float(np.hypot(ex - self_cx, ey - self_cy) / max(1.0, float(min(rw, rh) * 0.45)))
            if dist < 0.14:
                continue
            ang = float(np.degrees(np.arctan2(ex - self_cx, self_cy - ey)))
            rel = (ang - facing + 180) % 360 - 180
            enemies.append({"ang": round(ang, 1), "rel": round(rel, 1), "dist": round(dist, 3), "area": area, "src": "radar_red"})
        enemies.sort(key=lambda e: e["dist"])

        yellow = (r > 155) & (g > 135) & (_b < 125) & (g > _b + 25) & (r > _b + 35) & ~blue
        yellow = yellow & ~((r > 170) & (g < 110) & (_b < 110))
        ymask = cv2.morphologyEx((yellow.astype(np.uint8) * 255), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        n, _lab, stats, cents = cv2.connectedComponentsWithStats(ymask, 8)
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < 5 or area > 90:
                continue
            ex, ey = float(cents[i][0]), float(cents[i][1])
            dist = float(np.hypot(ex - self_cx, ey - self_cy) / max(1.0, float(min(rw, rh) * 0.45)))
            if dist < 0.12:
                continue
            ang = float(np.degrees(np.arctan2(ex - self_cx, self_cy - ey)))
            rel = (ang - facing + 180) % 360 - 180
            allies.append({"ang": round(ang, 1), "rel": round(rel, 1), "dist": round(dist, 3), "area": area, "src": "radar_ally"})

    # walls = dark buildings on the disc. slider wall_max = how light still counts as wall.
    tune = radar_tune()
    wall_cut = float(np.clip(_num(tune.get("wall_max"), 92), 28.0, 160.0))
    fill_pct = float(np.clip(_num(tune.get("wall_fill"), 38), 8.0, 90.0))
    occ_n = int(np.clip(int(_num(tune.get("occ_n"), 48)), 16, 96))
    gray = (r.astype(np.float32) + g.astype(np.float32) + _b.astype(np.float32)) / 3.0
    wall_px = disc & (gray <= wall_cut) & ~blue
    walk_px = disc & (gray > wall_cut) & (gray < 210) & ~blue
    walk_px = walk_px & ~wall_px
    walk_u8 = (walk_px.astype(np.uint8) * 255)
    wall_u8 = (wall_px.astype(np.uint8) * 255)
    frac = cv2.resize(wall_u8, (occ_n, occ_n), interpolation=cv2.INTER_AREA)
    occ64 = np.where(frac >= (fill_pct / 100.0) * 255.0, 255, 0).astype(np.uint8)

    # free-ray length in each direction (how far you can walk before wall)
    def free_ray(ang_deg: float, max_steps: int = 28) -> int:
        if self_cx is None:
            return 0
        a = np.radians(ang_deg)
        for step in range(1, max_steps + 1):
            sx = int(self_cx + step * 2.2 * np.sin(a))
            sy = int(self_cy - step * 2.2 * np.cos(a))
            if not (1 <= sx < rw - 1 and 1 <= sy < rh - 1):
                return step - 1
            if wall_px[sy, sx] or walk_u8[sy, sx] == 0:
                return max(0, step - 1)
        return max_steps

    sectors = []
    if self_cx is not None:
        for sec in range(16):
            ang = sec * 22.5
            flen = free_ray(ang)
            rel = (ang - facing + 180) % 360 - 180
            wh = 0 if flen >= 10 else (1 if flen >= 5 else 3)
            sectors.append(
                {
                    "ang": ang,
                    "rel": round(rel, 1),
                    "mean": round(float(flen), 1),
                    "free": flen,
                    "wall_hits": wh,
                }
            )

    fa = facing
    ray_free = free_ray(fa) if self_cx is not None else 0
    ray_walls = 0 if ray_free >= 8 else (1 if ray_free >= 4 else 3)
    wall_ahead = bool(self_cx is not None and ray_free < 6)
    cand = sectors
    open_best = None
    if cand:
        if wall_ahead:
            side = [s for s in cand if abs(s["rel"]) >= 35] or cand
            open_best = sorted(side, key=lambda s: (-s["free"], -abs(s["rel"])))[0]
        else:
            open_best = sorted(cand, key=lambda s: (-s["free"], abs(s["rel"]) * 0.2))[0]

    try:
        overlay = radar.copy()
        overlay[wall_px] = (0, 0, 255)
        walk_show = (walk_u8 > 0) & ~wall_px
        overlay[walk_show] = (overlay[walk_show] * 0.4 + np.array([40, 200, 40]) * 0.6).astype(np.uint8)
        if self_cx is not None:
            cv2.circle(overlay, (int(self_cx), int(self_cy)), 4, (255, 220, 0), -1)
        if open_best and self_cx is not None:
            oa = np.radians(open_best["ang"])
            for step in range(1, int(open_best["free"]) + 1):
                sx = int(self_cx + step * 2.2 * np.sin(oa))
                sy = int(self_cy - step * 2.2 * np.cos(oa))
                if 0 <= sx < rw and 0 <= sy < rh:
                    overlay[sy, sx] = (0, 255, 255)
        cv2.imwrite(str(Path(r"D:/FarmVMs/ops/vision") / "radar-paths.png"), overlay)
    except Exception:
        pass

    self_obs = None
    if self_cx is not None:
        self_obs = {
            "x": round(self_cx, 1),
            "y": round(self_cy, 1),
            "nx": round(float(self_cx) / max(1.0, float(rw)), 3),
            "ny": round(float(self_cy) / max(1.0, float(rh)), 3),
            "area": self_area,
            "color": "blue",
            "held": bool(self_held),
            "source": self_src,
        }
    observations = {
        "self": self_obs,
        "facing_deg": round(facing, 1),
        "facing_from": "white_triangle_tip" if facing_ok else "fallback",
        "enemies": enemies[:6],
        "allies": allies[:6],
        "sectors": sectors,
        "forward_ray_walls": ray_walls,
        "forward_free": ray_free,
        "wall_cut": round(wall_cut, 1),
        "wall_fill": round(fill_pct, 1),
    }
    estimates = {
        "enemy_count": len(enemies),
        "ally_count": len(allies),
        "open_best": open_best,
        "wall_ahead": bool(wall_ahead),
        "self_is_blue": bool(self_obs),
        "forward_blocked": bool(wall_ahead),
        "path_free_fwd": ray_free,
    }
    return {
        "ok": True,
        "reason": "" if self_obs else "no-self",
        "facing_deg": observations["facing_deg"],
        "facing_ok": bool(facing_ok),
        "enemies": enemies[:6],
        "enemy_count": len(enemies),
        "allies": allies[:6],
        "ally_count": len(allies),
        "sectors": sectors,
        "open_best": open_best,
        "wall_ahead": bool(wall_ahead),
        "self": self_obs,
        "crop": crop,
        "occupancy": occ64.astype(np.uint8).tolist(),
        "occupancy_n": occ_n,
        "wall_cut": round(wall_cut, 1),
        "wall_fill": round(fill_pct, 1),
        "observations": observations,
        "estimates": estimates,
    }


PREV_MOTION = Path(r"D:/FarmVMs/ops/vision/prev_motion.png")
TUNE_PATH = Path(r"D:/FarmVMs/ops/vision/radar-tune.json")
HINT_PATH = Path(r"D:/FarmVMs/ops/vision/radar-self-hint.json")
_tune_mtime = -1.0
_tune = {"wall_max": 92, "wall_fill": 38, "occ_n": 48}
_last_self = None


def _num(v, fallback):
    try:
        if v is None or v == "":
            return fallback
        return float(v)
    except Exception:
        return fallback


def radar_self_hint():
    try:
        j = json.loads(HINT_PATH.read_text(encoding="utf8"))
        if j.get("reset"):
            return {"reset": True}
        nx = float(j.get("nx"))
        ny = float(j.get("ny"))
        if 0.0 <= nx <= 1.0 and 0.0 <= ny <= 1.0:
            return {"nx": nx, "ny": ny, "lock": bool(j.get("lock", True))}
    except Exception:
        return None
    return None


def radar_tune() -> dict:
    global _tune_mtime, _tune
    try:
        mt = TUNE_PATH.stat().st_mtime
        if mt != _tune_mtime:
            j = json.loads(TUNE_PATH.read_text(encoding="utf8"))
            if isinstance(j, dict):
                _tune = {**_tune, **j}
            _tune_mtime = mt
    except Exception:
        pass
    return _tune


def detect_motion(img: np.ndarray) -> dict:
    """moving blobs in playfield (not radar/hud) -> likely enemies estimate."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # mask out radar, top bar, bottom hud, right killfeed strip
    mask = np.ones((h, w), np.uint8) * 255
    mask[0 : int(h * 0.22), 0 : int(w * 0.16)] = 0
    mask[0 : int(h * 0.08), :] = 0
    mask[int(h * 0.88) :, :] = 0
    mask[:, int(w * 0.88) :] = 0
    mask[:, 0 : int(w * 0.04)] = 0

    movers = []
    if PREV_MOTION.exists():
        prev = cv2.imread(str(PREV_MOTION), cv2.IMREAD_GRAYSCALE)
        if prev is not None and prev.shape == gray.shape:
            dif = cv2.absdiff(gray, prev)
            dif = cv2.bitwise_and(dif, dif, mask=mask)
            dif = cv2.GaussianBlur(dif, (5, 5), 0)
            _, th = cv2.threshold(dif, 42, 255, cv2.THRESH_BINARY)
            th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
            n, _lab, stats, cents = cv2.connectedComponentsWithStats(th, 8)
            for i in range(1, n):
                area = int(stats[i, cv2.CC_STAT_AREA])
                bw = int(stats[i, cv2.CC_STAT_WIDTH])
                bh = int(stats[i, cv2.CC_STAT_HEIGHT])
                # person-ish: not full-screen camera pan noise
                if area < 140 or area > 2800:
                    continue
                if bw < 8 or bh < 14 or bw > 120 or bh > 220:
                    continue
                if bh < bw * 0.85:
                    continue  # prefer upright
                cx, cy = float(cents[i][0]), float(cents[i][1])
                xp, yp = 100.0 * cx / w, 100.0 * cy / h
                if not (28 <= xp <= 72 and 22 <= yp <= 72):
                    continue
                score = area * (1.5 - min(1.0, abs(xp - 50) / 40) * 0.7 - min(1.0, abs(yp - 46) / 40) * 0.4)
                if score < 200:
                    continue
                movers.append(
                    {
                        "x": round(xp, 1),
                        "y": round(yp, 1),
                        "area": area,
                        "w": bw,
                        "h": bh,
                        "score": round(float(score), 1),
                        "likely_enemy": True,
                        "src": "motion",
                    }
                )
            movers.sort(key=lambda m: -m["score"])

    try:
        PREV_MOTION.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(PREV_MOTION), gray)
    except Exception:
        pass

    return {"movers": movers[:5], "count": len(movers)}


OUT_DIR = Path(r"D:/FarmVMs/ops/vision")


def read_self():
    p = OUT_DIR / "self.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def yolo_side(name: str, me: dict, team: str | None = None) -> str:
    if me.get("dm"):
        return "foe"
    n = str(team or "").lower()
    if not n:
        return "nav"
    t_me = bool(me.get("t"))
    if n in ("c", "ch", "ct"):
        return "foe" if t_me else "ally"
    if n in ("t", "th"):
        return "foe" if not t_me else "ally"
    return "nav"


def load_classes():
    p = Path(__file__).resolve().parent / "classes.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("classes") or []
    except Exception:
        return []


_CLASSES = load_classes()
_BY_NAME = {str(c.get("name")): c for c in _CLASSES}


def hex_bgr(hx: str):
    s = str(hx or "").lstrip("#")
    if len(s) != 6:
        return (180, 180, 180)
    r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    return (b, g, r)


def hex_rgb(hx: str):
    s = str(hx or "").lstrip("#")
    if len(s) != 6:
        return (180, 180, 180)
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def class_of(name: str) -> dict:
    return _BY_NAME.get(str(name or "").lower()) or {}


def yolo_color(d):
    c = class_of(d.get("name"))
    return hex_bgr(c.get("color") or "#b4b4b4")


def class_label(d) -> str:
    c = class_of(d.get("name"))
    return str(d.get("label") or c.get("label") or d.get("name") or "?")


def _font():
    from PIL import ImageFont
    for p in (
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\tahoma.ttf",
    ):
        try:
            return ImageFont.truetype(p, 16)
        except Exception:
            continue
    return ImageFont.load_default()


def paint_dets(bgr: np.ndarray, dets: list) -> np.ndarray:
    # priler BaseDetector.draw_boxes (cv2, class color, class+conf)
    from priler_detect import CLASS_COLORS, CLASS_NAMES

    vis = bgr
    h, w = vis.shape[:2]
    for d in dets or []:
        name = str(d.get("name") or "")
        try:
            cid = CLASS_NAMES.index(name)
        except ValueError:
            cid = 0
        color = CLASS_COLORS[cid]
        x = float(d.get("x", 0)) / 100.0 * w
        y = float(d.get("y", 0)) / 100.0 * h
        bw = float(d.get("w", 2)) / 100.0 * w
        bh = float(d.get("h", 2)) / 100.0 * h
        x0, y0 = int(x - bw / 2), int(y - bh / 2)
        x1, y1 = int(x + bw / 2), int(y + bh / 2)
        cv2.rectangle(vis, (x0, y0), (x1, y1), color, 2)
        tag = str(d.get("label") or class_label(d))
        font_scale = 2 / 3
        font_thickness = 1
        (text_w, text_h), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, font_scale, font_thickness)
        cv2.rectangle(vis, (x0, max(0, y0 - text_h - 4)), (x0 + text_w, y0), color, -1)
        cv2.putText(vis, tag, (x0, max(text_h, y0 - 2)), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), font_thickness)
    return vis


def _write_img(path: Path, img: np.ndarray, jpeg: bool = False) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".tmp" + path.suffix)
    if jpeg:
        ok = cv2.imwrite(str(tmp), img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
    else:
        ok = cv2.imwrite(str(tmp), img, [int(cv2.IMWRITE_PNG_COMPRESSION), 1])
    if ok:
        tmp.replace(path)


def draw_overlay(img: np.ndarray, yolo: dict, radar: dict, motion: dict, screen: str) -> None:
    # priler: detect process paints boxes on the frame, preview process only shows the latest.
    global _GLASS_KEY
    dets = list(yolo.get("dets") or [])
    vis = paint_dets(img.copy(), dets)
    ms = yolo.get("ms")
    n = len(dets)
    cv2.putText(vis, f"FPS yolo {0 if not ms else round(1000.0 / max(1.0, float(ms)), 1)}  n={n}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2, cv2.LINE_AA)
    try:
        _write_img(OUT_DIR / "preview.jpg", vis, jpeg=True)
    except Exception:
        pass
    off = (OUT_DIR / "overlay-off.flag").exists()
    if off:
        if _GLASS_KEY == "off":
            return
        _GLASS_KEY = "off"
        try:
            _write_img(OUT_DIR / "overlay-glass.png", np.zeros_like(img), jpeg=False)
        except Exception:
            pass
        return
    _GLASS_KEY = None
    try:
        _write_img(OUT_DIR / "overlay-glass.png", paint_dets(np.zeros_like(img), dets), jpeg=False)
    except Exception:
        pass


def analyze(image_path: Path) -> dict:
    img = cv2.imread(str(image_path))
    ts = time.time()
    if img is None:
        return {
            "timestamp": ts,
            "ok": False,
            "screen": "NO_IMAGE",
            "confidence": 0.0,
            "mean": 0,
            "objects": [],
            "error": f"cannot read {image_path}",
        }

    if os.environ.get("FARM_YOLO_FAST") == "1":
        yolo = detect_bgr(img)
        try:
            age_ms = round((time.time() - Path(image_path).stat().st_mtime) * 1000.0, 1)
            yolo["frame_age_ms"] = age_ms
        except Exception:
            pass
        me = read_self()
        for d in yolo.get("dets") or []:
            d["side"] = yolo_side(d.get("name"), me, d.get("team"))
        radar = analyze_radar(img)
        try:
            draw_overlay(img, yolo, radar if isinstance(radar, dict) else {}, {"movers": []}, "IN_GAME")
        except Exception:
            pass
        rad_obs = (radar or {}).get("observations") or {}
        rad_est = (radar or {}).get("estimates") or {}
        return {
            "timestamp": ts,
            "ok": True,
            "screen": "IN_GAME",
            "confidence": 0.5,
            "mean": round(float(np.mean(img)), 2),
            "objects": [],
            "radar": radar,
            "yolo": yolo,
            "observations": {"radar": rad_obs if radar.get("ok") else None, "yolo": yolo.get("dets") or []},
            "estimates": {
                "yolo": {"dets": yolo.get("dets") or [], "ok": bool(yolo.get("ok")), "ms": yolo.get("ms"), "backend": yolo.get("backend")},
                "radar": rad_est if radar.get("ok") else None,
            },
            "source": str(image_path),
        }

    h, w = img.shape[:2]
    objects = []

    if TEMPLATES.exists():
        for p in sorted(TEMPLATES.glob("*.png")):
            templ = cv2.imread(str(p), cv2.IMREAD_COLOR)
            m = match_template(img, templ, threshold=0.72)
            if not m:
                continue
            objects.append(
                {
                    "type": p.stem,  # nav_play, nav_store, ...
                    "confidence": round(m["confidence"], 3),
                    "x": m["x"],
                    "y": m["y"],
                    "px": m["px"],
                    "py": m["py"],
                    "w": m["w"],
                    "h": m["h"],
                }
            )

    objects.extend(find_greens(img))
    radar = analyze_radar(img)
    screen, conf = classify_screen(img, objects)
    hud_dead = detect_spec_hud(img)
    if hud_dead:
        screen, conf = hud_dead, 0.9
    elif radar.get("ok"):
        screen, conf = "IN_GAME", max(conf, 0.93)
    yolo = detect_bgr(img)
    me = read_self()
    for d in yolo.get("dets") or []:
        d["side"] = yolo_side(d.get("name"), me, d.get("team"))
    motion = detect_motion(img) if screen in ("IN_GAME", "TRAINING", "UNKNOWN", "RUNNING") else {"movers": [], "count": 0}

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    black_ratio = float(np.mean(gray < 12))
    small = cv2.resize(gray, (32, 18), interpolation=cv2.INTER_AREA)
    frame_hash = hashlib.md5(small.tobytes()).hexdigest()[:12]
    capture_health = {
        "mean": round(float(np.mean(img)), 2),
        "black_ratio": round(black_ratio, 4),
        "frame_hash": frame_hash,
        "w": w,
        "h": h,
    }

    # stable canonical targets for decision engine
    def best(types):
        cands = [o for o in objects if o["type"] in types]
        return max(cands, key=lambda o: o.get("score", o.get("confidence", 0))) if cands else None

    targets = {
        "play_button": None,
        "training_go": best({"mode_go"}),
        "go_button": best({"go_button", "mode_go"}),
        "home_icon": {"type": "home_icon", "x": 3.5, "y": 3.5, "confidence": 0.5},
    }
    play = next((o for o in objects if o["type"] == "nav_play"), None)
    if play:
        targets["play_button"] = {**play, "y": min(8.0, float(play["y"]) + 1.5)}
    else:
        targets["play_button"] = {"type": "nav_play", "x": 37.0, "y": 5.0, "confidence": 0.4}

    rad_obs = (radar or {}).get("observations") or {}
    rad_est = (radar or {}).get("estimates") or {}

    result = {
        "timestamp": ts,
        "ok": True,
        "screen": screen,
        "confidence": round(conf, 3),
        "w": w,
        "h": h,
        "mean": capture_health["mean"],
        "objects": objects,
        "targets": {k: v for k, v in targets.items() if v},
        "radar": radar,
        "yolo": yolo,
        "motion": motion,
        "observations": {
            "screen": screen,
            "confidence": round(conf, 3),
            "objects": objects,
            "targets": {k: v for k, v in targets.items() if v},
            "radar": rad_obs if radar.get("ok") else None,
            "yolo": yolo.get("dets") if yolo.get("ok") else [],
            "motion": {"movers": motion.get("movers") or []},
            "capture": capture_health,
        },
        "estimates": {
            "screen": screen,
            "radar": rad_est if radar.get("ok") else None,
            "yolo": {"dets": yolo.get("dets") or [], "ok": bool(yolo.get("ok"))},
            "motion": {
                "likely_enemies": motion.get("movers") or [],
                "count": motion.get("count") or 0,
            },
        },
        "capture_health": capture_health,
        "source": str(image_path),
    }
    try:
        draw_overlay(img, yolo, radar if isinstance(radar, dict) else {}, motion, screen)
    except Exception:
        pass
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", default=r"D:\FarmVMs\ops\vision\live.png")
    ap.add_argument("--out", default=r"D:\FarmVMs\ops\vision\frame.json")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--interval", type=float, default=0.45)
    args = ap.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    def once():
        frame = analyze(Path(args.image))
        out.write_text(json.dumps(frame, ensure_ascii=True, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {
                    "ok": frame.get("ok"),
                    "screen": frame.get("screen"),
                    "confidence": frame.get("confidence"),
                    "objects": len(frame.get("objects") or []),
                    "mean": frame.get("mean"),
                },
                ensure_ascii=True,
            )
        )
        return frame

    if args.loop:
        last_mt = None
        while True:
            try:
                mt = Path(args.image).stat().st_mtime_ns
            except OSError:
                time.sleep(max(0.2, args.interval))
                continue
            if last_mt is not None and mt == last_mt:
                time.sleep(0.001)
                continue
            last_mt = mt
            try:
                once()
            except Exception as e:
                print("cv-loop-err " + type(e).__name__ + ": " + str(e), flush=True)
                time.sleep(0.05)
    else:
        once()


if __name__ == "__main__":
    main()
