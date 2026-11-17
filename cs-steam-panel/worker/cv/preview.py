# priler-style preview process: show latest painted frame only. no yolo here.
from __future__ import annotations

import os
import time
from pathlib import Path

import cv2

SRC = Path(os.environ.get("FARM_YOLO_PREVIEW") or r"D:\FarmVMs\ops\vision\preview.jpg")
TITLE = "CS2 AI Vision"


def main():
    cv2.namedWindow(TITLE, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(TITLE, 1280, 720)
    last = None
    n = 0
    t0 = time.perf_counter()
    fps = 0.0
    while True:
        try:
            mt = SRC.stat().st_mtime_ns
        except OSError:
            if cv2.waitKey(15) & 0xFF == ord("q"):
                break
            continue
        if last is not None and mt == last:
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            time.sleep(0.001)
            continue
        last = mt
        img = cv2.imread(str(SRC))
        if img is None:
            continue
        n += 1
        now = time.perf_counter()
        if now - t0 >= 0.5:
            fps = n / (now - t0)
            n = 0
            t0 = now
        cv2.putText(img, f"preview {fps:.1f}", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 208, 247), 2, cv2.LINE_AA)
        h, w = img.shape[:2]
        if w > 1280:
            img = cv2.resize(img, (1280, int(h * 1280 / max(1, w))))
        cv2.imshow(TITLE, img)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
