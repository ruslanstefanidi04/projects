# Hierarchical skills

Perception (YOLO players + GSI HUD) is not the policy.

Planner picks a skill. Default FSM stays baseline.

Classic controllers (no new net): PID visual servo, kalman on yolo boxes, A* on radar occupancy, waypoint follow, fire, strafe.
YOLO detects only. Stale frame (age_ms > 800) stops aim/fire. Guest-only input unchanged.

Activate in teach train: pending walk or skills, then confirm. Default stays FSM.

Do not train YOLO on turn/climb/look (use=command).
