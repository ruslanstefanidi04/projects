# Phase 10 — pretrained path (2026-09-17)

Русский отчёт. Статусы не путать: VERIFIED только если запускали.

## 1. Проекты

- A CS-RL-Agent (GitHub, MIT)
- B RekaAI/CS2-10k (HF)
- C EgoCS-400K (GitHub)
- D TeaPearce CS:GO BC (HF + Behavioural_Cloning)
- E Open Pixel2Play (GitHub + HF)

## 2. Веса

- cs-rl: YOLO `326_head_body.pt` ~14MB; IQL `p_network.pth` ~283KB + q/v. **DOCUMENTED**. Не грузили.
- TeaPearce: `trained_models.zip` 384MB pickle. **DOCUMENTED**. Не скачивали.
- Open-P2P: семейство ~29GB. **DOCUMENTED**. Не скачивали.
- Наш linear BC: файл `D:/FarmVMs/ops/bc/model.json` если есть. Иначе fallback FSM.

## 3. Что запускали

- **VERIFIED:** `node --test` worker (policy-router, dataset-adapter, прежний BC/obs).
- **Не VERIFIED:** torch IQL, TeaPearce pickle, P2P Recap, CS2-10k, EgoCS full dump.

## 4. Почему не грузили чужие веса

- `.pth` / pickle: произвольный код при `torch.load` / pickle.
- cs-rl: host `PressKey`, occupancy 30×30, CUDA, свой GSI:3000, не guest-input.
- TeaPearce: CS:GO 2021, host screenshot + SendInput.
- P2P: Recap, WSL, класс H100, игры не CS2.
- CS2-10k: Valve takedown.

## 5. Датасеты

- CS2-10k: **BROKEN** (снят).
- EgoCS: 2 sample rounds **DOCUMENTED**; полный 400k **UNVERIFIED**. Адаптер `fromEgoTick` есть, полный импорт нет.
- TeaPearce hdf5 ~748GB: не качали. Формат CS:GO 16×9, не наш traj.
- Свои `traj.jsonl`: пригодны для BC после записей с mouse dx/dy.

## 6. Интеграция

- `FARM_POLICY` = `fsm` (default) | `bandit` | `bc` | имена pretrained (пока stub → FSM).
- Один `choosePrefer` → прежний `decide` → `action-ctl` → guest-input.
- Dataset adapter без порчи исходников.

## 7. Файлы

- `docs/PRETRAINED_CANDIDATES.md`
- `docs/PRETRAINED_PHASE10.md`
- `worker/policy-router.mjs`
- `worker/dataset-adapter.mjs`
- `worker/bc.mjs` (`loadBcModel`)
- `worker/fsm/loop.mjs`
- `worker/test/core.test.mjs`

## 8. Тесты

Локальный `npm test` в `worker/`. Live CS2 E2E pretrained **не** гоняли.

## 9. Метрики

Новых latency/nav для чужой policy нет (нет VERIFIED inference). Старый snapshot цикла 8–12s остаётся проблемой стека, не модели.

## 10. Дальше

1. Записать свои demo + `FARM_POLICY=bc` после `model.json`.
2. При GPU и изолированной VM: smoke `simulate.py` cs-rl **на fy_snow**, не вшивать в farm пока dt и input не на guest.
3. EgoCS samples → adapter → train split по episode_id.
4. Не качать 29GB / 748GB без формат-smoke.

## Ответ на главный вопрос

**Работающего pretrained автономного агента нет.** В бою по умолчанию всё ещё **FSM + правила + contextual bandit**. Linear BC и слоты внешних моделей подключены, но внешние веса **не загружены и не прогнаны в CS2**.
