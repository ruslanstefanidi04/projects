# CS2 Agent Lab: ходьба и карта

Дата: 2026-09-18. После сводки зрения.

## Что в гитах, которые кидал

### Priler/csgobot (https://github.com/Priler/csgobot)

Дерево `main`: grabbers, detectors/yolov8, aiming (fov_mouse, recoil, target_selector), controls/mouse+keyboard, preview. **Нет** navmesh, A*, миникарты, WASD-маршрута. Спиздить оттуда для ходьбы нечего. Зрение оттуда уже взято. Aim/shoot не подключаем на этом этапе.

### wyhong3103/cs-rl-agent

Есть occupancy с HUD: кроп миникарты, gray, `threshold(100)`, erode 5x5, ресайз в сетку, плюс GSI/console xyz на `fy_snow`. Политика IQL ходит WASD. Автор сам пишет, что играет слабо. Navmesh CS2 нет. Occupancy-порог **скопирован** в `engine.py` `analyze_radar`.

### Наше

Нет `.nav` / геометрии карты в репо. GSI CS2 часто без xyz. Цель в лабе кликается по кропу радара.

Схема:

```
live.png
  -> analyze_radar (диск миникарты, self, стены)
  -> occupancy 32x32 в frame.json
  -> planWalk: A* (control/astar.mjs)
  -> keysFromRel: W/A/D + LOOK
  -> fsm/loop.mjs если lab.skill=walk confirmed
  -> guest /input
```

Пока `FARM_YOLO_FAST=1` не писал `radar` в frame.json, клик по радару в лабе был пустой. Это включено в FAST.

## Как проверить

1. Раунд с ботами, радар в кадре.
2. Лаба вкладка «Ходьба и карта»: «я на радаре» не «Нет данных», картинка `/radar.png`.
3. Клик цель, «рассчитать маршрут».
4. «запустить локальный тест» (confirm) при живом `farm play`.
5. Stop отпускает WASD.

Этап не «Готово», пока нет нескольких стартов без застревания.

## Не делать сейчас

- condebug / bind getpos как у wyhong (другой контракт guest).
- Скачивать IQL веса и звать их ходьбой.
- Aim Priler.
