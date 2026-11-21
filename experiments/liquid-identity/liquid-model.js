// Liquid Identity — DOM-free material model.
//
// An authored "US" monogram is sampled into particles, each with a home
// position on the letterforms. Home springs hold the mark together; a pointer
// "magnet" captures nearby liquid and pulls it into beads and threads; short-
// range neighbour forces (only on liquid that has been freed from its home)
// give it surface-tension-like cohesion. Releasing restores the home springs,
// so the initials reconstruct. This is an art-directed illustration, not a
// validated ferrofluid or free-surface simulation.
//
// Units: model space, y down. Bounds 1.6 x 1.0 with an outer margin.

const WIDTH = 1.6;
const HEIGHT = 1.0;
const MARGIN = 0.32;
const STROKE = 0.13; // ink width of the letterforms
const MAX_SPEED = 6;
const SUBSTEP = 1 / 180;
const MAX_FRAME = 1 / 30;

function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- monogram
// Letter boxes are the outer ink extents of each glyph.
export const LETTER_BOXES = Object.freeze({
  U: Object.freeze({ x: 0.12, y: 0.14, w: 0.62, h: 0.72 }),
  S: Object.freeze({ x: 0.86, y: 0.14, w: 0.62, h: 0.72 }),
});

function uCenterline() {
  const { x, y, w, h } = LETTER_BOXES.U;
  const half = STROKE / 2;
  const lx = x + half;
  const rx = x + w - half;
  const r = (rx - lx) / 2;
  const cx = (lx + rx) / 2;
  const cy = y + h - half - r;
  const top = y + half;
  const pts = [];
  const seg = (ax, ay, bx, by, n) => {
    for (let i = 0; i < n; i += 1) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  };
  seg(lx, top, lx, cy, 40);
  for (let i = 0; i < 80; i += 1) {
    const a = Math.PI - (Math.PI * i) / 80; // left -> bottom -> right (y down)
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  seg(rx, cy, rx, top, 40);
  pts.push([rx, top]);
  return pts;
}

function sCenterline() {
  const { x, y, w, h } = LETTER_BOXES.S;
  const half = STROKE / 2;
  const rx = (w - STROKE) / 2;
  const ry = (h - STROKE) / 4;
  const cx = x + w / 2;
  const cyU = y + half + ry;
  const cyL = cyU + 2 * ry;
  const pts = [];
  const deg = Math.PI / 180;
  // upper bowl: from top-right terminal, over the top, down the left, to the spine
  for (let i = 0; i <= 90; i += 1) {
    const a = (32 + ((270 - 32) * i) / 90) * deg;
    pts.push([cx + rx * Math.cos(a), cyU - ry * Math.sin(a)]);
  }
  // lower bowl: from the spine, round the right, along the bottom, to the terminal
  for (let i = 1; i <= 90; i += 1) {
    const a = (90 - ((90 + 148) * i) / 90) * deg;
    pts.push([cx + rx * Math.cos(a), cyL - ry * Math.sin(a)]);
  }
  return pts;
}

function sampleStroke(line, spacing, rows, jitter, rand, out) {
  const cum = [0];
  for (let i = 1; i < line.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.round(total / spacing));
  let k = 1;
  for (let s = 0; s <= n; s += 1) {
    const at = (total * s) / n;
    while (k < cum.length - 1 && cum[k] < at) k += 1;
    const seg = cum[k] - cum[k - 1] || 1;
    const t = (at - cum[k - 1]) / seg;
    const [ax, ay] = line[k - 1];
    const [bx, by] = line[k];
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const stagger = s % 2 ? 0.5 : 0;
    for (let r = 0; r < rows; r += 1) {
      const off = ((r + stagger) / (rows - 1 + (stagger ? 1 : 0)) - 0.5) * (STROKE - 0.05);
      out.push([
        px + nx * off + (rand() - 0.5) * jitter,
        py + ny * off + (rand() - 0.5) * jitter,
      ]);
    }
  }
}

function buildHomes(rand) {
  const out = [];
  sampleStroke(uCenterline(), 0.024, 3, 0.006, rand, out);
  sampleStroke(sCenterline(), 0.024, 3, 0.006, rand, out);
  return out;
}

// ---------------------------------------------------------------- model
export function createLiquidModel(options = {}) {
  const seed0 = Number.isFinite(options.seed) ? options.seed : 1;
  const homes = buildHomes(mulberry32(0x5eed)); // the mark itself is authored, not random
  const count = homes.length;

  const homeX = new Float32Array(count);
  const homeY = new Float32Array(count);
  homes.forEach(([hx, hy], i) => { homeX[i] = hx; homeY[i] = hy; });

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const hold = new Float32Array(count); // home-spring weight, 0..1
  const grip = new Float32Array(count); // magnet capture strength, 0..1

  const params = {
    homeK: 70,
    damping: 7.5,
    magnetK: 70,
    magnetReach: 0.32, // pull saturates beyond this distance
    grabRadius: 0.16,
    sweepRadius: 0.07,
    pairH: 0.055,
    pairRest: 0.026,
    pairK: 320,
    cohesion: 22,
    viscosity: 10,
    recover: 2.6, // 1/s, how quickly released liquid re-grips its home
  };
  const base = { ...params };

  const pointer = { active: false, x: 0, y: 0 };
  let phase = 'assembling';
  let freeTimer = 0; // keeps hold low briefly after a splash
  let playCount = 0;
  let seed = seed0;

  const cell = params.pairH;
  const cols = Math.ceil((WIDTH + 2 * MARGIN) / cell) + 1;
  const rows = Math.ceil((HEIGHT + 2 * MARGIN) / cell) + 1;
  const heads = new Int32Array(cols * rows);
  const next = new Int32Array(count);
  const ax = new Float32Array(count);
  const ay = new Float32Array(count);

  const clampX = (v) => Math.min(WIDTH + MARGIN, Math.max(-MARGIN, v));
  const clampY = (v) => Math.min(HEIGHT + MARGIN, Math.max(-MARGIN, v));

  function varyMaterial(rand) {
    const j = (amt) => 1 + (rand() - 0.5) * 2 * amt;
    params.viscosity = base.viscosity * j(0.12);
    params.pairK = base.pairK * j(0.1);
    params.cohesion = base.cohesion * j(0.15);
    params.recover = base.recover * j(0.12);
  }

  function scatter(s) {
    seed = s;
    const rand = mulberry32(Math.imul(s | 0, 2654435761) ^ 0x9e37);
    varyMaterial(rand);
    const drops = 11 + Math.floor(rand() * 6);
    const cx = new Float32Array(drops);
    const cy = new Float32Array(drops);
    for (let d = 0; d < drops; d += 1) {
      const i = Math.floor(rand() * count);
      const ang = rand() * Math.PI * 2;
      const dist = 0.04 + rand() * 0.12;
      cx[d] = homeX[i] + Math.cos(ang) * dist;
      cy[d] = homeY[i] + Math.sin(ang) * dist;
    }
    for (let i = 0; i < count; i += 1) {
      let best = 0;
      let bd = Infinity;
      for (let d = 0; d < drops; d += 1) {
        const dd = (homeX[i] - cx[d]) ** 2 + (homeY[i] - cy[d]) ** 2;
        if (dd < bd) { bd = dd; best = d; }
      }
      const pull = 0.72 + rand() * 0.12;
      x[i] = homeX[i] + (cx[best] - homeX[i]) * pull + (rand() - 0.5) * 0.02;
      y[i] = homeY[i] + (cy[best] - homeY[i]) * pull + (rand() - 0.5) * 0.02;
      vx[i] = 0;
      vy[i] = 0;
      hold[i] = 0.12;
      grip[i] = 0;
    }
    pointer.active = false;
    freeTimer = 0.25;
    phase = 'assembling';
  }

  function settle() {
    for (let i = 0; i < count; i += 1) {
      x[i] = homeX[i]; y[i] = homeY[i];
      vx[i] = 0; vy[i] = 0;
      hold[i] = 1; grip[i] = 0;
    }
    pointer.active = false;
    freeTimer = 0;
    phase = 'rest';
  }

  function capture(px, py, radius, upgrade = true) {
    for (let i = 0; i < count; i += 1) {
      if (!upgrade && grip[i] > 0) continue;
      const d = Math.hypot(x[i] - px, y[i] - py);
      if (d < radius) {
        // a fully gripped core becomes the bead under the hand; the ring
        // around it keeps part of its home spring and strings into a thread
        const u = d / radius;
        const s = u < 0.42 ? 1 : 0.15 + 0.6 * ((1 - u) / 0.58) ** 1.2;
        if (s > grip[i]) grip[i] = s;
      }
    }
  }

  function pointerDown(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    pointer.active = true;
    pointer.x = clampX(px);
    pointer.y = clampY(py);
    capture(pointer.x, pointer.y, params.grabRadius);
    phase = 'dragging';
  }

  function pointerMove(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    pointer.x = clampX(px);
    pointer.y = clampY(py);
    // sweeping across the mark picks up fresh liquid; it never tightens the
    // grip on liquid already strung out behind the hand
    if (pointer.active) capture(pointer.x, pointer.y, params.sweepRadius, false);
  }

  function pointerUp() {
    pointer.active = false;
    grip.fill(0);
    if (phase === 'dragging') phase = 'reforming';
  }

  function poke(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    const radius = 0.24;
    for (let i = 0; i < count; i += 1) {
      const dx = x[i] - px;
      const dy = y[i] - py;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      const angle = i * 2.399963;
      const ux = d > 1e-6 ? dx / d : Math.cos(angle);
      const uy = d > 1e-6 ? dy / d : Math.sin(angle);
      const impulse = 2.4 * (1 - d / radius);
      vx[i] += ux * impulse;
      vy[i] += uy * impulse;
    }
    phase = 'ripple';
  }

  function play() {
    // splash: alternate a radial burst and a swirl
    playCount += 1;
    const rand = mulberry32((seed + playCount * 977) >>> 0);
    const i0 = Math.floor(rand() * count);
    const swirl = playCount % 2 === 0;
    const ox = swirl ? homeX[i0] : WIDTH / 2;
    const oy = swirl ? homeY[i0] : HEIGHT / 2;
    pointerUp();
    for (let i = 0; i < count; i += 1) {
      const dx = x[i] - ox;
      const dy = y[i] - oy;
      const d = Math.hypot(dx, dy) || 1e-3;
      const fall = 0.6 + 0.4 * Math.exp(-d * 2);
      const speed = (1.6 + rand() * 1.4) * fall;
      const ux = dx / d;
      const uy = dy / d;
      vx[i] += (swirl ? -uy * 1.2 + ux * 0.35 : ux) * speed;
      vy[i] += (swirl ? ux * 1.2 + uy * 0.35 : uy) * speed;
      hold[i] = Math.min(hold[i], 0.08);
    }
    freeTimer = 0.3;
    phase = 'splash';
    return swirl ? 'swirl' : 'burst';
  }

  function buildGrid() {
    heads.fill(-1);
    for (let i = 0; i < count; i += 1) {
      const gx = Math.floor((x[i] + MARGIN) / cell);
      const gy = Math.floor((y[i] + MARGIN) / cell);
      const g = gy * cols + gx;
      next[i] = heads[g];
      heads[g] = i;
    }
  }

  function substep(h) {
    const p = params;
    if (freeTimer > 0) freeTimer = Math.max(0, freeTimer - h);
    const rec = 1 - Math.exp(-p.recover * h);
    const gripRate = 1 - Math.exp(-12 * h);
    for (let i = 0; i < count; i += 1) {
      if (grip[i] > 0) {
        // weakly gripped liquid keeps part of its home spring, so it strings
        // out between the mark and the bead instead of all following the hand
        hold[i] += (0.85 * (1 - grip[i]) ** 1.4 - hold[i]) * gripRate;
      } else if (freeTimer <= 0) {
        hold[i] += (1 - hold[i]) * rec;
      }
    }

    ax.fill(0);
    ay.fill(0);
    buildGrid();
    const H = p.pairH;
    const H2 = H * H;
    for (let i = 0; i < count; i += 1) {
      const free = 1 - hold[i];
      if (free < 0.02) continue; // anchored liquid ignores neighbours: exact reconstruction
      const gx = Math.floor((x[i] + MARGIN) / cell);
      const gy = Math.floor((y[i] + MARGIN) / cell);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = gx + ox;
          const cy = gy + oy;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          for (let j = heads[cy * cols + cx]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const d2 = dx * dx + dy * dy;
            if (d2 >= H2 || d2 < 1e-12) continue;
            const d = Math.sqrt(d2);
            const q = 1 - d / H;
            const nx = dx / d;
            const ny = dy / d;
            // stiff when crowded (keeps volume), gentle when stretched (surface
            // tension-like cohesion that lets threads neck into beads)
            let f = d < p.pairRest
              ? (p.pairK * (d - p.pairRest)) / p.pairRest * 0.12
              : (p.cohesion * q * (d - p.pairRest)) / H;
            f += p.viscosity * q * ((vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny);
            ax[i] += f * nx * free;
            ay[i] += f * ny * free;
          }
        }
      }
    }

    const reach = p.magnetReach;
    for (let i = 0; i < count; i += 1) {
      ax[i] += p.homeK * hold[i] * (homeX[i] - x[i]);
      ay[i] += p.homeK * hold[i] * (homeY[i] - y[i]);
      if (pointer.active && grip[i] > 0) {
        let dx = pointer.x - x[i];
        let dy = pointer.y - y[i];
        const d = Math.hypot(dx, dy);
        if (d > reach) { dx *= reach / d; dy *= reach / d; }
        ax[i] += p.magnetK * grip[i] * dx;
        ay[i] += p.magnetK * grip[i] * dy;
      }
      ax[i] -= p.damping * vx[i];
      ay[i] -= p.damping * vy[i];

      let nvx = vx[i] + ax[i] * h;
      let nvy = vy[i] + ay[i] * h;
      if (!Number.isFinite(nvx) || !Number.isFinite(nvy)) { nvx = 0; nvy = 0; }
      const sp = Math.hypot(nvx, nvy);
      if (sp > MAX_SPEED) { nvx *= MAX_SPEED / sp; nvy *= MAX_SPEED / sp; }
      vx[i] = nvx;
      vy[i] = nvy;
      let nx = x[i] + nvx * h;
      let ny = y[i] + nvy * h;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) { nx = homeX[i]; ny = homeY[i]; }
      if (nx < -MARGIN || nx > WIDTH + MARGIN) { nx = clampX(nx); vx[i] *= -0.3; }
      if (ny < -MARGIN || ny > HEIGHT + MARGIN) { ny = clampY(ny); vy[i] *= -0.3; }
      x[i] = nx;
      y[i] = ny;
    }
  }

  function metrics() {
    let sum = 0;
    let max = 0;
    let ke = 0;
    let captured = 0;
    let finite = true;
    for (let i = 0; i < count; i += 1) {
      const d = Math.hypot(x[i] - homeX[i], y[i] - homeY[i]);
      sum += d;
      if (d > max) max = d;
      ke += 0.5 * (vx[i] * vx[i] + vy[i] * vy[i]);
      if (grip[i] > 0) captured += 1;
      if (!Number.isFinite(d) || !Number.isFinite(vx[i]) || !Number.isFinite(vy[i])) finite = false;
    }
    return {
      meanDisplacement: sum / count,
      maxDisplacement: max,
      kinetic: ke / count,
      captured,
      finite,
      phase,
    };
  }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const frame = Math.min(dt, MAX_FRAME);
    const n = Math.max(1, Math.ceil(frame / SUBSTEP - 1e-9));
    for (let k = 0; k < n; k += 1) substep(frame / n);
    if (!pointer.active && phase !== 'rest') {
      const m = metrics();
      if (m.meanDisplacement < 0.004 && m.kinetic < 1e-5) phase = 'rest';
    }
  }

  function reset(s = seed + 1) {
    scatter(Number.isFinite(s) ? s : seed + 1);
  }

  scatter(seed0);

  return {
    count,
    x, y, vx, vy, homeX, homeY, hold, grip,
    bounds: { width: WIDTH, height: HEIGHT, margin: MARGIN },
    letterBoxes: LETTER_BOXES,
    stroke: STROKE,
    // surface rendering: smooth compact kernel radius and iso-threshold,
    // chosen so the settled particles draw exactly the authored stroke width
    kernel: 0.055,
    threshold: 0.6,
    maxSpeed: MAX_SPEED,
    params,
    pointer,
    get phase() { return phase; },
    get seed() { return seed; },
    step, settle, reset, play, poke, metrics,
    pointerDown, pointerMove, pointerUp,
  };
}
