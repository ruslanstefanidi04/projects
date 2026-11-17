# vision detect from priler/csgobot (gpl-3.0). no aim / no mouse.
# source: https://github.com/Priler/csgobot detectors/yolov8.py + config DetectorConfig
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np

CLASS_NAMES = ["c", "ch", "t", "th"]
# bgr, same as priler config.DetectorConfig.class_colors
CLASS_COLORS = [
    (245, 185, 115),
    (255, 50, 0),
    (0, 208, 247),
    (0, 82, 247),
]
CONF = 0.7
IOU = 0.2
IMGSZ = 640


class YOLOv8Detector:
    def __init__(
        self,
        class_names: List[str],
        weights_path: str,
        confidence_threshold: float = CONF,
        iou_threshold: float = IOU,
        device: Optional[str] = None,
        half_precision: Optional[bool] = None,
    ):
        import torch
        from ultralytics import YOLO

        self.class_names = class_names
        self.weights_path = weights_path
        self.confidence_threshold = confidence_threshold
        self.iou_threshold = iou_threshold
        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device
        if half_precision is None:
            self.half_precision = self.device == "cuda"
        else:
            self.half_precision = half_precision
        self.model = YOLO(weights_path)
        if self.device != "cpu":
            self.model.to(self.device)
        dummy = np.zeros((IMGSZ, IMGSZ, 3), dtype=np.uint8)
        self.detect(dummy, verbose=False)

    def get_class_name(self, class_id: int) -> str:
        if 0 <= class_id < len(self.class_names):
            return self.class_names[class_id]
        return "unknown"

    def detect(self, image: np.ndarray, verbose: bool = False) -> Dict[str, List[Dict[str, Any]]]:
        if image is None or image.size == 0:
            return {}
        if len(image.shape) != 3 or image.shape[2] > 4:
            return {}
        if image.shape[2] == 4:
            image = image[:, :, :3]
        results = self.model.predict(
            source=image,
            verbose=verbose,
            half=self.half_precision,
            conf=self.confidence_threshold,
            iou=self.iou_threshold,
            imgsz=IMGSZ,
        )
        detections: Dict[str, List[Dict]] = {}
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue
            for i, cls_id in enumerate(boxes.cls):
                cls_id_int = int(cls_id)
                class_name = self.get_class_name(cls_id_int)
                if class_name not in detections:
                    detections[class_name] = []
                xyxy = boxes[i].xyxy.cpu().numpy()[0].tolist()
                conf = boxes.conf[i].item()
                detections[class_name].append({"cls": cls_id_int, "conf": conf, "xyxy": xyxy})
        return detections
