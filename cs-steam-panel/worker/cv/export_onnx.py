# export best.pt -> onnx for amd directml / cpu.
from pathlib import Path
from ultralytics import YOLO

src = Path(r"D:\FarmVMs\ops\yolo\best.pt")
out = Path(r"D:\FarmVMs\ops\yolo\best.onnx")
print("export", src, "->", out)
m = YOLO(str(src))
p = m.export(format="onnx", imgsz=640, simplify=True, opset=17)
print("wrote", p)
