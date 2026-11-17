# Этап 1: ускорение доставки кадров (зрение)

Дата: 2026-09-18. VM `csfarm-golden` была доступна (`/ping` ok, процессы cs2+steam). YOLO, веса, классы, confidence, Hyper-V сеть и VPN не менялись.

Точка отката репозитория: git `7d04215cf506c534ce799048fd7a8e72bccacc64`. Откат захвата: env `FARM_SHOT_LEGACY=1` на guest-agent плюс `worker/vm/guest-shot.oneshot.ps1` (копия one-shot PNG).

Профили: `D:\FarmVMs\ops\vision\shot-profile-before.json`, `shot-profile-after.json` (по 100 GET `/shot?fresh=1`).

---

## 1. Причина исходной задержки

Замеры one-shot (n=100, unique frames=100, HTTP errors=0):

| этап | mean ms | median | p95 | max |
|---|---:|---:|---:|---:|
| GET /shot целиком (HTTP) | 1225.6 | 1314 | 2034 | 2739 |
| spawnSync PowerShell (`ps_ms`) | 723.2 | 706 | 869 | 923 |
| внутри скрипта (`ms_total`) | 383.6 | 374 | 479 | 517 |
| overlay/CIM check | 11.1 | 11 | 17 | 28 |
| CopyFromScreen | 47.4 | 44 | 66 | 109 |
| PNG encode | 61.2 | 61 | 81 | 112 |
| размер тела | 1.94 MB | 1.97 MB | 2.20 MB | 2.36 MB |
| YOLO ms (когда успел cv-worker) | 17.4 (n=62) | 15 | 30 | 41.9 |
| возраст файла к концу infer | 50.9 | 36 | 137 | 224 |
| unique FPS | 0.82 |  |  |  |

Следствия из цифр, не из догадок:

1. **PowerShell на каждый кадр.** `ps_ms` 723 минус `ms_total` 384 ≈ **340 ms холодный старт** powershell.exe + загрузка скрипта.
2. **Add-Type / сборка .NET каждый кадр** сидит внутри `ms_total` (copy+encode+overlay ≈ 120 ms, остаток ≈ 260 ms на bootstrap скрипта).
3. **Тяжёлый PNG.** 1.9 MB. HTTP минус `ps_ms` ≈ **500 ms** на передачу+приём.
4. CopyFromScreen **не** главный (47 ms). Overlay CIM **не** главный (11 ms) в этом прогоне (оверлей уже жил, CIM почти не запускался).
5. Очередь `/shot`: при `stale>180` каждый живой live-yolo ждал полный spawnSync. Конкурирующие запросы в этом профиле отключались (`fresh=1`, live-yolo в момент before не отвечал на pid 17328).

YOLO DirectML не узкое место (median ~15 ms). Python worker постоянный.

---

## 2. Изменённые файлы

| файл | зачем |
|---|---|
| `worker/vm/guest-shot-loop.ps1` | новый постоянный захват, JPEG, reuse Bitmap/Graphics |
| `worker/vm/guest-shot.ps1` | тайминги в `shot.json` для one-shot / legacy |
| `worker/vm/guest-shot.oneshot.ps1` | копия one-shot для отката |
| `worker/vm/guest-agent.mjs` | loop-процесс как у input; `/shot` читает свежий файл; заголовки таймингов; `?fresh=1`; отказ от крошечных буферов |
| `worker/farm.mjs` | деплой loop + oneshot |
| `worker/cv/engine.py` | поле `yolo.frame_age_ms` (возраст live.png), без смены модели |

Не трогались: веса, `yolo_infer.py` пороги/классы, Hyper-V, VPN, FSM/input.

---

## 3. Выбранный способ

Минимальное изменение с измеримым эффектом:

1. Постоянный PowerShell (`guest-shot-loop.ps1`), по образцу `guest-input.ps1`. Без Windows Graphics Capture и без Desktop Duplication (лишние зависимости, CopyFromScreen уже 47 ms).
2. JPEG через `ImageFormat.Jpeg` + MemoryStream, файл по-прежнему `live.png` (OpenCV читает JPEG по сигнатуре). Имя не меняли, чтобы не трогать engine path.
3. Один Bitmap/Graphics на размер клиента. Overlay CIM раз в 4 с, не каждый кадр. DwmFlush убран в loop.
4. `/shot` больше не делает spawnSync, если loop жив. Ждёт новый `mtime` (до ~220 ms при `fresh=1`).
5. Откат: `FARM_SHOT_LEGACY=1` на агенте снова spawnSync `guest-shot.ps1`.

Сжатие с потерями: на одном кадре 1280x720 `detect_bgr` PNG vs JPEG q80 (перекодировка того же BGR) дал **n=1, класс `th` на обоих**. PNG infer 1695 ms (прогрев DML после restart cv-worker), JPEG 25.5 ms. Это не полный holdout, но детекция не обнулилась.

---

## 4. Таблица до / после

Одинаковое разрешение клиента ~1280x720, 100 последовательных `/shot?fresh=1`, host пишет `live.png`, ждёт новый `frame.json`.

| метрика | до (PNG one-shot) | после (JPEG loop) |
|---|---:|---:|
| unique frames | 100 / 100 | 99 / 100 (1 повтор MD5) |
| unique FPS | 0.82 | 15.21 |
| HTTP mean / p95 / max ms | 1225.6 / 2034 / 2739 | 65.1 / 110 / 185 |
| spawn/wait `ps_ms` mean | 723.2 | 51.0 |
| CopyFromScreen mean ms | 47.4 | 30.9 |
| encode mean ms | 61.2 PNG | 18.2 JPEG |
| shot_total mean ms | 383.6 | 62.4 |
| размер mean | 1 936 556 B | 113 741 B |
| infer_wait mean / p95 ms | 1322.8 / 2186 | 151.9 / 255 |
| YOLO mean / median / p95 / max ms | 17.4 / 15 / 30 / 41.9 (n=62) | 42.6 / 19.5 / 53.5 / **1907** (n=98) |
| возраст кадра к infer mean / p95 ms | 50.9 / 137 | 33.3 / 73 |
| HTTP errors | 0 | 0 |

Пояснения:

- После: max YOLO 1907 ms = прогрев DirectML после `restartCvWorker` во время прогона. Median 19.5 близок к 15.7 из аудита.
- После: min bytes 97 = один битый/пустой файл в сотне. В агент добавлен повтор чтения если `<1000` байт (после этой сотни).
- FPS 15 это частота **уникальных ответов profiler** (HTTP+запись+ожидание infer ~150 ms). Сам loop спит до 12 ms плюс ~62 ms работы ≈ 13 кадр/с захвата; не 60 fps.
- Не сравнивали 640×360. Разрешение то же 1280×720.

Нагрузка CPU/GPU host/guest perfmon: **не снималась**. НЕИЗВЕСТНО численно. Качественно: пропали 100 запусков powershell.exe/с.

---

## 5. Что проверено в реальной VM

Проверено:

- `/ping` CSFARM-GOLDEN, cs2+steam.
- 100 one-shot PNG и 100 loop JPEG через LAN `10.250.0.10:39200`.
- После деплоя заголовок `content-type: image/jpeg`, `via: loop-jpeg`, ~140 KB.
- Teach `http://127.0.0.1:39210/live.png` и `/overlay-glass.png` отвечают 200.
- YOLO на host читает JPEG-байты в `live.png` (`backend dml`, n=1 на контрольном кадре).
- Запущен host `live-yolo.mjs` pid 15044, чтобы панель снова тянула кадры.

Не утверждаю ручной просмотр vmconnect «рамка на боте» в этом этапе: профилер не смотрел глазами в консоль VM. Overlay-процесс в guest не останавливали специально.

Остановка loop: убийство guest-agent или `Stop-Process` powershell с `guest-shot-loop` в CommandLine. Новый агент перед стартом loop убивает старые loop.

---

## 6. Тесты

`cd worker; npm test` : **35/35 pass**.

---

## 7. Что осталось

- Захват всё ещё GDI CopyFromScreen, не WGC/DDAPI.
- JPEG default quality (не Encoder quality=80). Один кадр 97 байт в after.
- 1 повтор MD5 из 100 (статичный кадр или коллизия ожидания mtime).
- Прогрев DML после рестарта cv-worker даёт один очень длинный infer.
- Overlay в кадр: SourceCopy без CaptureBlt, стекло layered. Не мерили IoU боксов vs пиксели в этом этапе.
- live-yolo по-прежнему пишет файл на диск (два раза live+shot). Память без файла не делали.

---

## 8. Как откатить

1. На guest-agent: `FARM_SHOT_LEGACY=1`, перезапуск агента. Снова spawnSync `guest-shot.ps1` (PNG one-shot с таймингами).
2. Либо вернуть `guest-shot.oneshot.ps1` как `guest-shot.ps1` и агент до loop (`git show 7d04215:worker/vm/guest-agent.mjs` не содержит loop; рабочая копия агента до этапа 1 была с spawnSync).
3. Убить `guest-shot-loop` в VM.
4. Git restore point всего репо: `7d04215` (там нет текущих lab/yolo правок; полный откат репо сотрёт и другие WIP). Для **только захвата** достаточно legacy env + oneshot файл.

Не включать `FARM_SHOT_LEGACY` без нужды: вернёт ~1.2 с/кадр.
