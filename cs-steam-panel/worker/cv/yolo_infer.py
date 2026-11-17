# yolo on host frame. amd rx via onnxruntime-directml, cpu onnx, then pytorch.
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import cv2
import numpy as np

os.environ.setdefault("YOLO_OFFLINE", "1")

ROOT = Path(__file__).resolve().parent
_cls = []
try:
    _cls = json.loads((ROOT / "classes.json").read_text(encoding="utf-8")).get("classes") or []
except Exception:
    _cls = []
NAMES = tuple(c.get("name") or "c" for c in _cls) or ("c", "ch", "t", "th")
HEAD = {"ch", "th"}
PLAYER = {"c", "ch", "t", "th"}
_PRILER = Path(r"D:\FarmVMs\ops\yolo\priler-src\yolov8")
WEIGHTS = Path(os.environ.get("FARM_YOLO_WEIGHTS") or str(_PRILER / "cs2_yolov8m_640_augmented_v4.pt"))
ONNX = Path(os.environ.get("FARM_YOLO_ONNX") or str(_PRILER / "cs2_yolov8m_640_augmented_v4.onnx"))
ALIAS = {
    "ct": "c",
    "cthead": "ch",
    "t": "t",
    "thead": "th",
    "c": "c",
    "ch": "ch",
    "th": "th",
}

_sess = None
_inp = None
_model = None
_fail = False
_backend = "none"
_next_tid = 1
_tracks = []
_t_prev = 0.0
_byte = None
_team_by_id = {}
_name_by_id = {}


def overlay_tag(d) -> str:
    # priler draw_boxes: "{class} {conf:.2f}"
    name = str(d.get("name") or "?")
    c = d.get("conf")
    if c is None:
        return name
    return f"{name} {float(c):.2f}"


def _iou(a, b):
    ax0, ay0 = a["x"] - a["w"] / 2, a["y"] - a["h"] / 2
    ax1, ay1 = a["x"] + a["w"] / 2, a["y"] + a["h"] / 2
    bx0, by0 = b["x"] - b["w"] / 2, b["y"] - b["h"] / 2
    bx1, by1 = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    ua = max(1e-6, a["w"] * a["h"] + b["w"] * b["h"] - inter)
    return inter / ua


def _dist(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def _team_of(name: str) -> str:
    n = str(name or "")
    return "ct" if n in ("c", "ch") else "t"


def _name_of(team: str, head: bool) -> str:
    if team == "ct":
        return "ch" if head else "c"
    return "th" if head else "t"


def _team_color(img, d):
    if img is None:
        return None
    h, w = img.shape[:2]
    bw = max(4.0, float(d["w"]) * 0.42)
    bh = max(6.0, float(d["h"]) * 0.45)
    x0 = int(max(0, (d["x"] - bw / 2) / 100.0 * w))
    x1 = int(min(w, (d["x"] + bw / 2) / 100.0 * w))
    y0 = int(max(0, (d["y"] - bh * 0.05) / 100.0 * h))
    y1 = int(min(h, (d["y"] + bh * 0.7) / 100.0 * h))
    if d.get("head"):
        y0 = int(max(0, (d["y"] - float(d["h"]) * 0.2) / 100.0 * h))
        y1 = int(min(h, (d["y"] + float(d["h"]) * 1.8) / 100.0 * h))
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    crop = img[y0:y1, x0:x1]
    if crop.size < 80:
        return None
    b, g, r = cv2.split(crop)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    hh, ss, vv = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    vis = (vv >= 35) & (vv <= 240)
    n = int(np.count_nonzero(vis))
    if n < 25:
        return None
    bi, ri = b.astype(np.int16), r.astype(np.int16)
    blue = int(np.count_nonzero(vis & (((hh >= 90) & (hh <= 140) & (ss >= 35)) | ((bi - ri) > 22))))
    yell = int(np.count_nonzero(vis & (((hh <= 35) & (ss >= 40)) | ((ri - bi) > 28))))
    if blue > yell * 1.25 and blue / n >= 0.10:
        return "ct"
    if yell > blue * 1.25 and yell / n >= 0.10:
        return "t"
    return None


class _Trk:
    __slots__ = ("id", "x", "y", "w", "h", "vx", "vy", "lx", "ly", "hits", "miss", "ct", "tt", "head", "conf", "locked", "t_hit")

    def __init__(self, tid, d):
        self.id = tid
        self.x = float(d["x"])
        self.y = float(d["y"])
        self.w = float(d["w"])
        self.h = float(d["h"])
        self.vx = 0.0
        self.vy = 0.0
        self.lx = self.x
        self.ly = self.y
        self.hits = 1
        self.miss = 0
        self.ct = 0
        self.tt = 0
        self.head = bool(d.get("head"))
        self.conf = float(d.get("conf") or 0)
        self.locked = ""
        self.t_hit = time.perf_counter()

    def team(self) -> str:
        if self.ct >= self.tt + 2 and self.ct >= 3:
            self.locked = "ct"
        elif self.tt >= self.ct + 2 and self.tt >= 3:
            self.locked = "t"
        return self.locked or ""

    def pred(self, dt):
        return

    def hit(self, d, dt, color_team):
        self.x = float(d["x"])
        self.y = float(d["y"])
        self.w = float(d["w"])
        self.h = float(d["h"])
        self.vx = 0.0
        self.vy = 0.0
        self.lx, self.ly = self.x, self.y
        self.hits += 1
        self.miss = 0
        self.head = bool(d.get("head"))
        self.conf = float(d.get("conf") or self.conf)
        self.t_hit = time.perf_counter()
        gap = float(d.get("team_gap") or 0)
        if gap >= 0.10:
            if _team_of(d["name"]) == "ct":
                self.ct += 1
            else:
                self.tt += 1
        if color_team == "ct":
            self.ct += 3
        elif color_team == "t":
            self.tt += 3

    def as_det(self, coast):
        team = self.team()
        name = _name_of(team, self.head) if team else ("ch" if self.head else "c")
        d = {
            "name": name,
            "team": team,
            "tid": self.id,
            "head": self.head,
            "conf": round(self.conf, 3),
            "x": round(self.x, 2),
            "y": round(self.y, 2),
            "w": round(self.w, 2),
            "h": round(self.h, 2),
            "coast": coast,
            "vx": round(self.vx, 2),
            "vy": round(self.vy, 2),
        }
        d["label"] = overlay_tag(d) + (" ~" if coast else "")
        return d


def _match(tracks, dets, min_iou, max_dist):
    pairs = []
    used_t, used_d = set(), set()
    scores = []
    for ti, tr in enumerate(tracks):
        for di, d in enumerate(dets):
            iou = _iou({"x": tr.x, "y": tr.y, "w": tr.w, "h": tr.h}, d)
            dist = _dist({"x": tr.x, "y": tr.y}, d)
            if iou < min_iou and dist > max_dist:
                continue
            kind = 0.0 if bool(tr.head) == bool(d.get("head")) else 1.2
            scores.append((kind - (iou * 4.0) + dist * 0.03, ti, di))
    scores.sort()
    for _, ti, di in scores:
        if ti in used_t or di in used_d:
            continue
        used_t.add(ti)
        used_d.add(di)
        pairs.append((ti, di))
    return pairs


def _boxes_pack(dets, img):
    h, w = img.shape[:2]
    xyxy, conf, cls = [], [], []
    for d in dets:
        name = str(d.get("name") or "c")
        cid = 1 if name == "ch" else 2 if name == "t" else 3 if name == "th" else 0
        x = float(d["x"]) / 100.0 * w
        y = float(d["y"]) / 100.0 * h
        bw = float(d["w"]) / 100.0 * w
        bh = float(d["h"]) / 100.0 * h
        xyxy.append([x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2])
        conf.append(float(d.get("conf") or 0))
        cls.append(cid)
    return _DetBoxes(xyxy, conf, cls)


class _DetBoxes:
    def __init__(self, xyxy, conf, cls):
        self.xyxy = np.asarray(xyxy, dtype=np.float32).reshape(-1, 4)
        self.conf = np.asarray(conf, dtype=np.float32).reshape(-1)
        self.cls = np.asarray(cls, dtype=np.float32).reshape(-1)
        if self.xyxy.shape[0]:
            cx = (self.xyxy[:, 0] + self.xyxy[:, 2]) * 0.5
            cy = (self.xyxy[:, 1] + self.xyxy[:, 3]) * 0.5
            ww = self.xyxy[:, 2] - self.xyxy[:, 0]
            hh = self.xyxy[:, 3] - self.xyxy[:, 1]
            self.xywh = np.stack([cx, cy, ww, hh], axis=1)
        else:
            self.xywh = np.zeros((0, 4), dtype=np.float32)

    def __len__(self):
        return int(self.xyxy.shape[0])

    def __getitem__(self, mask):
        return _DetBoxes(self.xyxy[mask], self.conf[mask], self.cls[mask])


def _byte_tracker():
    global _byte
    if _byte is not None:
        return _byte
    from argparse import Namespace
    from ultralytics.trackers import BYTETracker

    # ultralytics bytetrack.yaml defaults, slightly lower thresh for our onnx scores
    _byte = BYTETracker(
        Namespace(
            tracker_type="bytetrack",
            track_high_thresh=0.18,
            track_low_thresh=0.08,
            new_track_thresh=0.22,
            track_buffer=30,
            match_thresh=0.8,
            fuse_score=True,
        )
    )
    return _byte


def _vote_team(tid, d, img):
    st = _team_by_id.setdefault(tid, {"ct": 0, "tt": 0, "locked": ""})
    gap = float(d.get("team_gap") or 0)
    if gap >= 0.10:
        if _team_of(d["name"]) == "ct":
            st["ct"] += 1
        else:
            st["tt"] += 1
    col = _team_color(img, d) if img is not None else None
    if col == "ct":
        st["ct"] += 1
    elif col == "t":
        st["tt"] += 1
    if st["ct"] >= st["tt"] + 2 and st["ct"] >= 4:
        st["locked"] = "ct"
    elif st["tt"] >= st["ct"] + 2 and st["tt"] >= 4:
        st["locked"] = "t"
    return st["locked"]


def _track_dets(dets, img):
    # priler/csgobot: no bytetrack. boxes exist only while yolo sees them.
    return _update_tracks(dets, img)


def _update_tracks(dets, img):
    global _tracks, _next_tid, _t_prev
    _t_prev = time.perf_counter()
    dets = [d for d in dets if not _ignore_hud(d)]
    pairs = _match(_tracks, dets, 0.15, 12.0)
    hit_d = {ti: dets[di] for ti, di in pairs}
    nxt = []
    seen = set()
    for i, tr in enumerate(_tracks):
        if i in hit_d:
            d = hit_d[i]
            seen.add(id(d))
            tr.hit(d, 0.05, _team_color(img, d))
            nxt.append(tr)
    for d in dets:
        if id(d) in seen or d.get("conf", 0) < 0.10:
            continue
        if len(nxt) >= 12:
            break
        tr = _Trk(_next_tid, d)
        col = _team_color(img, d)
        if col == "ct":
            tr.ct += 3
        elif col == "t":
            tr.tt += 3
        _next_tid += 1
        nxt.append(tr)
    _tracks = nxt
    out = []
    keep = []
    for tr in _tracks:
        d = tr.as_det(tr.miss > 0)
        if _ignore_hud(d):
            continue
        keep.append(tr)
        out.append(d)
    _tracks = keep
    out.sort(key=lambda d: (-int(d["head"]), -d["conf"]))
    return out


def _letterbox(img, size):
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nw, nh = int(round(w * r)), int(round(h * r))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    dx, dy = (size - nw) // 2, (size - nh) // 2
    canvas[dy : dy + nh, dx : dx + nw] = resized
    return canvas, r, dx, dy


def _load_ort():
    global _sess, _inp, _backend
    if _sess is not None:
        return _sess
    if not ONNX.exists():
        return None
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    avail = ort.get_available_providers()
    providers = []
    if "DmlExecutionProvider" in avail:
        providers.append(("DmlExecutionProvider", {"device_id": 0}))
        _backend = "dml"
    providers.append("CPUExecutionProvider")
    if _backend != "dml":
        _backend = "onnx-cpu"
    _sess = ort.InferenceSession(str(ONNX), so, providers=providers)
    _inp = _sess.get_inputs()[0].name
    return _sess


def _load_pt():
    global _model, _fail
    if _model is not None:
        return _model
    if not WEIGHTS.exists():
        _fail = True
        return None
    from ultralytics import YOLO

    _model = YOLO(str(WEIGHTS))
    return _model


def _nms_xyxy(xyxy, scores, iou_th=0.5, max_n=16):
    if len(xyxy) == 0:
        return []
    order = np.argsort(-scores)
    keep = []
    while len(order) and len(keep) < max_n:
        i = int(order[0])
        keep.append(i)
        if len(order) == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(xyxy[i, 0], xyxy[rest, 0])
        yy1 = np.maximum(xyxy[i, 1], xyxy[rest, 1])
        xx2 = np.minimum(xyxy[i, 2], xyxy[rest, 2])
        yy2 = np.minimum(xyxy[i, 3], xyxy[rest, 3])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        area_i = (xyxy[i, 2] - xyxy[i, 0]) * (xyxy[i, 3] - xyxy[i, 1])
        area_r = (xyxy[rest, 2] - xyxy[rest, 0]) * (xyxy[rest, 3] - xyxy[rest, 1])
        iou = inter / np.maximum(1e-6, area_i + area_r - inter)
        order = rest[iou < iou_th]
    return keep


def _parse_yolo(out, conf_min):
    arr = np.array(out)
    if arr.ndim == 3:
        arr = arr[0]
    # nms-exported (300, 6) is unreliable. prefer (8, 8400) raw yolov8.
    if arr.shape[0] <= 16 and arr.shape[1] > 32:
        arr = arr.T
    if arr.shape[1] >= 6 and arr.shape[0] > 32:
        xywh = arr[:, :4]
        cls_scores = arr[:, 4:]
        cls_id = np.argmax(cls_scores, axis=1)
        conf = cls_scores[np.arange(len(cls_id)), cls_id]
        m = conf >= conf_min
        xywh, conf, cls_id = xywh[m], conf[m], cls_id[m]
        xyxy = np.stack(
            [
                xywh[:, 0] - xywh[:, 2] / 2,
                xywh[:, 1] - xywh[:, 3] / 2,
                xywh[:, 0] + xywh[:, 2] / 2,
                xywh[:, 1] + xywh[:, 3] / 2,
            ],
            axis=1,
        )
        keep = _nms_xyxy(xyxy, conf, iou_th=0.2)
        if not keep:
            return np.zeros((0, 8), dtype=np.float32)
        ncls = cls_scores.shape[1]
        sc_ct = cls_scores[:, 0] + (cls_scores[:, 1] if ncls > 1 else 0)
        sc_t = (cls_scores[:, 2] + cls_scores[:, 3] if ncls > 3 else (cls_scores[:, 1] if ncls == 2 else 0))
        sc_ct, sc_t = sc_ct[m][keep], sc_t[m][keep]
        return np.concatenate(
            [xyxy[keep], conf[keep, None], cls_id[keep, None], sc_ct[:, None], sc_t[:, None]],
            axis=1,
        )
    return arr


def _in_hands(d):
    # viewmodel is camera-locked in the lower fov. real players start higher.
    x = float(d.get("x") or 0)
    y = float(d.get("y") or 0)
    w = float(d.get("w") or 0)
    h = float(d.get("h") or 0)
    top = y - h / 2.0
    bot = y + h / 2.0
    if top >= 48 and 24 <= x <= 92 and bot >= 68:
        return True
    if y >= 56 and 30 <= x <= 90 and top >= 42:
        return True
    if (not d.get("head")) and y >= 58 and 28 <= x <= 90 and top >= 44:
        return True
    if h <= 34 and bot >= 76 and y >= 60 and 26 <= x <= 92:
        return True
    return False


def _in_radar(d):
    # cs2 minimap sits in the top-left disc. do not treat dots as players.
    x = float(d.get("x") or 0)
    y = float(d.get("y") or 0)
    w = float(d.get("w") or 0)
    h = float(d.get("h") or 0)
    left = x - w / 2.0
    top = y - h / 2.0
    right = x + w / 2.0
    bot = y + h / 2.0
    rx1, ry1 = 23.0, 36.0
    if right <= rx1 and bot <= ry1:
        return True
    ix0 = max(left, 0.0)
    iy0 = max(top, 0.0)
    ix1 = min(right, rx1)
    iy1 = min(bot, ry1)
    if ix1 > ix0 and iy1 > iy0:
        inter = (ix1 - ix0) * (iy1 - iy0)
        if inter / max(1e-6, w * h) >= 0.35:
            return True
    return False


def _ignore_hud(d):
    return _in_hands(d) or _in_radar(d)


def _rows_to_dets(rows, w, h, r, dx, dy, img=None):
    dets = []
    for row in rows:
        if len(row) < 6:
            continue
        x1, y1, x2, y2, sc, cid = [float(v) for v in row[:6]]
        x1 = (x1 - dx) / max(1e-6, r)
        y1 = (y1 - dy) / max(1e-6, r)
        x2 = (x2 - dx) / max(1e-6, r)
        y2 = (y2 - dy) / max(1e-6, r)
        cid = int(cid)
        raw = NAMES[cid] if 0 <= cid < len(NAMES) else ""
        name = ALIAS.get(str(raw).lower(), raw)
        if name not in PLAYER:
            continue
        sc_ct = float(row[6]) if len(row) >= 8 else (sc if name in ("c", "ch") else 0.0)
        sc_t = float(row[7]) if len(row) >= 8 else (sc if name in ("t", "th") else 0.0)
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        dets.append(
            {
                "name": name,
                "label": overlay_tag({"name": name, "conf": sc}),
                "head": name in HEAD,
                "conf": round(sc, 3),
                "team_gap": round(abs(sc_ct - sc_t), 3),
                "x": round(100.0 * cx / max(1, w), 2),
                "y": round(100.0 * cy / max(1, h), 2),
                "w": round(100.0 * (x2 - x1) / max(1, w), 2),
                "h": round(100.0 * (y2 - y1) / max(1, h), 2),
            }
        )
    dets.sort(key=lambda d: (-int(d["head"]), -d["conf"]))
    return [d for d in dets if not _in_radar(d)]


def detect_bgr(img, conf=None):
    if img is None:
        return {"ok": False, "dets": [], "reason": "no-image"}
    h, w = img.shape[:2]
    imgsz = int(os.environ.get("FARM_YOLO_IMGSZ") or 640)
    conf_min = float(conf if conf is not None else (os.environ.get("FARM_YOLO_CONF") or 0.45))
    t0 = time.perf_counter()
    sess = _load_ort()
    if sess is not None:
        ishape = sess.get_inputs()[0].shape
        size = int(ishape[2] or ishape[3] or 384)
        blob, r, dx, dy = _letterbox(img, size)
        rgb = cv2.cvtColor(blob, cv2.COLOR_BGR2RGB)
        tens = np.transpose(rgb.astype(np.float32) / 255.0, (2, 0, 1))[None]
        out = sess.run(None, {_inp: tens})[0]
        ms = round((time.perf_counter() - t0) * 1000.0, 1)
        rows = _parse_yolo(out, conf_min)
        dets = _rows_to_dets(rows, w, h, r, dx, dy, img)
        return {"ok": True, "dets": dets, "n": len(dets), "ms": ms, "backend": _backend}
    m = _load_pt()
    if m is None:
        return {"ok": False, "dets": [], "reason": "no-model"}
    pred = m.predict(img, conf=conf_min, verbose=False, device="cpu", imgsz=max(256, imgsz), max_det=16)[0]
    ms = round((time.perf_counter() - t0) * 1000.0, 1)
    boxes = pred.boxes
    dets = []
    if boxes is not None:
        xyxy = boxes.xyxy.cpu().numpy()
        cls = boxes.cls.cpu().numpy()
        cf = boxes.conf.cpu().numpy()
        for i in range(len(xyxy)):
            x0, y0, x1, y1 = [float(v) for v in xyxy[i]]
            cid = int(cls[i])
            raw = str(m.names.get(cid) or "")
            if not raw and 0 <= cid < len(NAMES):
                raw = NAMES[cid]
            name = ALIAS.get(raw.lower(), raw)
            if name not in PLAYER:
                continue
            dets.append(
                {
                    "name": name,
                    "label": overlay_tag({"name": name, "conf": float(cf[i])}),
                    "head": name in HEAD,
                    "conf": round(float(cf[i]), 3),
                    "x": round(100.0 * ((x0 + x1) / 2) / max(1, w), 2),
                    "y": round(100.0 * ((y0 + y1) / 2) / max(1, h), 2),
                    "w": round(100.0 * (x1 - x0) / max(1, w), 2),
                    "h": round(100.0 * (y1 - y0) / max(1, h), 2),
                }
            )
    dets.sort(key=lambda d: (-int(d["head"]), -d["conf"]))
    dets = [d for d in dets if not _in_radar(d)]
    return {"ok": True, "dets": dets, "n": len(dets), "ms": ms, "backend": "pt-cpu"}
