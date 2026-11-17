# CS2 Agent Lab: сводка зрения

Дата: 2026-09-18 (после Priler YOLO + JPEG loop + стекло без Hide-Glass). Репозиторий: `cs-steam-panel`. Среда: Windows host + Hyper-V guest `csfarm-golden`.

Этот файл описывает **текущий** живой контур. Старый текст про активный keremberke `best.onnx` 12 MB и shot ~1.4 с больше не истина. Исторические датасеты и human-train оставлены в конце как архив.

Обучение не запускалось в этом прогоне. Train только когда скажешь «хватит кадров».

---

## 1. Как сейчас работает зрение

```
CS2 (guest, клиент ~1280x720)
  -> guest-shot-loop.ps1 CopyFromScreen JPEG (файл всё ещё live.png)
  -> guest-agent.mjs GET /shot (свежий файл, wait ~40 ms fresh / ~8 ms иначе)
  -> live-yolo.mjs на host пишет D:\FarmVMs\ops\vision\live.png
  -> python engine.py --loop (FARM_YOLO_FAST=1)
       letterbox 640, ONNX DirectML
       Priler cs2_yolov8m_640_augmented_v4
       conf 0.45, NMS iou 0.2
       без ByteTrack coast (бокс только если сеть видит)
       analyze_radar на том же кадре (self / стены / occupancy 32x32)
  -> frame.json + overlay-glass.png + preview.jpg
  -> teach :39210 (ETag, 304)
  -> guest-overlay.ps1 стекло 50 ms, StretchImage, Opacity 1
  -> preview.py окно CS2 AI Vision 1280x720
```

GSI (`self.json`) отдельно: карта, hp, round, alive. Это не YOLO.

Live-контур **больше не выкидывает радар**: FAST считает YOLO и миникарту. Шаблоны меню и motion blobs по-прежнему только полный `analyze`.

### Файлы


| Шаг     | Где                                 | Что                                                                                  |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| Захват  | `worker/vm/guest-shot-loop.ps1`     | Постоянный PS, JPEG q~80 как live.png. Hide-Glass **нет** в hot path (мерцание HUD). |
| HTTP    | `worker/vm/guest-agent.mjs` `/shot` | Читает файл loop, не spawnSync.                                                      |
| Тяга    | `worker/live-yolo.mjs`              | GET `/shot` -> host live.png.                                                        |
| Worker  | `worker/cv-worker.mjs`              | `engine.py --loop`. Env веса Priler onnx/pt.                                         |
| Infer   | `worker/cv/yolo_infer.py`           | ORT DML. Имена c/ch/t/th. Фильтр `_in_radar`.                                        |
| Рисунок | `worker/cv/engine.py` `paint_dets`  | Цвета Priler, thickness 2. JPEG preview 75.                                          |
| Превью  | `worker/cv/preview.py`              | Отдельный процесс, только показ latest.                                              |
| Стекло  | `worker/vm/guest-overlay.ps1`       | ETag, double-buffer, без Zoom.                                                       |
| Лаба    | `worker/cv/lab.html`                | Разметка + `/preview.jpg` + toggle overlay-off.flag.                                 |


Кнопка «новый кадр»: POST `/api/refresh` -> `/see` затем `/shot`. Live-yolo бьёт только `/shot`.

### Формат

- Гость: JPEG в имени `live.png` (OpenCV читает по сигнатуре).
- Overlay glass: PNG compression 1, atomic `stem.tmp.suffix`.
- Host preview: `preview.jpg`.
- Сеть: 640x640 letterbox, RGB FP32.



### Модель в RAM

Порядок: `FARM_YOLO_ONNX` иначе `D:\FarmVMs\ops\yolo\priler-src\yolov8\cs2_yolov8m_640_augmented_v4.onnx`.

Дефолт cv-worker:

- onnx ~99 MB, pt ~50 MB
- классы CS2 Priler: c, ch, t, th
- backend живой: DirectML RX 7600 (`dml`)
- CUDA нет (torch CPU)

Fallback Ultralytics `.pt` только если нет onnx.

### Пороги (как автор, не 0.7 в hot path)

Priler исходник: conf 0.7 iou 0.2. У нас live: **conf 0.45** (`FARM_YOLO_CONF`), iou **0.2**. Clamp 0.06-0.35 снят. Трекер не держит призрак 0.28 с.

### Overlay / мерцание

Hide-Glass ShowWindow каждый кадр мигал низ HUD. Сейчас захват поверх стекла. YOLO может видеть свои рамки; фильтр радара и overlay-off в лабе. Смотреть детектор: окно **CS2 AI Vision** или `/preview.jpg`.

---



## 2. Что от YOLO, что нет

**YOLO:** `dets[]` name/team/tid/head/conf/x,y,w,h % кадра, label, side. `backend`, `ms`, `frame_age_ms`.

**Радар OpenCV (тот же кадр):** self cyan, facing, red foes, yellow allies, wall_ahead, occupancy 32x32. Кроп жёлтого кольца миникарты.

**Не зрение:** GSI map/hp/weapon. Navmesh CS2 в репо **нет**.

---



## 3. Скорость (актуально)

Старый PNG one-shot ~1.4 с/кадр. После JPEG loop (см. `VISION_CAPTURE_OPTIMIZATION.md`): HTTP `/shot` mean ~65 ms, unique FPS ~15 на профиле 100 кадров.

YOLO DML yolov8m 640: порядка 40-120 ms на кадр (не 16 ms yolov8n). Узкое место больше не spawn PowerShell.

Стекло: poll 50 ms, картинка меняется когда host переписал PNG и ETag.

---



## 4. Лаба «Зрение»


| Функция            | Статус                                           |
| ------------------ | ------------------------------------------------ |
| Кадр / бокс / save | работает, train не стартует                      |
| Overlay YOLO выкл  | overlay-off.flag, lab JPEG чистый, preview живой |
| Превью детектора   | `/preview.jpg` poll                              |
| Delete sample      | нет API                                          |
| Train кнопка       | опасно: может трогать веса, не жать без запроса  |
| Метрики mAP в UI   | нет                                              |


Этап «Готово» только после теста в раунде, не по числу файлов.

---



## 5. СОХРАНИТЬ / не трогать

**СОХРАНИТЬ:** Priler onnx DML, JPEG loop, стекло без Hide-Glass, preview процесс, guest-only input, Hyper-V.

**НЕ ДЕЛАТЬ активным:** human nc=11 train, keremberke как prod, ByteTrack coast.

**СЛЕДУЮЩИЙ НАВЫК:** ходьба, `docs/WALK_AUDIT.md`. Прицел Priler (`aiming/`) не подключать, пока ходьба не пройдёт тест в VM.

---



## Архив датасетов (не активные веса)

- `D:\FarmVMs\ops\yolo\best.pt` = keremberke seed, **не** hot path.
- human ~80 картинок, мало T.
- priler.yaml когда-то train=val, метрики врали.
- Независимый CS2 holdout для цифр P/R: нет.

