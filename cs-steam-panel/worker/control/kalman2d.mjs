// constant-velocity kalman on screen percent (x,y). public-domain math (kalman 1960).
// stand-in for opencv tracker: we already have yolo boxes, no extra native dep.
export function createKalman2d({ q = 8, r = 18 } = {}) {
  let x = [50, 42, 0, 0];
  let p = [
    [80, 0, 0, 0],
    [0, 80, 0, 0],
    [0, 0, 40, 0],
    [0, 0, 0, 40]
  ];
  let ok = false;

  function reset() {
    x = [50, 42, 0, 0];
    p = [
      [80, 0, 0, 0],
      [0, 80, 0, 0],
      [0, 0, 40, 0],
      [0, 0, 0, 40]
    ];
    ok = false;
  }

  function predict(dt = 0.05) {
    const t = Math.max(0.008, Number(dt) || 0.05);
    x = [x[0] + x[2] * t, x[1] + x[3] * t, x[2], x[3]];
    const f = [
      [1, 0, t, 0],
      [0, 1, 0, t],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    p = add(mul(mul(f, p), trans(f)), [
      [q, 0, 0, 0],
      [0, q, 0, 0],
      [0, 0, q, 0],
      [0, 0, 0, q]
    ]);
    return state();
  }

  function update(mx, my) {
    const z = [Number(mx), Number(my)];
    if (!Number.isFinite(z[0]) || !Number.isFinite(z[1])) return lost();
    const h = [
      [1, 0, 0, 0],
      [0, 1, 0, 0]
    ];
    const y = [z[0] - x[0], z[1] - x[1]];
    const s = add(mul(mul(h, p), trans(h)), [
      [r, 0],
      [0, r]
    ]);
    const k = mul(mul(p, trans(h)), inv2(s));
    x = [
      x[0] + k[0][0] * y[0] + k[0][1] * y[1],
      x[1] + k[1][0] * y[0] + k[1][1] * y[1],
      x[2] + k[2][0] * y[0] + k[2][1] * y[1],
      x[3] + k[3][0] * y[0] + k[3][1] * y[1]
    ];
    const i4 = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    p = mul(sub(i4, mul(k, h)), p);
    ok = true;
    return state();
  }

  function lost() {
    ok = false;
    return state();
  }

  function state() {
    return { x: x[0], y: x[1], vx: x[2], vy: x[3], ok };
  }

  return { predict, update, lost, reset, state };
}

function mul(a, b) {
  const o = [];
  for (let i = 0; i < a.length; i++) {
    o[i] = [];
    for (let j = 0; j < b[0].length; j++) {
      let s = 0;
      for (let k = 0; k < b.length; k++) s += a[i][k] * b[k][j];
      o[i][j] = s;
    }
  }
  return o;
}

function trans(a) {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

function add(a, b) {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]));
}

function sub(a, b) {
  return a.map((row, i) => row.map((v, j) => v - b[i][j]));
}

function inv2(m) {
  const d = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  const id = Math.abs(d) < 1e-9 ? 1e-9 : d;
  return [
    [m[1][1] / id, -m[0][1] / id],
    [-m[1][0] / id, m[0][0] / id]
  ];
}
