// Chladni-inspired continuous nodal ridges and travelling impulse ripples,
// not a validated acoustic or structural finite-element model.

function randomSource(seed) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(1664525, s) + 1013904223 >>> 0) / 4294967296);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Five distinct centered square-plate Chladni-inspired modes, Open -> Intricate:
// F(x, y) = cos(m*pi*x/2)*cos(n*pi*y/2) + sign*cos(n*pi*x/2)*cos(m*pi*y/2)
const MODES = [
  { m: 2, n: 3, sign: -1, width: 1.08 }, // Cross currents
  { m: 1, n: 4, sign:  1, width: 1.04 }, // Woven paths
  { m: 3, n: 5, sign:  1, width: 0.98 }, // Petal rhythm
  { m: 3, n: 7, sign:  1, width: 0.90 }, // Fine harmonics
  { m: 4, n: 6, sign:  1, width: 0.86 }, // Hidden lattice
];

const HALF_PI = Math.PI * 0.5;
const GRID_CELLS = 68;
const BUCKETS = 16;
const BOUND = 0.935;

const _proj = { x: 0, y: 0, fx: 0, fy: 0, grad: 0 };

function fieldValue(x, y, def) {
  const a = def.m * HALF_PI;
  const b = def.n * HALF_PI;
  return Math.cos(a * x) * Math.cos(b * y) + def.sign * Math.cos(b * x) * Math.cos(a * y);
}

function projectOntoNode(x, y, def, out = _proj) {
  const a = def.m * HALF_PI;
  const b = def.n * HALF_PI;
  const s = def.sign;
  let px = x;
  let py = y;
  let fx = 0;
  let fy = 0;

  for (let iter = 0; iter < 2; iter++) {
    const cax = Math.cos(a * px), sax = Math.sin(a * px);
    const cay = Math.cos(a * py), say = Math.sin(a * py);
    const cbx = Math.cos(b * px), sbx = Math.sin(b * px);
    const cby = Math.cos(b * py), sby = Math.sin(b * py);
    const f = cax * cby + s * cbx * cay;
    fx = -a * sax * cby - s * b * sbx * cay;
    fy = -b * cax * sby - s * a * cbx * say;
    const denom = fx * fx + fy * fy;
    if (denom < 1e-6) break;
    const step = clamp(f / denom, -0.075, 0.075);
    px -= step * fx;
    py -= step * fy;
  }

  const cax = Math.cos(a * px), sax = Math.sin(a * px);
  const cay = Math.cos(a * py), say = Math.sin(a * py);
  const cbx = Math.cos(b * px), sbx = Math.sin(b * px);
  const cby = Math.cos(b * py), sby = Math.sin(b * py);
  fx = -a * sax * cby - s * b * sbx * cay;
  fy = -b * cax * sby - s * a * cbx * say;

  out.x = px;
  out.y = py;
  out.fx = fx;
  out.fy = fy;
  out.grad = Math.hypot(fx, fy);
  return out;
}

const CONTOUR_CACHE = new Map();

function buildContour(mode) {
  if (CONTOUR_CACHE.has(mode)) return CONTOUR_CACHE.get(mode);
  const def = MODES[mode];
  const raw = [];
  const span = BOUND * 2;
  const step = span / GRID_CELLS;

  for (let iy = 0; iy < GRID_CELLS; iy++) {
    const y0 = -BOUND + iy * step;
    for (let ix = 0; ix < GRID_CELLS; ix++) {
      const x0 = -BOUND + ix * step;
      const f0 = fieldValue(x0, y0, def);

      if (ix + 1 < GRID_CELLS) {
        const f1 = fieldValue(x0 + step, y0, def);
        if (f0 * f1 <= 0 && Math.abs(f0 - f1) > 1e-6) {
          const t = f0 / (f0 - f1);
          const p = projectOntoNode(x0 + step * t, y0, def);
          if (Math.abs(p.x) <= BOUND && Math.abs(p.y) <= BOUND) {
            const inv = p.grad > 1e-4 ? 1 / p.grad : 0;
            raw.push({ x: p.x, y: p.y, nx: p.fx * inv, ny: p.fy * inv, grad: p.grad });
          }
        }
      }

      if (iy + 1 < GRID_CELLS) {
        const f2 = fieldValue(x0, y0 + step, def);
        if (f0 * f2 <= 0 && Math.abs(f0 - f2) > 1e-6) {
          const t = f0 / (f0 - f2);
          const p = projectOntoNode(x0, y0 + step * t, def);
          if (Math.abs(p.x) <= BOUND && Math.abs(p.y) <= BOUND) {
            const inv = p.grad > 1e-4 ? 1 / p.grad : 0;
            raw.push({ x: p.x, y: p.y, nx: p.fx * inv, ny: p.fy * inv, grad: p.grad });
          }
        }
      }
    }
  }

  // Thin closely spaced crossings so diagonal and axis-aligned arcs share even density.
  const minDist = step * 0.66;
  const minDist2 = minDist * minDist;
  const nodes = [];
  const buckets = Array.from({ length: BUCKETS * BUCKETS }, () => []);

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const cx = clamp(Math.floor(((c.x + 1) * 0.5) * BUCKETS), 0, BUCKETS - 1);
    const cy = clamp(Math.floor(((c.y + 1) * 0.5) * BUCKETS), 0, BUCKETS - 1);
    let tooClose = false;
    for (let by = Math.max(0, cy - 1); by <= Math.min(BUCKETS - 1, cy + 1) && !tooClose; by++) {
      for (let bx = Math.max(0, cx - 1); bx <= Math.min(BUCKETS - 1, cx + 1); bx++) {
        const list = buckets[by * BUCKETS + bx];
        for (let k = 0; k < list.length; k++) {
          const n = list[k];
          const dx = c.x - n.x;
          const dy = c.y - n.y;
          if (dx * dx + dy * dy < minDist2) {
            tooClose = true;
            break;
          }
        }
      }
    }
    if (!tooClose) {
      c.idx = nodes.length;
      nodes.push(c);
      buckets[cy * BUCKETS + cx].push(c);
    }
  }

  const built = { nodes, buckets, step, def };
  CONTOUR_CACHE.set(mode, built);
  return built;
}

function nearestNode(contourData, x, y, loads, cap) {
  const { buckets, nodes } = contourData;
  const cx = clamp(Math.floor(((x + 1) * 0.5) * BUCKETS), 0, BUCKETS - 1);
  const cy = clamp(Math.floor(((y + 1) * 0.5) * BUCKETS), 0, BUCKETS - 1);

  let best = null;
  let bestDist = Infinity;
  let foundRing = -1;

  for (let r = 0; r < BUCKETS; r++) {
    const xMin = Math.max(0, cx - r);
    const xMax = Math.min(BUCKETS - 1, cx + r);
    const yMin = Math.max(0, cy - r);
    const yMax = Math.min(BUCKETS - 1, cy + r);
    for (let by = yMin; by <= yMax; by++) {
      for (let bx = xMin; bx <= xMax; bx++) {
        if (r > 0 && bx > xMin && bx < xMax && by > yMin && by < yMax) continue;
        const list = buckets[by * BUCKETS + bx];
        for (let k = 0; k < list.length; k++) {
          const n = list[k];
          if (loads && loads[n.idx] >= cap) continue;
          const dx = x - n.x;
          const dy = y - n.y;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            best = n;
          }
        }
      }
    }
    if (best !== null) {
      if (foundRing === -1) foundRing = r;
      else if (r >= foundRing + 1) break;
    }
  }
  return best || nodes[0];
}

export class SandModel {
  constructor({ seed = 1, count = 3800 } = {}) {
    this.random = randomSource(seed);
    this.mode = 0;
    this.time = 0;
    this.energy = 1;
    this.ripples = [];
    this.finger = {
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      hold: 0,
      dragged: false,
      lastRippleX: 0,
      lastRippleY: 0,
    };
    this._contour = buildContour(this.mode);
    this.nodes = this._contour.nodes;
    this.grains = Array.from({ length: count }, () => {
      const size = this.random();
      // Peaked bell curve in [-1, 1] for heaped sand ridges with feathered aprons.
      const ridge = (this.random() + this.random() + this.random() - 1.5) / 1.5;
      const stray = this.random() < 0.068;
      const mass = 0.78 + size * 0.42;
      const omega = 5.15 / Math.sqrt(mass);
      return {
        x: this.random() * 1.86 - 0.93,
        y: this.random() * 1.86 - 0.93,
        vx: 0,
        vy: 0,
        z: 0,
        vz: 0,
        shade: this.random(),
        size,
        mass,
        invMass: 1 / mass,
        stiff: omega * omega,
        damp: 1.94 * omega,
        ridge,
        stray,
        crest: Math.exp(-3.1 * ridge * ridge) * (stray ? 0.3 : 1),
        phase: this.random() * Math.PI * 2,
        tx: 0,
        ty: 0,
      };
    });
    this.retarget();
  }

  modeCount() {
    return MODES.length;
  }

  fieldAt(x, y) {
    return fieldValue(x, y, this._contour.def);
  }

  retarget() {
    const contourData = this._contour;
    const { def, step, nodes } = contourData;
    const count = this.grains.length;
    if (!count || !nodes.length) return;
    const tangScale = step * 1.65;

    // Capacity-balanced assignment keeps every nodal arc lush even after many mode switches.
    const loads = new Uint16Array(nodes.length);
    const cap = Math.max(1, Math.ceil((count / nodes.length) * 1.18));

    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }

    for (let k = 0; k < count; k++) {
      const g = this.grains[order[k]];
      const base = nearestNode(contourData, g.x, g.y, loads, cap);
      loads[base.idx]++;

      const tang = (this.random() - 0.5) * tangScale;
      const sx = clamp(base.x - base.ny * tang, -BOUND, BOUND);
      const sy = clamp(base.y + base.nx * tang, -BOUND, BOUND);

      const proj = projectOntoNode(sx, sy, def);

      // Ridge width widens gently at saddles/intersections where |grad F| is low.
      const valley = clamp((0.064 * def.width) / Math.sqrt(proj.grad + 1.25), 0.016, 0.039);
      const apron = g.stray ? 2.2 : (0.76 + (1.2 - g.mass) * 0.6);
      const offset = g.ridge * valley * apron;

      let nx, ny;
      if (proj.grad > 0.34) {
        nx = proj.fx / proj.grad;
        ny = proj.fy / proj.grad;
      } else {
        const a = g.phase + this.random() * 0.45;
        nx = Math.cos(a);
        ny = Math.sin(a);
      }

      g.tx = clamp(proj.x + nx * offset, -BOUND, BOUND);
      g.ty = clamp(proj.y + ny * offset, -BOUND, BOUND);
    }
  }

  spawnRipple(x, y, { strength = 1, speed = 1.62, width = 0.19, maxAge = 1.08, radius = 0.06 } = {}) {
    if (this.ripples.length >= 6) this.ripples.shift();
    this.ripples.push({
      x: clamp(x, -1, 1),
      y: clamp(y, -1, 1),
      radius,
      speed,
      strength,
      width,
      age: 0,
      maxAge,
    });
  }

  scatter(x, y, { strength = 1, dragVx = 0, dragVy = 0, ripple = true } = {}) {
    const cx = clamp(x, -0.98, 0.98);
    const cy = clamp(y, -0.98, 0.98);
    const radius = 0.35;
    const r2 = radius * radius;
    const dragSpeed = Math.hypot(dragVx, dragVy);
    this.energy = Math.min(1, Math.max(this.energy, 0.78 * strength));

    const grains = this.grains;
    for (let i = 0; i < grains.length; i++) {
      const g = grains[i];
      const dx = g.x - cx;
      const dy = g.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const d = Math.sqrt(d2);
        const falloff = 1 - d / radius;
        const smooth = falloff * falloff * (3 - 2 * falloff);
        const invD = d > 1e-4 ? 1 / d : 0;
        const cos = d > 1e-4 ? dx * invD : Math.cos(g.phase);
        const sin = d > 1e-4 ? dy * invD : Math.sin(g.phase);
        const invMass = g.invMass;

        const kick = (0.042 + smooth * 0.20) * strength * (0.74 + 0.26 * invMass);
        const swirl = Math.sin(g.phase * 3.1) * 0.14 * kick;
        g.x = clamp(g.x + cos * kick - sin * swirl + dragVx * smooth * 0.036, -0.98, 0.98);
        g.y = clamp(g.y + sin * kick + cos * swirl + dragVy * smooth * 0.036, -0.98, 0.98);

        const impulse = (0.55 + smooth * 1.15) * strength * invMass;
        g.vx += cos * impulse - sin * swirl * 3.6 + dragVx * smooth * 0.48;
        g.vy += sin * impulse + cos * swirl * 3.6 + dragVy * smooth * 0.48;
        g.vz = Math.min(3.4, g.vz + (0.85 + smooth * 1.65 + dragSpeed * 0.18) * strength * invMass);
      }
    }

    if (ripple) {
      this.spawnRipple(cx, cy, {
        strength: clamp(strength, 0.38, 1.15),
        speed: 1.65,
        width: 0.19,
        maxAge: 1.05,
        radius: 0.08,
      });
    }
  }

  press(x, y) {
    const cx = clamp(x, -0.98, 0.98);
    const cy = clamp(y, -0.98, 0.98);
    this.finger.active = true;
    this.finger.x = cx;
    this.finger.y = cy;
    this.finger.vx = 0;
    this.finger.vy = 0;
    this.finger.hold = 0;
    this.finger.dragged = false;
    this.finger.lastRippleX = cx;
    this.finger.lastRippleY = cy;
    this.scatter(cx, cy, { strength: 1.0, ripple: true });
  }

  drag(x, y) {
    const cx = clamp(x, -0.98, 0.98);
    const cy = clamp(y, -0.98, 0.98);
    if (!this.finger.active) {
      this.press(cx, cy);
      return;
    }
    const dx = cx - this.finger.x;
    const dy = cy - this.finger.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.015) this.finger.dragged = true;
    this.finger.vx = clamp(dx * 16, -3.5, 3.5);
    this.finger.vy = clamp(dy * 16, -3.5, 3.5);
    this.finger.x = cx;
    this.finger.y = cy;

    const movedSinceRipple = Math.hypot(cx - this.finger.lastRippleX, cy - this.finger.lastRippleY);
    const emit = movedSinceRipple >= 0.22;
    if (emit) {
      this.finger.lastRippleX = cx;
      this.finger.lastRippleY = cy;
    }
    this.scatter(cx, cy, {
      strength: clamp(0.42 + dist * 2.1, 0.42, 0.84),
      dragVx: this.finger.vx,
      dragVy: this.finger.vy,
      ripple: emit,
    });
  }

  release() {
    if (!this.finger.active) return;
    const { x, y, hold, dragged } = this.finger;
    this.finger.active = false;
    this.finger.vx = 0;
    this.finger.vy = 0;
    this.finger.hold = 0;
    this.finger.dragged = false;
    if (hold > 0.14 || dragged) {
      this.spawnRipple(x, y, {
        strength: 0.46 + clamp(hold, 0, 1) * 0.48,
        speed: 1.78,
        width: 0.17,
        maxAge: 0.95,
        radius: 0.06,
      });
      this.energy = Math.min(1, Math.max(this.energy, 0.56));
    }
  }

  setMode(value) {
    this.mode = Math.min(MODES.length - 1, Math.max(0, Math.round(Number(value) || 0)));
    this._contour = buildContour(this.mode);
    this.nodes = this._contour.nodes;
    this.energy = 1;
    this.retarget();

    const def = this._contour.def;
    const grains = this.grains;
    for (let i = 0; i < grains.length; i++) {
      const g = grains[i];
      const amp = Math.min(1, Math.abs(fieldValue(g.x, g.y, def)) * 0.75);
      if (amp > 0.05) {
        const a = g.phase + this.time * 1.7;
        const kick = amp * 0.52 * g.invMass;
        g.vx += Math.cos(a) * kick;
        g.vy += Math.sin(a) * kick;
        g.vz = Math.min(3.2, g.vz + amp * 1.65 * g.invMass);
      }
    }
    this.spawnRipple(0, 0, { strength: 0.78, speed: 1.85, width: 0.21, maxAge: 0.9, radius: 0.02 });
  }

  meanDistance() {
    const count = this.grains.length;
    if (!count) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const g = this.grains[i];
      sum += Math.hypot(g.x - g.tx, g.y - g.ty);
    }
    return sum / count;
  }

  step(dt) {
    dt = Math.min(0.05, Math.max(0, dt));
    if (!dt) return;
    this.time += dt;
    this.energy *= Math.exp(-dt * 1.6);

    if (this.finger.active) {
      this.finger.hold = Math.min(1, this.finger.hold + dt * 1.7);
      this.finger.vx *= Math.exp(-dt * 12);
      this.finger.vy *= Math.exp(-dt * 12);
    }

    for (let r = this.ripples.length - 1; r >= 0; r--) {
      const rip = this.ripples[r];
      rip.age += dt;
      rip.radius += rip.speed * dt;
      if (rip.age >= rip.maxAge) {
        this.ripples.splice(r, 1);
      }
    }

    const substeps = dt > 0.025 ? 2 : 1;
    const h = dt / substeps;
    const rippleCount = this.ripples.length;
    const fingerActive = this.finger.active;
    const grains = this.grains;
    const count = grains.length;

    if (rippleCount === 0 && !fingerActive) {
      for (let s = 0; s < substeps; s++) {
        for (let i = 0; i < count; i++) {
          const g = grains[i];
          const ax = (g.tx - g.x) * g.stiff - g.vx * g.damp;
          const ay = (g.ty - g.y) * g.stiff - g.vy * g.damp;
          g.vx += ax * h;
          g.vy += ay * h;
          g.x = clamp(g.x + g.vx * h, -0.98, 0.98);
          g.y = clamp(g.y + g.vy * h, -0.98, 0.98);

          if (g.z > 0 || g.vz > 0) {
            g.vz -= 9.8 * h;
            g.z += g.vz * h;
            if (g.z <= 0) {
              g.z = 0;
              g.vz = g.vz < -0.2 ? -g.vz * 0.22 : 0;
            } else if (g.z > 1) {
              g.z = 1;
              g.vz = Math.min(0, g.vz);
            }
          }
        }
      }
      return;
    }

    const fx = this.finger.x;
    const fy = this.finger.y;
    const rInner2 = [];
    const rOuter2 = [];
    const rDecay = [];
    for (let r = 0; r < rippleCount; r++) {
      const rip = this.ripples[r];
      const inner = Math.max(0, rip.radius - rip.width);
      const outer = rip.radius + rip.width;
      rInner2[r] = inner * inner;
      rOuter2[r] = outer * outer;
      const life = 1 - rip.age / rip.maxAge;
      const fade = life * (1.35 - 0.35 * life);
      rDecay[r] = (rip.strength * fade) / Math.sqrt(1 + rip.radius * 1.1);
    }

    for (let s = 0; s < substeps; s++) {
      for (let i = 0; i < count; i++) {
        const g = grains[i];
        const invMass = g.invMass;
        let ax = (g.tx - g.x) * g.stiff - g.vx * g.damp;
        let ay = (g.ty - g.y) * g.stiff - g.vy * g.damp;

        for (let r = 0; r < rippleCount; r++) {
          const rip = this.ripples[r];
          const dx = g.x - rip.x;
          const dy = g.y - rip.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rInner2[r] && d2 <= rOuter2[r]) {
            const dist = Math.sqrt(d2);
            const u = (dist - rip.radius) / rip.width;
            const env = Math.cos(u * HALF_PI);
            const env2 = env * env;
            const force = env2 * rDecay[r] * invMass;

            const invD = dist > 1e-4 ? 1 / dist : 0;
            const rx = dist > 1e-4 ? dx * invD : Math.cos(g.phase);
            const ry = dist > 1e-4 ? dy * invD : Math.sin(g.phase);

            const push = (14.5 + 8.5 * u) * force;
            const shear = Math.sin(g.phase * 2.7 + rip.radius * 5.5) * 2.4 * force;
            ax += rx * push - ry * shear;
            ay += ry * push + rx * shear;

            if (u > -0.35 && g.z < 0.22) {
              g.vz = Math.min(2.8, g.vz + force * 34 * h);
            }
          }
        }

        if (fingerActive) {
          const dx = g.x - fx;
          const dy = g.y - fy;
          const d2 = dx * dx + dy * dy;
          if (d2 < 0.0361) {
            const d = Math.sqrt(d2);
            const push = 1 - d / 0.19;
            const invD = d > 1e-4 ? 1 / d : 0;
            const rx = d > 1e-4 ? dx * invD : Math.cos(g.phase);
            const ry = d > 1e-4 ? dy * invD : Math.sin(g.phase);
            ax += rx * push * 28 * invMass;
            ay += ry * push * 28 * invMass;
          }
        }

        g.vx += ax * h;
        g.vy += ay * h;
        g.x = clamp(g.x + g.vx * h, -0.98, 0.98);
        g.y = clamp(g.y + g.vy * h, -0.98, 0.98);

        if (g.z > 0 || g.vz > 0) {
          g.vz -= 9.8 * h;
          g.z += g.vz * h;
          if (g.z <= 0) {
            g.z = 0;
            g.vz = g.vz < -0.2 ? -g.vz * 0.22 : 0;
          } else if (g.z > 1) {
            g.z = 1;
            g.vz = Math.min(0, g.vz);
          }
        }
      }
    }
  }
}
