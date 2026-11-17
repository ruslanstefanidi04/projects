# train eyes: public 4-class (keremberke) first. human/ only if FARM_YOLO_HUMAN=1.
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

DATA = Path(r"D:\FarmVMs\ops\yolo")
HUMAN = DATA / "human"
PRILER = DATA / "priler"
PUBLIC = DATA / "public"
YAML_HUMAN = Path(__file__).resolve().parent / "farm.yaml"
YAML_PRILER = DATA / "priler.yaml"
YAML_PUBLIC = PUBLIC / "data.yaml"
OUT = DATA / "runs"
BEST = DATA / "best.pt"
SEED_PUBLIC = DATA / "public-seed.pt"
IMGS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
FETCH = Path(__file__).resolve().parent / "fetch_public_yolo.py"


def sh(args):
    print("+", " ".join(args), flush=True)
    r = subprocess.run(args, check=False)
    if r.returncode:
        raise SystemExit(r.returncode)


def count_imgs(p: Path) -> int:
    if not p.is_dir():
        return 0
    return sum(1 for x in p.iterdir() if x.is_file() and x.suffix.lower() in IMGS)


def find_priler_imgs() -> Path | None:
    for rel in ("val/images", "train/images", "valid/images"):
        p = PRILER / rel
        if count_imgs(p):
            return p
    return None


def write_session_split():
    img_dir = HUMAN / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    files = [p for p in img_dir.iterdir() if p.is_file() and p.suffix.lower() in IMGS]
    files.sort(key=lambda p: p.stat().st_mtime)
    buckets = defaultdict(list)
    for p in files:
        buckets[int(p.stat().st_mtime // 900)].append(p)
    keys = sorted(buckets)
    if len(files) < 2:
        train, val = files, files
    elif len(keys) < 2:
        cut = max(1, int(len(files) * 0.8))
        train, val = files[:cut], files[cut:]
        if not val:
            val = files[-1:]
            train = files[:-1] or files
    else:
        n_val = max(1, len(keys) // 5)
        val_set = set(keys[-n_val:])
        train, val = [], []
        for k in keys:
            (val if k in val_set else train).extend(buckets[k])
        if not train:
            train, val = val, val[-1:]
    (HUMAN / "train.txt").write_text("\n".join(str(p.resolve()) for p in train) + ("\n" if train else ""), encoding="utf-8")
    (HUMAN / "val.txt").write_text("\n".join(str(p.resolve()) for p in val) + ("\n" if val else ""), encoding="utf-8")
    YAML_HUMAN.write_text(
        "\n".join(
            [
                f"path: {HUMAN.as_posix()}",
                "train: train.txt",
                "val: val.txt",
                "nc: 12",
                "names: [c, ch, t, th, wall, turn, climb, cover, drop, look, gun, dead]",
                "",
            ]
        ),
        encoding="utf-8",
    )
    ver = {
        "n_train": len(train),
        "n_val": len(val),
        "sessions": len(keys),
        "split": "mtime-900s-buckets",
    }
    (DATA / "dataset-version.json").write_text(json.dumps(ver, indent=2), encoding="utf-8")
    print("split", ver, flush=True)
    return ver


def snapshot_baseline():
    base = DATA / "best.baseline.pt"
    if BEST.exists() and not base.exists():
        shutil.copy2(BEST, base)
        print("baseline", base, flush=True)


def drop_caches(root: Path):
    if not root.is_dir():
        return
    for cache in root.rglob("*.cache"):
        try:
            cache.unlink()
            print("drop cache", cache, flush=True)
        except Exception as e:
            print("cache busy", cache, e, flush=True)


def write_priler_yaml(img_dir: Path):
    rel = img_dir.resolve().relative_to(PRILER.resolve()).as_posix()
    YAML_PRILER.write_text(
        "\n".join(
            [
                f"path: {PRILER.as_posix()}",
                f"train: {rel}",
                f"val: {rel}",
                "nc: 4",
                "names: [c, ch, t, th]",
                "",
            ]
        ),
        encoding="utf-8",
    )


def pick_device():
    try:
        import torch

        if torch.cuda.is_available():
            return "0"
    except Exception:
        pass
    return "cpu"


def run_train(data_yaml: Path, name: str, n: int, seed: str):
    from ultralytics import YOLO

    device = pick_device()
    epochs = 8 if n >= 1000 else (16 if n < 80 else 12)
    print("train", device, name, "from", seed, "n", n, "ep", epochs, "yaml", data_yaml, flush=True)
    model = YOLO(seed)
    model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=640,
        batch=8 if device != "cpu" else 4,
        device=device,
        workers=0,
        cache=False,
        amp=device != "cpu",
        project=str(OUT),
        name=name,
        exist_ok=True,
    )
    trained = OUT / name / "weights" / "best.pt"
    if trained.exists():
        BEST.parent.mkdir(parents=True, exist_ok=True)
        BEST.write_bytes(trained.read_bytes())
        print("wrote", BEST, BEST.stat().st_size, flush=True)
    else:
        print("train finished without new best.pt", flush=True)


def ensure_public():
    n = count_imgs(PUBLIC / "train" / "images")
    if n >= 50 and YAML_PUBLIC.exists():
        return n
    print("fetch public yolo dataset", flush=True)
    sh([sys.executable, str(FETCH)])
    return count_imgs(PUBLIC / "train" / "images")


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    HUMAN.joinpath("images").mkdir(parents=True, exist_ok=True)
    HUMAN.joinpath("labels").mkdir(parents=True, exist_ok=True)
    sh([sys.executable, "-m", "pip", "install", "-q", "ultralytics"])

    human_only = os.environ.get("FARM_YOLO_HUMAN", "").strip() == "1"
    n_human = count_imgs(HUMAN / "images")
    drop_caches(HUMAN)
    drop_caches(PRILER)
    drop_caches(PUBLIC)
    snapshot_baseline()

    if human_only and n_human >= 8:
        write_session_split()
        run_train(YAML_HUMAN, "human", n_human, "yolov8n.pt")
        return

    n_pub = ensure_public()
    if n_pub >= 50:
        seed = str(SEED_PUBLIC) if SEED_PUBLIC.exists() else (str(BEST) if BEST.exists() else "yolov8n.pt")
        run_train(YAML_PUBLIC, "public", n_pub, seed)
        return

    if n_human >= 8:
        write_session_split()
        run_train(YAML_HUMAN, "human", n_human, "yolov8n.pt")
        return

    imgs = find_priler_imgs()
    if not imgs:
        print("no public/human labels. keep best.pt if any", flush=True)
        if not BEST.exists():
            raise SystemExit("no weights and no images")
        return
    write_priler_yaml(imgs)
    seed = str(BEST) if BEST.exists() else "yolov8n.pt"
    run_train(YAML_PRILER, "priler", count_imgs(imgs), seed)


if __name__ == "__main__":
    main()
