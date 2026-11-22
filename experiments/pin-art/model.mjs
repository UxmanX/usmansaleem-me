const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function boxBlur(src, w, h, rad) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const k = 2 * rad + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let dx = -rad; dx <= rad; dx++) sum += src[row + clamp(dx, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / k;
      sum += src[row + Math.min(w - 1, x + rad + 1)] - src[row + Math.max(0, x - rad)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let dy = -rad; dy <= rad; dy++) sum += tmp[clamp(dy, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / k;
      sum += tmp[Math.min(h - 1, y + rad + 1) * w + x] - tmp[Math.max(0, y - rad) * w + x];
    }
  }
  return out;
}

/**
 * Derive a coherent sculptural bas-relief height map and metallic albedo patina
 * from RGBA portrait pixels while suppressing out-of-focus background bokeh.
 */
export function buildPortraitRelief(rgba, w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || !rgba || rgba.length < w * h * 4) {
    throw new RangeError('Portrait RGBA buffer does not match dimensions');
  }
  const n = w * h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ri = (rgba[i * 4] || 0) / 255;
    const gi = (rgba[i * 4 + 1] || 0) / 255;
    const bi = (rgba[i * 4 + 2] || 0) / 255;
    r[i] = ri;
    g[i] = gi;
    b[i] = bi;
    luma[i] = ri * 0.2126 + gi * 0.7152 + bi * 0.0722;
  }

  // 1. Border-seeded geodesic background separation (suppresses bokeh spikes without geometric cutouts)
  const cost = new Float32Array(n);
  cost.fill(1e6);
  for (let x = 0; x < w; x++) cost[x] = 0;
  const sideLimit = Math.floor(h * 0.78);
  for (let y = 0; y < sideLimit; y++) {
    const leftIdx = y * w;
    if (luma[leftIdx] > 0.55 && b[leftIdx] - r[leftIdx] < 0.08) cost[leftIdx] = 0;
    const rightIdx = leftIdx + w - 1;
    if (luma[rightIdx] > 0.55 && b[rightIdx] - r[rightIdx] < 0.08) cost[rightIdx] = 0;
  }

  const pixPen = new Float32Array(n);
  const edgeGate = new Float32Array(n);
  const skinSignal = new Float32Array(n);
  const suitCool = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ri = r[i], gi = g[i], bi = b[i], li = luma[i];
    const isFoliage = clamp((gi - ri) * 8, 0, 1);
    const notBright = clamp((0.64 - li) / 0.12, 0, 1);
    const skinHue = clamp(((ri - gi) - (gi - bi) * 0.95) * 8, 0, 1);
    const warmSkin = clamp((ri - bi) - 0.08, 0, 1) * skinHue * notBright * (1 - isFoliage);
    const coolCloth = clamp((bi - ri) - 0.065, 0, 1) * notBright;
    const darkSubject = clamp(0.32 - li, 0, 1) * (1 - isFoliage);
    pixPen[i] = (warmSkin * 2.5 + coolCloth * 2.5 + darkSubject * 2.8) * 0.45;
    edgeGate[i] = clamp((0.72 - li) / 0.18 + (warmSkin + coolCloth) * 4, 0.05, 1) * 0.45;
    skinSignal[i] = clamp(((ri - bi) - 0.06) / 0.2, 0, 1) * skinHue * clamp((li - 0.14) / 0.24, 0, 1);
    suitCool[i] = clamp(((bi - ri) - 0.07) / 0.18, 0, 1);
  }

  for (let pass = 0; pass < 6; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let c = cost[i];
        const eg = edgeGate[i], pp = pixPen[i];
        if (y > 0) {
          const j = i - w;
          const dRGB = Math.abs(r[i] - r[j]) + Math.abs(g[i] - g[j]) + Math.abs(b[i] - b[j]);
          const nc = cost[j] + dRGB * eg + pp;
          if (nc < c) c = nc;
        }
        if (x > 0) {
          const j = i - 1;
          const dRGB = Math.abs(r[i] - r[j]) + Math.abs(g[i] - g[j]) + Math.abs(b[i] - b[j]);
          const nc = cost[j] + dRGB * eg + pp;
          if (nc < c) c = nc;
        }
        cost[i] = c;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      const row = y * w;
      for (let x = w - 1; x >= 0; x--) {
        const i = row + x;
        let c = cost[i];
        const eg = edgeGate[i], pp = pixPen[i];
        if (y < h - 1) {
          const j = i + w;
          const dRGB = Math.abs(r[i] - r[j]) + Math.abs(g[i] - g[j]) + Math.abs(b[i] - b[j]);
          const nc = cost[j] + dRGB * eg + pp;
          if (nc < c) c = nc;
        }
        if (x < w - 1) {
          const j = i + 1;
          const dRGB = Math.abs(r[i] - r[j]) + Math.abs(g[i] - g[j]) + Math.abs(b[i] - b[j]);
          const nc = cost[j] + dRGB * eg + pp;
          if (nc < c) c = nc;
        }
        cost[i] = c;
      }
    }
  }

  const fgRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = clamp((cost[i] - 0.18) / (0.44 - 0.18), 0, 1);
    fgRaw[i] = t * t * (3 - 2 * t);
  }

  // Keep connected portrait silhouette anchored at the frame center (drops isolated corner bokeh flecks)
  const visited = new Uint8Array(n);
  const seed = Math.floor(h / 2) * w + Math.floor(w / 2);
  if (fgRaw[seed] > 0.3) {
    const stack = [seed];
    visited[seed] = 1;
    while (stack.length > 0) {
      const cur = stack.pop();
      const cx = cur % w;
      const cy = (cur - cx) / w;
      if (cy > 0) { const ni = cur - w; if (!visited[ni] && fgRaw[ni] > 0.3) { visited[ni] = 1; stack.push(ni); } }
      if (cy < h - 1) { const ni = cur + w; if (!visited[ni] && fgRaw[ni] > 0.3) { visited[ni] = 1; stack.push(ni); } }
      if (cx > 0) { const ni = cur - 1; if (!visited[ni] && fgRaw[ni] > 0.3) { visited[ni] = 1; stack.push(ni); } }
      if (cx < w - 1) { const ni = cur + 1; if (!visited[ni] && fgRaw[ni] > 0.3) { visited[ni] = 1; stack.push(ni); } }
    }
    for (let i = 0; i < n; i++) fgRaw[i] *= visited[i];
  }
  const fg = boxBlur(fgRaw, w, h, 1);

  // 2. Chamfer distance from silhouette boundary -> smooth rounded 3D head & shoulder volume
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = fg[i] < 0.45 ? 0 : 40;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let d = dist[i];
      if (y > 0) {
        d = Math.min(d, dist[i - w] + 1);
        if (x > 0) d = Math.min(d, dist[i - w - 1] + 1.414);
        if (x < w - 1) d = Math.min(d, dist[i - w + 1] + 1.414);
      }
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      dist[i] = d;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let d = dist[i];
      if (y < h - 1) {
        d = Math.min(d, dist[i + w] + 1);
        if (x > 0) d = Math.min(d, dist[i + w - 1] + 1.414);
        if (x < w - 1) d = Math.min(d, dist[i + w + 1] + 1.414);
      }
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 1);
      dist[i] = d;
    }
  }
  const domeRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) domeRaw[i] = Math.sqrt(clamp(dist[i] / 22, 0, 1));
  const dome = boxBlur(boxBlur(domeRaw, w, h, 3), w, h, 2);

  // 3. Combine macro volume + photographic shading-to-height & carved facial micro-relief
  const lumaClean = boxBlur(luma, w, h, 1);
  const lumaSmooth = boxBlur(luma, w, h, 5);
  const skinSmooth = boxBlur(boxBlur(skinSignal, w, h, 4), w, h, 3);
  const suitSmooth = boxBlur(suitCool, w, h, 3);

  const heights = new Float32Array(n);
  const albedo = new Float32Array(n);
  const baseZ = 0.14;
  for (let i = 0; i < n; i++) {
    const detail = lumaClean[i] - lumaSmooth[i];
    const lumaNorm = clamp((lumaClean[i] - 0.06) / 0.56, 0, 1);
    const rawRelief = clamp(
      0.26 + 0.30 * dome[i] + 0.18 * skinSmooth[i] - 0.12 * suitSmooth[i] + 0.18 * lumaNorm + 0.26 * detail,
      0.22,
      0.95
    );
    heights[i] = clamp(baseZ + fg[i] * (rawRelief - baseZ), 0.10, 0.95);
    const subjAlbedo = clamp((luma[i] - 0.04) / 0.54, 0.14, 0.96);
    albedo[i] = 0.20 * (1 - fg[i]) + subjAlbedo * fg[i];
  }

  return { heights, albedo, fg };
}

export class PinField {
  constructor(w, h, source) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || source.length !== w * h) {
      throw new RangeError('Portrait grid does not match');
    }
    this.w = w;
    this.h = h;
    this.source = Float32Array.from(source, v => clamp(Number.isFinite(v) ? v : 0, 0, 1));
    this.z = this.source.slice();
    this.v = new Float32Array(w * h);
    this.hold = new Float32Array(w * h);
    this._u = new Float32Array(w * h);
  }

  press(x, y, radius = 12, options = {}) {
    if (![x, y, radius].every(Number.isFinite) || radius <= 0) return;
    const strength = Number.isFinite(options.strength) ? clamp(options.strength, 0.1, 1.2) : 1;
    const holdTime = Number.isFinite(options.hold) ? clamp(options.hold, 0, 0.6) : 0.14;
    const impulse = Number.isFinite(options.impulse) ? clamp(options.impulse, 0, 8) : 1.4;
    radius = clamp(radius, 1, Math.max(this.w, this.h));
    const y0 = Math.max(0, Math.floor(y - radius));
    const y1 = Math.min(this.h, Math.ceil(y + radius));
    const x0 = Math.max(0, Math.floor(x - radius));
    const x1 = Math.min(this.w, Math.ceil(x + radius));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const d = Math.hypot(xx - x, yy - y) / radius;
        if (d >= 1) continue;
        const i = yy * this.w + xx;
        const f = Math.pow(1 - d * d, 1.35) * strength;
        const target = this.source[i] * (1 - f) + 0.015 * f;
        if (target < this.z[i]) {
          this.z[i] = target;
          this.v[i] = Math.min(this.v[i], -impulse * f);
        } else {
          this.v[i] *= 0.35;
        }
        const hVal = holdTime * Math.pow(1 - d, 1.2);
        if (hVal > this.hold[i]) this.hold[i] = hVal;
      }
    }
  }

  stroke(x0, y0, x1, y1, radius = 12, options = {}) {
    if (![x0, y0, x1, y1, radius].every(Number.isFinite) || radius <= 0) return;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.min(48, Math.ceil(dist / Math.max(1.2, radius * 0.22))));
    const baseHold = Number.isFinite(options.hold) ? clamp(options.hold, 0, 0.6) : 0.18;
    const stagger = Number.isFinite(options.stagger) ? clamp(options.stagger, 0, 0.35) : 0;
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 1 : s / steps;
      this.press(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        radius,
        { ...options, hold: baseHold + stagger * t }
      );
    }
  }

  release(x, y, radius = 14, boost = 2.0) {
    const hasPoint = [x, y, radius].every(Number.isFinite) && radius > 0;
    const safeBoost = Number.isFinite(boost) ? clamp(boost, 0, 6) : 2.0;
    const r = hasPoint ? clamp(radius, 1, Math.max(this.w, this.h)) : 0;
    for (let yy = 0; yy < this.h; yy++) {
      const row = yy * this.w;
      for (let xx = 0; xx < this.w; xx++) {
        const i = row + xx;
        if (this.hold[i] > 0) this.hold[i] *= 0.25;
        if (hasPoint) {
          const d = Math.hypot(xx - x, yy - y) / r;
          if (d < 1) {
            const dep = Math.max(0, this.source[i] - this.z[i]);
            this.hold[i] = 0;
            this.v[i] += dep * safeBoost * (1 - d * d);
          }
        }
      }
    }
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = clamp(dt, 0, 1 / 30);
    const sub = Math.max(1, Math.ceil(dt * 180));
    const h = dt / sub;
    const k = 58;
    const c = 5.4;
    const wave = 820;
    const w = this.w, H = this.h, z = this.z, v = this.v, src = this.source, hold = this.hold, u = this._u;
    const n = z.length;

    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) u[i] = z[i] - src[i];
      for (let yy = 0; yy < H; yy++) {
        const row = yy * w;
        const up = yy > 0 ? row - w : row;
        const dn = yy < H - 1 ? row + w : row;
        for (let xx = 0; xx < w; xx++) {
          const i = row + xx;
          if (hold[i] > 0) {
            hold[i] = Math.max(0, hold[i] - h);
            v[i] *= Math.max(0, 1 - 14 * h);
            continue;
          }
          const ui = u[i];
          const uL = xx > 0 ? u[i - 1] : ui;
          const uR = xx < w - 1 ? u[i + 1] : ui;
          const uU = u[up + xx];
          const uD = u[dn + xx];
          const lap = (uL + uR + uU + uD) - 4 * ui;
          const acc = -k * ui - c * v[i] + wave * lap;
          v[i] += acc * h;
          z[i] = clamp(z[i] + v[i] * h, 0, 1);
          if (Math.abs(z[i] - src[i]) < 1e-6 && Math.abs(v[i]) < 1e-5 && Math.abs(lap) < 1e-6) {
            z[i] = src[i];
            v[i] = 0;
          }
        }
      }
    }
  }

  reset() {
    this.z.set(this.source);
    this.v.fill(0);
    this.hold.fill(0);
  }

  snapshot() {
    let displacement = 0, energy = 0, maxDepression = 0, maxOvershoot = 0;
    for (let i = 0; i < this.z.length; i++) {
      const diff = this.z[i] - this.source[i];
      const d = Math.abs(diff);
      displacement += d;
      energy += this.v[i] * this.v[i] + 58 * d * d;
      if (-diff > maxDepression) maxDepression = -diff;
      if (diff > maxOvershoot) maxOvershoot = diff;
    }
    return {
      displacement: displacement / this.z.length,
      energy: energy / this.z.length,
      maxDepression,
      maxOvershoot,
      pins: this.z.length,
    };
  }
}
