# public csgo 4-class boxes -> our c/ch/t/th. cc-by-4.0 keremberke/csgo-object-detection
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

DATA = Path(r"D:\FarmVMs\ops\yolo")
PUBLIC = DATA / "public"
BEST = DATA / "best.pt"
SEED = DATA / "public-seed.pt"
HF_DS = "keremberke/csgo-object-detection"
HF_WT = "keremberke/yolov8n-csgo-player-detection"
NAMES = ["c", "ch", "t", "th"]


def coco_to_yolo(x, y, w, h, iw, ih):
    iw = max(1.0, float(iw))
    ih = max(1.0, float(ih))
    bw = max(0.0, min(1.0, float(w) / iw))
    bh = max(0.0, min(1.0, float(h) / ih))
    cx = max(0.0, min(1.0, (float(x) + float(w) / 2.0) / iw))
    cy = max(0.0, min(1.0, (float(y) + float(h) / 2.0) / ih))
    return cx, cy, bw, bh


def write_yaml():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "data.yaml").write_text(
        "\n".join(
            [
                f"path: {PUBLIC.as_posix()}",
                "train: train/images",
                "val: val/images",
                "nc: 4",
                "names: [c, ch, t, th]",
                "",
            ]
        ),
        encoding="utf-8",
    )


def fetch_weights():
    from huggingface_hub import hf_hub_download

    src = hf_hub_download(repo_id=HF_WT, filename="best.pt")
    SEED.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, SEED)
    if not BEST.exists() or BEST.stat().st_size < 1000:
        shutil.copy2(src, BEST)
        print("wrote", BEST, BEST.stat().st_size, flush=True)
    else:
        print("keep existing", BEST, "seed", SEED, flush=True)
    return SEED


def fetch_dataset():
    import zipfile
    from huggingface_hub import hf_hub_download

    print("download zip", HF_DS, "cc-by-4.0 ~4454 imgs", flush=True)
    name_to_id = {"ct": 0, "cthead": 1, "t": 2, "thead": 3}
    n_train = n_val = 0
    for split, zip_name, out_name in (
        ("train", "data/train.zip", "train"),
        ("val", "data/valid.zip", "val"),
    ):
        zpath = hf_hub_download(repo_id=HF_DS, repo_type="dataset", filename=zip_name)
        raw = PUBLIC / "_raw" / split
        if raw.exists():
            shutil.rmtree(raw)
        raw.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(raw)
        n = export_coco_folder(raw, out_name, name_to_id)
        if out_name == "train":
            n_train = n
        else:
            n_val = n
    write_yaml()
    meta = {
        "source": HF_DS,
        "license": "CC BY 4.0",
        "names": NAMES,
        "n_train": n_train,
        "n_val": n_val,
        "note": "csgo 416px. cs2 hud differs. 4-class only, not wall/gun.",
    }
    (PUBLIC / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("meta", meta, flush=True)
    return meta


def export_coco_folder(folder: Path, out_name: str, name_to_id: dict) -> int:
    coco_path = None
    for p in folder.rglob("_annotations.coco.json"):
        coco_path = p
        break
    if not coco_path:
        raise SystemExit("no coco json in " + str(folder))
    coco = json.loads(coco_path.read_text(encoding="utf-8"))
    cat_id_to_name = {int(c["id"]): str(c["name"]).lower() for c in coco.get("categories") or []}
    img_by_id = {int(im["id"]): im for im in coco.get("images") or []}
    by_img = {}
    for a in coco.get("annotations") or []:
        by_img.setdefault(int(a["image_id"]), []).append(a)
    img_dir = PUBLIC / out_name / "images"
    lab_dir = PUBLIC / out_name / "labels"
    img_dir.mkdir(parents=True, exist_ok=True)
    lab_dir.mkdir(parents=True, exist_ok=True)
    root = coco_path.parent
    n = 0
    labeled = 0
    for iid, im in img_by_id.items():
        fn = im.get("file_name") or ""
        src = root / fn
        if not src.is_file():
            hits = list(root.rglob(Path(fn).name))
            src = hits[0] if hits else None
        if src is None or not src.is_file():
            continue
        stem = f"{out_name}_{iid:06d}"
        dest = img_dir / (stem + src.suffix.lower())
        shutil.copy2(src, dest)
        iw = int(im.get("width") or 416)
        ih = int(im.get("height") or 416)
        lines = []
        for a in by_img.get(iid, []):
            nm = cat_id_to_name.get(int(a.get("category_id", -1)), "")
            cid = name_to_id.get(nm)
            box = a.get("bbox") or []
            if cid is None or len(box) < 4:
                continue
            cx, cy, bw, bh = coco_to_yolo(box[0], box[1], box[2], box[3], iw, ih)
            if bw < 1e-4 or bh < 1e-4:
                continue
            lines.append(f"{cid} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
        (lab_dir / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        n += 1
        if lines:
            labeled += 1
    print("done", out_name, "imgs", n, "with-box", labeled, flush=True)
    return n


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    sh_pip = [sys.executable, "-m", "pip", "install", "-q", "huggingface_hub", "pillow"]
    print("+", " ".join(sh_pip), flush=True)
    import subprocess

    r = subprocess.run(sh_pip, check=False)
    if r.returncode:
        raise SystemExit(r.returncode)
    fetch_weights()
    skip = "--weights-only" in sys.argv
    if not skip:
        fetch_dataset()
    print("ok public yolo", PUBLIC, flush=True)


if __name__ == "__main__":
    main()
