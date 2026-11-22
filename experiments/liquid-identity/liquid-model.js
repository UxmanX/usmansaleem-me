// Liquid Identity — DOM-free material model.
//
// An authored "US" monogram is sampled into particles along curvature-balanced
// tracks with rounded fluid terminals. Home springs hold the mark together;
// a pointer magnet captures nearby liquid, resists and necks it into a taut
// hourglass filament, pinches off a glossy rolling bead past the yield stretch,
// and triggers a coalescing slosh ripple when released liquid whips back home.
// This is an art-directed material illustration, not a validated fluid solver.
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

function resamplePolyline(line, spacing, inset = 0) {
  const cum = [0];
  for (let i = 1; i < line.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const lo = Math.min(inset, total * 0.25);
  const hi = Math.max(lo, total - lo);
  const span = hi - lo;
  const n = Math.max(2, Math.round(span / spacing));
  const out = [];
  let k = 1;
  for (let s = 0; s <= n; s += 1) {
    const at = lo + (span * s) / n;
    while (k < cum.length - 1 && cum[k] < at) k += 1;
    const seg = cum[k] - cum[k - 1] || 1;
    const t = (at - cum[k - 1]) / seg;
    const [ax, ay] = line[k - 1];
    const [bx, by] = line[k];
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return out;
}

// Smooth curvature-balanced sampling: resampling each offset track by its own
// arc length prevents inner-bend bunching on the S, and semicircular fluid caps
// eliminate flat-cornered tube terminals.
function sampleRibbon(line, spacing, offDist, jitter, rand, letterId, out) {
  const dense = resamplePolyline(line, 0.004);
  const m = dense.length;
  const tx = new Float64Array(m);
  const ty = new Float64Array(m);
  const nx = new Float64Array(m);
  const ny = new Float64Array(m);
  for (let i = 0; i < m; i += 1) {
    const p0 = dense[Math.max(0, i - 1)];
    const p1 = dense[Math.min(m - 1, i + 1)];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    tx[i] = dx / len;
    ty[i] = dy / len;
    nx[i] = -ty[i];
    ny[i] = tx[i];
  }

  const push = (px, py) => {
    out.push([
      px + (rand() - 0.5) * jitter,
      py + (rand() - 0.5) * jitter,
      letterId,
    ]);
  };

  for (const [px, py] of resamplePolyline(dense, spacing)) push(px, py);

  for (const sign of [-1, 1]) {
    const offset = new Array(m);
    for (let i = 0; i < m; i += 1) {
      offset[i] = [dense[i][0] + nx[i] * sign * offDist, dense[i][1] + ny[i] * sign * offDist];
    }
    for (const [px, py] of resamplePolyline(offset, spacing, spacing * 0.45)) push(px, py);
  }

  // Rounded meniscus end-caps at both stroke terminals.
  const capR = offDist * 1.03;
  const deg = Math.PI / 180;
  for (const [idx, dirSign] of [[0, -1], [m - 1, 1]]) {
    const [px, py] = dense[idx];
    const ux = tx[idx] * dirSign;
    const uy = ty[idx] * dirSign;
    const vx = -uy;
    const vy = ux;
    for (const ang of [-58, -20, 20, 58]) {
      const a = ang * deg;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      push(px + capR * (ca * ux + sa * vx), py + capR * (ca * uy + sa * vy));
    }
  }
}

function buildHomes(rand) {
  const out = [];
  sampleRibbon(uCenterline(), 0.022, 0.030, 0.0006, rand, 0, out);
  sampleRibbon(sCenterline(), 0.022, 0.030, 0.0006, rand, 1, out);
  return out;
}

// ---------------------------------------------------------------- model
export function createLiquidModel(options = {}) {
  const seed0 = Number.isFinite(options.seed) ? options.seed : 1;
  const homes = buildHomes(mulberry32(0x5eed)); // the mark itself is authored, not random
  const count = homes.length;

  const homeX = new Float32Array(count);
  const homeY = new Float32Array(count);
  const letter = new Uint8Array(count);
  homes.forEach(([hx, hy, lid], i) => {
    homeX[i] = hx;
    homeY[i] = hy;
    letter[i] = lid;
  });

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const hold = new Float32Array(count);      // home-spring weight, 0..1
  const grip = new Float32Array(count);      // magnet capture strength, 0..1
  const strain = new Float32Array(count);    // elastic neck tension per particle, 0..1
  const energy = new Float32Array(count);    // surface ripple / shimmer energy, 0..1
  const returning = new Float32Array(count); // in-flight merge momentum, 0..1

  const params = {
    homeK: 86,
    damping: 7.2,
    magnetK: 96,
    magnetReach: 0.34, // pull saturates beyond this distance
    grabRadius: 0.175,
    sweepRadius: 0.075,
    pinchDistance: 0.50, // stretched filament yields & pinches off beyond this
    hoverRadius: 0.18,
    hoverK: 28,
    pairH: 0.058,
    pairRest: 0.024,
    pairK: 340,
    cohesion: 30,
    viscosity: 10.5,
    recover: 4.4, // 1/s, how quickly released liquid re-grips its home
  };
  const base = { ...params };

  const pointer = { active: false, x: 0, y: 0 };
  const hover = { active: false, x: 0, y: 0 };
  let phase = 'assembling';
  let freeTimer = 0; // keeps hold low briefly after a splash
  let playCount = 0;
  let seed = seed0;

  // Dynamic necking / pinch-off state for the active drag gesture.
  let hasCapture = false;
  let anchorX = 0;
  let anchorY = 0;
  let snapped = false;
  let tension = 0;
  let snapPulse = 0;
  let pinchCount = 0;
  let mergeRippleCount = 0;

  const cell = params.pairH;
  const cols = Math.ceil((WIDTH + 2 * MARGIN) / cell) + 1;
  const rows = Math.ceil((HEIGHT + 2 * MARGIN) / cell) + 1;
  const heads = new Int32Array(cols * rows);
  const next = new Int32Array(count);
  const ax = new Float32Array(count);
  const ay = new Float32Array(count);

  const clampX = (v) => Math.min(WIDTH + MARGIN, Math.max(-MARGIN, v));
  const clampY = (v) => Math.min(HEIGHT + MARGIN, Math.max(-MARGIN, v));

  function clearGestureState() {
    hasCapture = false;
    snapped = false;
    tension = 0;
    snapPulse = 0;
  }

  function varyMaterial(rand) {
    const j = (amt) => 1 + (rand() - 0.5) * 2 * amt;
    params.viscosity = base.viscosity * j(0.10);
    params.pairK = base.pairK * j(0.08);
    params.cohesion = base.cohesion * j(0.12);
    params.recover = base.recover * j(0.10);
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
      strain[i] = 0;
      energy[i] = 0.35;
      returning[i] = 0;
    }
    pointer.active = false;
    hover.active = false;
    clearGestureState();
    freeTimer = 0.25;
    phase = 'assembling';
  }

  function settle() {
    for (let i = 0; i < count; i += 1) {
      x[i] = homeX[i]; y[i] = homeY[i];
      vx[i] = 0; vy[i] = 0;
      hold[i] = 1; grip[i] = 0;
      strain[i] = 0; energy[i] = 0; returning[i] = 0;
    }
    pointer.active = false;
    hover.active = false;
    clearGestureState();
    freeTimer = 0;
    phase = 'rest';
  }

  function capture(px, py, radius, upgrade = true) {
    let added = 0;
    let sumX = 0;
    let sumY = 0;
    let sumW = 0;
    for (let i = 0; i < count; i += 1) {
      if (!upgrade && grip[i] > 0) continue;
      const d = Math.hypot(x[i] - px, y[i] - py);
      if (d < radius) {
        // Core becomes the plump rolling bead; continuous tapered collar keeps
        // partial home grip so root fillet and hourglass neck never tear open.
        const u = d / radius;
        const s = u < 0.42 ? 1 : 0.02 + 0.98 * ((1 - u) / 0.58) ** 1.65;
        if (s > grip[i]) {
          grip[i] = s;
          returning[i] = 0;
          added += 1;
          sumX += homeX[i] * s;
          sumY += homeY[i] * s;
          sumW += s;
        }
      }
    }
    if (added > 0 && !hasCapture && sumW > 0) {
      hasCapture = true;
      anchorX = sumX / sumW;
      anchorY = sumY / sumW;
    }
    return added;
  }

  function pointerDown(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    hover.active = false;
    pointer.active = true;
    pointer.x = clampX(px);
    pointer.y = clampY(py);
    grip.fill(0); // A new anchor replaces the old keyboard/pointer capture.
    hasCapture = false;
    snapped = false;
    tension = 0;
    capture(pointer.x, pointer.y, params.grabRadius, true);
    phase = 'dragging';
  }

  function pointerMove(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    const nx = clampX(px);
    const ny = clampY(py);
    const mvx = nx - pointer.x;
    const mvy = ny - pointer.y;
    pointer.x = nx;
    pointer.y = ny;
    if (!pointer.active) return;
    if (!snapped) {
      // Sweeping across the mark picks up fresh liquid without over-tightening
      // liquid already strung out along the neck behind the hand.
      capture(pointer.x, pointer.y, params.sweepRadius, false);
    } else {
      // A pinched-off glossy bead gliding over the other letter wets and stirs
      // the surface it passes across, inviting small bridging discoveries.
      const wakeR = 0.085;
      for (let i = 0; i < count; i += 1) {
        if (grip[i] > 0) continue;
        const d = Math.hypot(x[i] - nx, y[i] - ny);
        if (d < wakeR) {
          const w = 1 - d / wakeR;
          hold[i] = Math.min(hold[i], 1 - 0.55 * w);
          vx[i] += Math.max(-1.2, Math.min(1.2, mvx * 16)) * w * 0.35;
          vy[i] += Math.max(-1.2, Math.min(1.2, mvy * 16)) * w * 0.35;
          energy[i] = Math.max(energy[i], 0.55 * w);
        }
      }
    }
  }

  function pointerUp() {
    const wasDragging = pointer.active;
    pointer.active = false;
    if (wasDragging) {
      // Slingshot release: freed liquid immediately re-grips enough to whip
      // back into the letter and trigger a coalescing impact ripple on arrival.
      for (let i = 0; i < count; i += 1) {
        const dx = homeX[i] - x[i];
        const dy = homeY[i] - y[i];
        const d = Math.hypot(dx, dy);
        if (grip[i] > 0 || d > 0.045) {
          if (d > 0.03) {
            const kick = Math.min(2.3, d * 3.8) * (0.45 + 0.55 * grip[i]);
            vx[i] += (dx / d) * kick;
            vy[i] += (dy / d) * kick;
            returning[i] = Math.max(returning[i], Math.min(1, d / 0.24));
            energy[i] = Math.max(energy[i], Math.min(0.95, d * 2.1));
          }
          hold[i] = Math.max(hold[i], 0.36);
        }
      }
    }
    grip.fill(0);
    hasCapture = false;
    snapped = false;
    tension = 0;
    snapPulse = 0; // The pointer transient ends on release, including still poses.
    if (phase === 'dragging') phase = 'reforming';
  }

  function hoverMove(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    if (pointer.active) return;
    hover.active = true;
    hover.x = clampX(px);
    hover.y = clampY(py);
  }

  function hoverLeave() {
    hover.active = false;
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
      const fall = 1 - d / radius;
      const impulse = 2.6 * fall;
      vx[i] += ux * impulse;
      vy[i] += uy * impulse;
      hold[i] = Math.min(hold[i], 1 - 0.72 * fall);
      energy[i] = Math.max(energy[i], 0.85 * fall);
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
    hover.active = false;
    pointerUp();
    for (let i = 0; i < count; i += 1) {
      const dx = x[i] - ox;
      const dy = y[i] - oy;
      const d = Math.hypot(dx, dy) || 1e-3;
      const fall = 0.6 + 0.4 * Math.exp(-d * 2);
      const speed = (1.65 + rand() * 1.45) * fall;
      const ux = dx / d;
      const uy = dy / d;
      vx[i] += (swirl ? -uy * 1.25 + ux * 0.35 : ux) * speed;
      vy[i] += (swirl ? ux * 1.25 + uy * 0.35 : uy) * speed;
      hold[i] = Math.min(hold[i], 0.08);
      energy[i] = Math.max(energy[i], 0.85);
      returning[i] = 0.55;
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

  function triggerPinchOff(ux, uy) {
    snapped = true;
    snapPulse = 1;
    tension = 0;
    pinchCount += 1;
    for (let i = 0; i < count; i += 1) {
      if (grip[i] <= 0) continue;
      if (grip[i] < 0.88) {
        // Neck & root particles snap cleanly back toward their letter.
        const dx = homeX[i] - x[i];
        const dy = homeY[i] - y[i];
        const d = Math.hypot(dx, dy);
        grip[i] = 0;
        strain[i] = 0;
        hold[i] = Math.max(hold[i], 0.48);
        if (d > 1e-4) {
          const recoil = Math.min(2.4, 0.7 + d * 3.8);
          vx[i] += (dx / d) * recoil;
          vy[i] += (dy / d) * recoil;
          returning[i] = Math.max(returning[i], Math.min(1, d / 0.25));
        }
        energy[i] = Math.max(energy[i], 0.95);
      } else {
        // Detached bead pops gently forward into the hand as tension breaks.
        vx[i] += ux * 0.55;
        vy[i] += uy * 0.55;
        strain[i] = 0;
        energy[i] = Math.max(energy[i], 0.85);
      }
    }
  }

  function emitMergeRipple(ix, iy, lid, imp) {
    const rad = 0.13;
    const rad2 = rad * rad;
    const gx = Math.floor((ix + MARGIN) / cell);
    const gy = Math.floor((iy + MARGIN) / cell);
    const span = Math.ceil(rad / cell);
    mergeRippleCount += 1;
    for (let oy = -span; oy <= span; oy += 1) {
      for (let ox = -span; ox <= span; ox += 1) {
        const cx = gx + ox;
        const cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        for (let j = heads[cy * cols + cx]; j !== -1; j = next[j]) {
          if (letter[j] !== lid || grip[j] > 0) continue;
          const dx = x[j] - ix;
          const dy = y[j] - iy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rad2 || d2 < 1e-10) continue;
          const d = Math.sqrt(d2);
          const fall = (1 - d / rad) ** 2;
          // Briefly soften local hold so the impact sends a glossy slosh wave.
          hold[j] = Math.min(hold[j], 1 - 0.36 * imp * fall);
          const push = 0.32 * imp * fall;
          vx[j] += (dx / d) * push;
          vy[j] += (dy / d) * push;
          energy[j] = Math.max(energy[j], 0.72 * imp * fall);
        }
      }
    }
  }

  function substep(h) {
    const p = params;
    if (freeTimer > 0) freeTimer = Math.max(0, freeTimer - h);
    if (snapPulse > 0) snapPulse = Math.max(0, snapPulse - h * 2.8);

    const rec = 1 - Math.exp(-p.recover * h);
    const gripRate = 1 - Math.exp(-12 * h);
    const energyDecay = Math.exp(-3.1 * h);
    const strainDecay = Math.exp(-6.5 * h);

    // Evaluate active drag stretch & filament tension before forces.
    let pullDist = 0;
    let pullUx = 0;
    let pullUy = 0;
    let headCount = 0;
    if (pointer.active && hasCapture && !snapped) {
      const pdx = pointer.x - anchorX;
      const pdy = pointer.y - anchorY;
      pullDist = Math.hypot(pdx, pdy);
      if (pullDist > 1e-5) {
        pullUx = pdx / pullDist;
        pullUy = pdy / pullDist;
      }
      for (let i = 0; i < count; i += 1) if (grip[i] >= 0.88) headCount += 1;
      if (headCount > 0) {
        tension = Math.min(1, Math.max(0, (pullDist - 0.08) / (p.pinchDistance - 0.08)));
        if (pullDist >= p.pinchDistance && headCount >= 6) {
          triggerPinchOff(pullUx, pullUy);
        }
      } else {
        tension = 0;
      }
    } else {
      tension *= Math.exp(-8 * h);
      if (tension < 1e-4) tension = 0;
    }

    for (let i = 0; i < count; i += 1) {
      if (grip[i] > 0) {
        // Weakly gripped collar keeps partial home spring, creating the
        // anchored root fillet and hourglass neck between letter and bead.
        const targetHold = grip[i] >= 0.88 ? 0 : 0.82 * (1 - grip[i]) ** 1.35;
        hold[i] += (targetHold - hold[i]) * gripRate;
      } else if (freeTimer <= 0) {
        hold[i] += (1 - hold[i]) * rec;
      }
      energy[i] *= energyDecay;
      if (energy[i] < 1e-4) energy[i] = 0;
      strain[i] *= strainDecay;
      if (strain[i] < 1e-4) strain[i] = 0;
      if (returning[i] > 0) {
        returning[i] = Math.max(0, returning[i] - h * 0.7);
      }
    }

    ax.fill(0);
    ay.fill(0);
    buildGrid();

    // Short-range cohesive & viscous neighbour forces on freed liquid.
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
            // Stiff volume preservation when compressed; surface-tension-like
            // cohesion when stretched so beads stay round and necks cohere.
            const jFree = 1 - hold[j];
            const cohScale = 0.35 + 0.65 * jFree;
            let f = d < p.pairRest
              ? (p.pairK * (d - p.pairRest)) / p.pairRest * 0.12
              : (p.cohesion * cohScale * q * (d - p.pairRest)) / H;
            f += p.viscosity * q * ((vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny);
            ax[i] += f * nx * free;
            ay[i] += f * ny * free;
          }
        }
      }
    }

    // Active filament capillary necking & bead resistance.
    const neckActive = pointer.active && hasCapture && !snapped && tension > 0.02 && pullDist > 0.08;
    const reach = p.magnetReach;
    const hRad = p.hoverRadius;

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

        if (neckActive) {
          if (grip[i] >= 0.88) {
            // Tactile capillary resistance pulling back against the hand until snap.
            const resist = 1.9 * tension * (1 - 0.15 * tension);
            ax[i] -= pullUx * resist;
            ay[i] -= pullUy * resist;
            const beadGlow = tension * 0.45;
            if (beadGlow > strain[i]) strain[i] = beadGlow;
          } else {
            // Transverse hourglass necking onto the chord from anchor to bead.
            const rx = x[i] - anchorX;
            const ry = y[i] - anchorY;
            const proj = rx * pullUx + ry * pullUy;
            const t = proj / pullDist;
            if (t > 0.04 && t < 0.96) {
              const perpX = rx - pullUx * proj;
              const perpY = ry - pullUy * proj;
              const waist = Math.sin(Math.PI * t);
              const pinchK = 54 * tension * waist;
              ax[i] -= perpX * pinchK;
              ay[i] -= perpY * pinchK;
              const localStrain = Math.min(1, tension * (0.45 + 0.75 * waist));
              if (localStrain > strain[i]) strain[i] = localStrain;
              if (localStrain * 0.65 > energy[i]) energy[i] = localStrain * 0.65;
            }
          }
        }
      } else if (hover.active && !pointer.active && freeTimer <= 0) {
        // Subtle living presence: resting ink leans gently toward an approaching cursor.
        const dx = hover.x - x[i];
        const dy = hover.y - y[i];
        const d = Math.hypot(dx, dy);
        if (d < hRad && d > 1e-5) {
          const w = (1 - d / hRad) ** 2;
          const pull = p.hoverK * w * Math.min(d, 0.08);
          ax[i] += (dx / d) * pull;
          ay[i] += (dy / d) * pull;
          const hGlow = w * 0.34;
          if (hGlow > energy[i]) energy[i] = hGlow;
        }
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

      // Coalescence merge ripple: when a fast-returning droplet strikes home,
      // transfer a brief localized glossy slosh wave to nearby letter ink.
      if (returning[i] > 0.22 && grip[i] <= 0 && freeTimer <= 0) {
        const hd = Math.hypot(homeX[i] - nx, homeY[i] - ny);
        if (hd < 0.055 && sp > 0.55) {
          const imp = Math.min(1, returning[i] * (sp / 2.2));
          returning[i] = 0;
          energy[i] = Math.max(energy[i], 0.9 * imp);
          emitMergeRipple(nx, ny, letter[i], imp);
        }
      }
    }
  }

  function metrics() {
    let sum = 0;
    let max = 0;
    let ke = 0;
    let captured = 0;
    let meanEnergy = 0;
    let maxStrain = 0;
    let finite = true;
    for (let i = 0; i < count; i += 1) {
      const d = Math.hypot(x[i] - homeX[i], y[i] - homeY[i]);
      sum += d;
      if (d > max) max = d;
      ke += 0.5 * (vx[i] * vx[i] + vy[i] * vy[i]);
      if (grip[i] > 0) captured += 1;
      meanEnergy += energy[i];
      if (strain[i] > maxStrain) maxStrain = strain[i];
      if (!Number.isFinite(d) || !Number.isFinite(vx[i]) || !Number.isFinite(vy[i])) finite = false;
    }
    return {
      meanDisplacement: sum / count,
      maxDisplacement: max,
      kinetic: ke / count,
      captured,
      tension,
      snapped,
      pinchCount,
      mergeRippleCount,
      meanEnergy: meanEnergy / count,
      maxStrain,
      finite,
      phase,
    };
  }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const frame = Math.min(dt, MAX_FRAME);
    const n = Math.max(1, Math.ceil(frame / SUBSTEP - 1e-9));
    for (let k = 0; k < n; k += 1) substep(frame / n);
    if (!pointer.active && !hover.active && phase !== 'rest') {
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
    x, y, vx, vy, homeX, homeY, hold, grip, strain, energy, letter,
    bounds: { width: WIDTH, height: HEIGHT, margin: MARGIN },
    letterBoxes: LETTER_BOXES,
    stroke: STROKE,
    // Surface rendering: smooth compact kernel radius and iso-threshold,
    // chosen so the settled particles draw exactly the authored stroke width.
    kernel: 0.060,
    threshold: 0.58,
    maxSpeed: MAX_SPEED,
    params,
    pointer,
    hover,
    get phase() { return phase; },
    get seed() { return seed; },
    get tension() { return tension; },
    get snapped() { return snapped; },
    get snapPulse() { return snapPulse; },
    step, settle, reset, play, poke, metrics,
    pointerDown, pointerMove, pointerUp, hoverMove, hoverLeave,
  };
}
