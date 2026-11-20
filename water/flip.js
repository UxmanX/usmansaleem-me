// 2-D FLIP/PIC water on a staggered (MAC) grid. SI units, y points DOWN.
// Written for usmansaleem.me/water. Algorithm after Zhu & Bridson (2005) and the
// incompressible-FLIP formulation popularised by M. Müller's Ten Minute Physics notes.
// Obstacles are analytic signed-distance shapes (box, polygon, circle). Static shapes are
// rasterised once; dynamic ones (gate leaves, baffle segments) every substep. Thin shapes get a
// swept test so a fast jet cannot tunnel through them.

export const FLUID = 0, AIR = 1, SOLID = 2;

export class Flip {
  constructor({ width, height, cell, maxParticles, radius }) {
    this.W = width; this.H = height;
    this.h = cell; this.invH = 1 / cell;
    this.nx = Math.floor(width / cell) + 1;
    this.ny = Math.floor(height / cell) + 1;
    const n = this.nx * this.ny;
    this.nCells = n;
    this.u = new Float32Array(n); this.v = new Float32Array(n);
    this.du = new Float32Array(n); this.dv = new Float32Array(n);
    this.prevU = new Float32Array(n); this.prevV = new Float32Array(n);
    this.p = new Float32Array(n);
    this.s = new Float32Array(n);             // 1 = can hold fluid, 0 = solid
    this.type = new Int32Array(n);
    this.dens = new Float32Array(n);
    this.cellShape = new Int16Array(n);       // which shape made a cell solid (-1: border/none)
    this.staticS = new Float32Array(n);
    this.staticShape = new Int16Array(n);
    this.staticNear = new Uint8Array(n);
    this.near2 = new Uint8Array(n);           // cell is within 2 cells of a solid: collision candidates
    this.fluidList = new Int32Array(n);
    this.nFluid = 0;
    this._staticDirty = true;
    this.restDensity = 0;

    this.maxP = maxParticles;
    this.r = radius;
    this.count = 0;
    this.px = new Float32Array(maxParticles); this.py = new Float32Array(maxParticles);
    this.ox = new Float32Array(maxParticles); this.oy = new Float32Array(maxParticles);
    this.vx = new Float32Array(maxParticles); this.vy = new Float32Array(maxParticles);
    this.foam = new Float32Array(maxParticles);   // 0..1 whitewater amount
    this.near = new Uint8Array(maxParticles);     // neighbour count from the last separation pass
    this.phobicHit = new Uint8Array(maxParticles);

    this.pInv = 1 / (2.2 * radius);
    this.pnx = Math.floor(width * this.pInv) + 1;
    this.pny = Math.floor(height * this.pInv) + 1;
    const pn = this.pnx * this.pny;
    this.pNum = new Int32Array(pn);
    this.pFirst = new Int32Array(pn + 1);
    this.pIds = new Int32Array(maxParticles);
    this.pCell = new Int32Array(maxParticles);

    this.shapes = [];
    this.thinShapes = [];
    this._nx = 0; this._ny = -1; this._hit = -1;
    this.nbc = new Uint16Array(maxParticles);
    this.gx = 0; this.gy = 9.81;
    this.flipRatio = 0.92;
    this.iters = 34;
    this.overRelax = 1.9;
    this.separateIters = 2;
    this.friction = 0.15;
    this.adhesionBand = 1.0;      // in particle radii beyond contact
    this.adhesion = 3.5;          // m/s^2 towards a hydrophilic surface inside the band
    this.philicFriction = 0.35;   // tangential damping per contact (sticky sheet)
    this.phobicRestitution = 0.35;
    this.cohesion = 0.0;          // position-based pull for pairs in [2r, 3.1r] (beading)
  }

  // ---------- particles ----------
  add(x, y, vx = 0, vy = 0) {
    if (this.count >= this.maxP) return -1;
    const i = this.count++;
    this.px[i] = x; this.py[i] = y; this.ox[i] = x; this.oy[i] = y;
    this.vx[i] = vx; this.vy[i] = vy; this.foam[i] = 0; this.phobicHit[i] = 0;
    return i;
  }
  // Fill a rectangle with a jittered hexagonal lattice (about 3.2 particles per cell).
  fillRect(x0, y0, x1, y1, jitter = 0.25) {
    const d = 2 * this.r, dy = Math.sqrt(3) / 2 * d;
    let row = 0;
    for (let y = y0 + this.r; y < y1 - this.r * 0.5; y += dy, row++) {
      for (let x = x0 + this.r + (row % 2 ? this.r : 0); x < x1 - this.r * 0.5; x += d) {
        if (this.sdf(x, y) < this.r) continue;
        this.add(x + (Math.random() - 0.5) * jitter * this.r, y + (Math.random() - 0.5) * jitter * this.r);
      }
    }
  }

  // ---------- obstacles ----------
  // { kind:'box', cx, cy, hw, hh, angle } | { kind:'poly', pts:[x,y,...] } | { kind:'circle', cx, cy, r }
  // options: dynamic (moves), thin (swept test), coat ('philic' | 'phobic'), trackForce
  // Every shape gets the same property layout so the hot loops stay monomorphic.
  addShape(o) {
    const sh = {
      kind: o.kind, cx: o.cx || 0, cy: o.cy || 0, hw: o.hw || 0, hh: o.hh || 0, angle: o.angle || 0,
      r: o.r || 0, pts: o.pts || null, vx: o.vx || 0, vy: o.vy || 0, w: o.w || 0,
      enabled: o.enabled !== false, dynamic: !!o.dynamic, thin: !!o.thin,
      x0: 0, y0: 0, x1: 0, y1: 0, ca: 1, sa: 0,
      coat: o.coat || '', trackForce: !!o.trackForce, fx: 0, fy: 0,
      beam: o.beam === undefined ? -1 : o.beam, leaf: o.leaf || 0,
    };
    this._bounds(sh);
    this.shapes.push(sh);
    if (!sh.dynamic) this._staticDirty = true;
    if (sh.thin && sh.kind === 'box') this.thinShapes.push(sh);
    return sh;
  }
  _bounds(sh) {
    if (sh.kind === 'box') {
      sh.ca = Math.cos(sh.angle); sh.sa = Math.sin(sh.angle);
      const c = Math.abs(sh.ca), s = Math.abs(sh.sa);
      const ex = sh.hw * c + sh.hh * s, ey = sh.hw * s + sh.hh * c;
      sh.x0 = sh.cx - ex; sh.x1 = sh.cx + ex; sh.y0 = sh.cy - ey; sh.y1 = sh.cy + ey;
    } else if (sh.kind === 'circle') {
      sh.x0 = sh.cx - sh.r; sh.x1 = sh.cx + sh.r; sh.y0 = sh.cy - sh.r; sh.y1 = sh.cy + sh.r;
    } else {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const p = sh.pts;
      for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); y0 = Math.min(y0, p[k + 1]); y1 = Math.max(y1, p[k + 1]); }
      sh.x0 = x0; sh.x1 = x1; sh.y0 = y0; sh.y1 = y1;
    }
  }
  moveShape(sh, cx, cy, dt) {
    if (dt > 0) { sh.vx = (cx - sh.cx) / dt; sh.vy = (cy - sh.cy) / dt; }
    sh.cx = cx; sh.cy = cy; this._bounds(sh);
  }
  static sdShape(sh, x, y) {
    if (sh.kind === 'box') {
      const dx0 = x - sh.cx, dy0 = y - sh.cy;
      const dx = sh.ca * dx0 + sh.sa * dy0, dy = -sh.sa * dx0 + sh.ca * dy0;
      const qx = (dx < 0 ? -dx : dx) - sh.hw, qy = (dy < 0 ? -dy : dy) - sh.hh;
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
      const inside = qx > qy ? qx : qy;
      return Math.sqrt(ox * ox + oy * oy) + (inside < 0 ? inside : 0);
    }
    if (sh.kind === 'circle') { const dx = x - sh.cx, dy = y - sh.cy; return Math.sqrt(dx * dx + dy * dy) - sh.r; }
    // polygon (Inigo Quilez, sdPolygon)
    const v = sh.pts, N = v.length / 2;
    let d = (x - v[0]) ** 2 + (y - v[1]) ** 2, sgn = 1;
    for (let i = 0, j = N - 1; i < N; j = i, i++) {
      const ex = v[2 * j] - v[2 * i], ey = v[2 * j + 1] - v[2 * i + 1];
      const wx = x - v[2 * i], wy = y - v[2 * i + 1];
      const t = Math.min(Math.max((wx * ex + wy * ey) / (ex * ex + ey * ey), 0), 1);
      const bx = wx - ex * t, by = wy - ey * t;
      d = Math.min(d, bx * bx + by * by);
      const c1 = y >= v[2 * i + 1], c2 = y < v[2 * j + 1], c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sgn = -sgn;
    }
    return sgn * Math.sqrt(d);
  }
  // Distance to the nearest solid (domain walls included). Sets this._hit to the shape index.
  sdf(x, y, pad = 0) {
    const h = this.h;
    let d = Math.min(x - h, (this.nx - 1) * h - x, y - h, (this.ny - 1) * h - y);
    this._hit = -1;
    const S = this.shapes;
    for (let k = 0; k < S.length; k++) {
      const sh = S[k];
      if (!sh.enabled) continue;
      if (x < sh.x0 - pad || x > sh.x1 + pad || y < sh.y0 - pad || y > sh.y1 + pad) continue;
      const ds = Flip.sdShape(sh, x, y);
      if (ds < d) { d = ds; this._hit = k; }
    }
    return d;
  }
  // Same as sdf() but also returns the outward normal of the nearest surface in this._nx/_ny (analytic for boxes).
  sdfN(x, y, pad) {
    const h = this.h, X1 = (this.nx - 1) * h, Y1 = (this.ny - 1) * h;
    let d = x - h, nX = 1, nY = 0;
    if (X1 - x < d) { d = X1 - x; nX = -1; nY = 0; }
    if (y - h < d) { d = y - h; nX = 0; nY = 1; }
    if (Y1 - y < d) { d = Y1 - y; nX = 0; nY = -1; }
    let hit = -1;
    const S = this.shapes;
    for (let k = 0; k < S.length; k++) {
      const sh = S[k];
      if (!sh.enabled || x < sh.x0 - pad || x > sh.x1 + pad || y < sh.y0 - pad || y > sh.y1 + pad) continue;
      const ds = Flip.sdShape(sh, x, y);
      if (ds < d) { d = ds; hit = k; }
    }
    this._hit = hit;
    if (hit >= 0) {
      const sh = S[hit];
      if (sh.kind === 'box') {
        const dx0 = x - sh.cx, dy0 = y - sh.cy;
        const lx = sh.ca * dx0 + sh.sa * dy0, ly = -sh.sa * dx0 + sh.ca * dy0;
        const qx = (lx < 0 ? -lx : lx) - sh.hw, qy = (ly < 0 ? -ly : ly) - sh.hh;
        let ax, ay;
        if (qx > 0 || qy > 0) { ax = qx > 0 ? (lx < 0 ? -qx : qx) : 0; ay = qy > 0 ? (ly < 0 ? -qy : qy) : 0; const l = Math.sqrt(ax * ax + ay * ay) || 1; ax /= l; ay /= l; }
        else if (qx > qy) { ax = lx < 0 ? -1 : 1; ay = 0; } else { ax = 0; ay = ly < 0 ? -1 : 1; }
        nX = sh.ca * ax - sh.sa * ay; nY = sh.sa * ax + sh.ca * ay;
      } else if (sh.kind === 'circle') {
        const dx = x - sh.cx, dy = y - sh.cy, l = Math.sqrt(dx * dx + dy * dy) || 1; nX = dx / l; nY = dy / l;
      } else {
        const e = 1e-4;
        const gx = Flip.sdShape(sh, x + e, y) - Flip.sdShape(sh, x - e, y), gy = Flip.sdShape(sh, x, y + e) - Flip.sdShape(sh, x, y - e);
        const l = Math.sqrt(gx * gx + gy * gy) || 1; nX = gx / l; nY = gy / l;
      }
    }
    this._nx = nX; this._ny = nY;
    return d;
  }

  // ---------- solid mask ----------
  _rasterStatic() {
    const { nx, ny, h, staticS, staticShape, staticNear } = this;
    const S = this.shapes;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const c = i * ny + j;
        if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) { staticS[c] = 0; staticShape[c] = -1; continue; }
        const x = (i + 0.5) * h, y = (j + 0.5) * h;
        let hit = -1;
        for (let k = 0; k < S.length; k++) {
          const sh = S[k];
          if (sh.dynamic || !sh.enabled || x < sh.x0 || x > sh.x1 || y < sh.y0 || y > sh.y1) continue;
          if (Flip.sdShape(sh, x, y) < 0) { hit = k; break; }
        }
        staticS[c] = hit >= 0 ? 0 : 1; staticShape[c] = hit;
      }
    }
    // dilate by 2 cells: particles in these cells are collision candidates
    staticNear.fill(0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (staticS[i * ny + j] !== 0) continue;
      for (let a = Math.max(0, i - 2); a <= Math.min(nx - 1, i + 2); a++) for (let b = Math.max(0, j - 2); b <= Math.min(ny - 1, j + 2); b++) staticNear[a * ny + b] = 1;
    }
    // static solid faces are at rest
    for (let c = 0; c < this.nCells; c++) if (staticS[c] === 0) { this.u[c] = 0; this.v[c] = 0; if (c + ny < this.nCells) this.u[c + ny] = 0; if (c + 1 < this.nCells) this.v[c + 1] = 0; }
    this._staticDirty = false;
  }
  _markSolids() {
    if (this._staticDirty) this._rasterStatic();
    const { nx, ny, h, s, u, v, cellShape, near2 } = this;
    s.set(this.staticS); cellShape.set(this.staticShape); near2.set(this.staticNear);
    // start from zero face velocities: a face a moving leaf once shared with a static wall must not keep the
    // leaf's velocity (the restore in _toGrid would otherwise copy it forever). Nothing reads u/v before _toGrid.
    u.fill(0); v.fill(0);
    const S = this.shapes;
    for (let k = 0; k < S.length; k++) {
      const sh = S[k];
      if (!sh.dynamic || !sh.enabled) continue;
      const i0 = Math.max(1, Math.floor(sh.x0 * this.invH)), i1 = Math.min(nx - 2, Math.floor(sh.x1 * this.invH));
      const j0 = Math.max(1, Math.floor(sh.y0 * this.invH)), j1 = Math.min(ny - 2, Math.floor(sh.y1 * this.invH));
      for (let i = Math.max(0, i0 - 2); i <= Math.min(nx - 1, i1 + 2); i++) for (let j = Math.max(0, j0 - 2); j <= Math.min(ny - 1, j1 + 2); j++) near2[i * ny + j] = 1;
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const c = i * ny + j;
          if (s[c] === 0) continue;
          const x = (i + 0.5) * h, y = (j + 0.5) * h;
          if (Flip.sdShape(sh, x, y) >= 0) continue;
          s[c] = 0; cellShape[c] = k;
          const fu = sh.vx - sh.w * (y - sh.cy), fv = sh.vy + sh.w * (x - sh.cx);
          u[c] = fu; u[c + ny] = fu; v[c] = fv; v[c + 1] = fv;
        }
      }
    }
  }

  // ---------- solver ----------
  _integrate(dt) {
    const { count, px, py, ox, oy, vx, vy, gx, gy } = this;
    const hit = this.phobicHit;
    for (let i = 0; i < count; i++) {
      ox[i] = px[i]; oy[i] = py[i];
      vx[i] += gx * dt; vy[i] += gy * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt;
      if (hit[i] > 0) hit[i]--;
    }
  }

  _separate() {
    const { count, px, py, pnx, pny, pInv, pNum, pFirst, pIds, pCell, near } = this;
    pNum.fill(0);
    for (let i = 0; i < count; i++) {
      let xi = (px[i] * pInv) | 0, yi = (py[i] * pInv) | 0;
      xi = xi < 0 ? 0 : xi >= pnx ? pnx - 1 : xi; yi = yi < 0 ? 0 : yi >= pny ? pny - 1 : yi;
      const c = xi * pny + yi;
      pCell[i] = c; pNum[c]++;
    }
    let first = 0;
    const pn = pnx * pny;
    for (let k = 0; k < pn; k++) { first += pNum[k]; pFirst[k] = first; }
    pFirst[pn] = first;
    for (let i = 0; i < count; i++) { const c = pCell[i]; pFirst[c]--; pIds[pFirst[c]] = i; }
    const minD = 2 * this.r, minD2 = minD * minD, nearD2 = (3.2 * this.r) ** 2;
    const coh = this.cohesion, cohD2 = (3.1 * this.r) ** 2, hit = this.phobicHit;
    const nbc = this.nbc || (this.nbc = new Uint16Array(this.maxP));
    for (let it = 0; it < this.separateIters; it++) {
      const countNear = it === 0;
      if (countNear) nbc.fill(0, 0, count);
      for (let i = 0; i < count; i++) {
        let x = px[i], y = py[i];
        const c0 = pCell[i], xi = (c0 / pny) | 0, yi = c0 - xi * pny;
        const x0 = xi > 0 ? xi - 1 : 0, x1 = xi < pnx - 1 ? xi + 1 : pnx - 1;
        const y0 = yi > 0 ? yi - 1 : 0, y1 = yi < pny - 1 ? yi + 1 : pny - 1;
        const hi = hit[i];
        let nb = 0;
        for (let a = x0; a <= x1; a++) {
          const base = a * pny;
          const f = pFirst[base + y0], l = pFirst[base + y1 + 1];   // cells y0..y1 of a column are contiguous
          for (let k = f; k < l; k++) {
            const id = pIds[k];
            if (id <= i) continue;                                     // each pair once
            let dx = px[id] - x, dy = py[id] - y;
            const d2 = dx * dx + dy * dy;
            if (d2 > nearD2) continue;
            if (countNear) { nb++; nbc[id]++; }
            if (d2 > minD2 || d2 === 0) {
              if (coh > 0 && d2 < cohD2 && (hi || hit[id])) {
                const d = Math.sqrt(d2), sc = 0.5 * coh * (d - minD) / d;
                x += dx * sc; y += dy * sc; px[id] -= dx * sc; py[id] -= dy * sc;
              }
              continue;
            }
            const d = Math.sqrt(d2), sc = 0.5 * (minD - d) / d;
            dx *= sc; dy *= sc;
            x -= dx; y -= dy;
            px[id] += dx; py[id] += dy;
          }
        }
        px[i] = x; py[i] = y;
        if (countNear) nbc[i] += nb;
      }
      if (countNear) for (let i = 0; i < count; i++) near[i] = nbc[i] > 255 ? 255 : nbc[i];
    }
  }

  // Particle vs. analytic solids. Shapes may carry coat: 'philic' (sticky, sheets off) or 'phobic'
  // (free slip, elastic rebound): a cheap stand-in for contact angle in a solver without surface tension.
  _collide(dt) {
    const { count, px, py, ox, oy, vx, vy, r, near2, ny, invH, nx } = this;
    const S = this.shapes;
    const band = this.adhesionBand * r;
    for (let i = 0; i < count; i++) {
      let x = px[i], y = py[i];
      let ci = (x * invH) | 0, cj = (y * invH) | 0;
      ci = ci < 0 ? 0 : ci >= nx ? nx - 1 : ci; cj = cj < 0 ? 0 : cj >= ny ? ny - 1 : cj;
      if (!near2[ci * ny + cj]) continue;
      // swept test against thin boxes: keep the particle on the side it came from
      const TS = this.thinShapes;
      for (let q = 0; q < TS.length; q++) {
        const sh = TS[q];
        if (!sh.enabled) continue;
        const pad = r + Math.abs(x - ox[i]) + Math.abs(y - oy[i]);
        if (x < sh.x0 - pad || x > sh.x1 + pad || y < sh.y0 - pad || y > sh.y1 + pad) continue;
        const ca = sh.ca, sa = sh.sa;
        const dx = x - sh.cx, dy = y - sh.cy, pdx = ox[i] - sh.cx, pdy = oy[i] - sh.cy;
        const lx = ca * dx + sa * dy, ly = -sa * dx + ca * dy;
        const plx = ca * pdx + sa * pdy, ply = -sa * pdx + ca * pdy;
        const lim = sh.hh + r;
        if (Math.abs(ply) >= sh.hh && Math.abs(lx) <= sh.hw + r * 0.5 && Math.abs(plx) <= sh.hw + r * 0.5 && (ply > 0 ? ly < lim : ly > -lim)) {
          const side = ply > 0 ? 1 : -1;
          const nly = side * lim;
          x = sh.cx + ca * lx - sa * nly; y = sh.cy + sa * lx + ca * nly;
          const nX = -sa * side, nY = ca * side;
          let rvx = vx[i] - sh.vx, rvy = vy[i] - sh.vy;
          const vn = rvx * nX + rvy * nY;
          if (vn < 0) {
            const rest = sh.coat === 'phobic' ? this.phobicRestitution : 0;
            const fr = sh.coat === 'phobic' ? 0 : sh.coat === 'philic' ? this.philicFriction : this.friction;
            rvx -= (1 + rest) * vn * nX; rvy -= (1 + rest) * vn * nY;
            const vt = -rvx * nY + rvy * nX;
            rvx += fr * vt * nY; rvy -= fr * vt * nX;
            if (sh.coat === 'phobic') this.phobicHit[i] = 90;
          }
          vx[i] = rvx + sh.vx; vy[i] = rvy + sh.vy;
        }
      }
      const d = this.sdfN(x, y, r + band);
      if (d >= r + band) { px[i] = x; py[i] = y; continue; }
      const k = this._hit;
      const coat = k >= 0 ? S[k].coat : '';
      if (d >= r && coat !== 'philic') { px[i] = x; py[i] = y; continue; }
      const nX = this._nx, nY = this._ny;
      if (d >= r) { // adhesion band of a hydrophilic surface: pull gently towards it
        vx[i] -= nX * this.adhesion * dt; vy[i] -= nY * this.adhesion * dt;
        px[i] = x; py[i] = y;
        continue;
      }
      const push = r - d;
      x += nX * push; y += nY * push;
      let wvx = 0, wvy = 0;
      if (k >= 0) { const sh = S[k]; wvx = sh.vx - sh.w * (y - sh.cy); wvy = sh.vy + sh.w * (x - sh.cx); }
      let rvx = vx[i] - wvx, rvy = vy[i] - wvy;
      const vn = rvx * nX + rvy * nY;
      if (vn < 0) {
        let rest = 0, fr = this.friction;
        if (coat === 'phobic') { rest = this.phobicRestitution; fr = 0.0; }
        else if (coat === 'philic') { fr = this.philicFriction; }
        rvx -= (1 + rest) * vn * nX; rvy -= (1 + rest) * vn * nY;
        const vt = -rvx * nY + rvy * nX;
        rvx += fr * vt * nY; rvy -= fr * vt * nX;
        if (coat === 'phobic') this.phobicHit[i] = 90;
      }
      vx[i] = rvx + wvx; vy[i] = rvy + wvy;
      px[i] = x; py[i] = y;
    }
  }

  _cellIndex(x, y) {
    let i = (x * this.invH) | 0, j = (y * this.invH) | 0;
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i; j = j < 0 ? 0 : j >= this.ny ? this.ny - 1 : j;
    return i * this.ny + j;
  }

  _density() {
    const { nx, ny, h, invH, dens, count, px, py, type } = this;
    const h2 = 0.5 * h, xmax = (nx - 1) * h, ymax = (ny - 1) * h;
    dens.fill(0);
    for (let i = 0; i < count; i++) {
      const x = px[i] < h ? h : px[i] > xmax ? xmax : px[i];
      const y = py[i] < h ? h : py[i] > ymax ? ymax : py[i];
      const x0 = ((x - h2) * invH) | 0, tx = (x - h2 - x0 * h) * invH, x1 = Math.min(x0 + 1, nx - 2);
      const y0 = ((y - h2) * invH) | 0, ty = (y - h2 - y0 * h) * invH, y1 = Math.min(y0 + 1, ny - 2);
      const sx = 1 - tx, sy = 1 - ty;
      dens[x0 * ny + y0] += sx * sy;
      dens[x1 * ny + y0] += tx * sy;
      dens[x1 * ny + y1] += tx * ty;
      dens[x0 * ny + y1] += sx * ty;
    }
    if (this.restDensity === 0) {
      let sum = 0, num = 0;
      for (let c = 0; c < this.nCells; c++) if (type[c] === FLUID) { sum += dens[c]; num++; }
      if (num > 0) this.restDensity = sum / num;
    }
  }

  _toGrid() {
    const { nx, ny, h, invH, u, v, du, dv, prevU, prevV, s, type, count, px, py, vx, vy } = this;
    prevU.set(u); prevV.set(v);
    du.fill(0); dv.fill(0); u.fill(0); v.fill(0);
    for (let c = 0; c < this.nCells; c++) type[c] = s[c] === 0 ? SOLID : AIR;
    for (let i = 0; i < count; i++) {
      const c = this._cellIndex(px[i], py[i]);
      if (type[c] === AIR) type[c] = FLUID;
    }
    const h2 = 0.5 * h, xmax = (nx - 1) * h, ymax = (ny - 1) * h;
    for (let comp = 0; comp < 2; comp++) {
      const dx = comp === 0 ? 0 : h2, dy = comp === 0 ? h2 : 0;
      const f = comp === 0 ? u : v, d = comp === 0 ? du : dv, pv = comp === 0 ? vx : vy;
      for (let i = 0; i < count; i++) {
        const x = px[i] < h ? h : px[i] > xmax ? xmax : px[i];
        const y = py[i] < h ? h : py[i] > ymax ? ymax : py[i];
        const x0 = Math.min(((x - dx) * invH) | 0, nx - 2), tx = (x - dx - x0 * h) * invH, x1 = Math.min(x0 + 1, nx - 2);
        const y0 = Math.min(((y - dy) * invH) | 0, ny - 2), ty = (y - dy - y0 * h) * invH, y1 = Math.min(y0 + 1, ny - 2);
        const sx = 1 - tx, sy = 1 - ty;
        const d0 = sx * sy, d1 = tx * sy, d2 = tx * ty, d3 = sx * ty;
        const n0 = x0 * ny + y0, n1 = x1 * ny + y0, n2 = x1 * ny + y1, n3 = x0 * ny + y1;
        const val = pv[i];
        f[n0] += val * d0; d[n0] += d0;
        f[n1] += val * d1; d[n1] += d1;
        f[n2] += val * d2; d[n2] += d2;
        f[n3] += val * d3; d[n3] += d3;
      }
      for (let c = 0; c < this.nCells; c++) if (d[c] > 0) f[c] /= d[c];
    }
    // restore velocities on faces that touch a solid cell (prev holds the rigid velocity)
    let nf = 0;
    const fl = this.fluidList;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const c = i * ny + j;
        const t = type[c];
        if (t === FLUID && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) fl[nf++] = c;
        const solid = t === SOLID;
        if (solid || (i > 0 && type[c - ny] === SOLID)) u[c] = prevU[c];
        if (solid || (j > 0 && type[c - 1] === SOLID)) v[c] = prevV[c];
      }
    }
    this.nFluid = nf;
  }

  _solve() {
    const { ny, u, v, s, p, dens, fluidList, nFluid } = this;
    const rest = this.restDensity, or = this.overRelax;
    p.fill(0);
    // FLIP needs the grid velocity right after the particle->grid transfer, before projection
    this.prevU.set(u); this.prevV.set(v);
    for (let it = 0; it < this.iters; it++) {
      for (let q = 0; q < nFluid; q++) {
        const c = fluidList[q];
        const l = c - ny, rr = c + ny, b = c - 1, t = c + 1;
        const sx0 = s[l], sx1 = s[rr], sy0 = s[b], sy1 = s[t];
        const sum = sx0 + sx1 + sy0 + sy1;
        if (sum === 0) continue;
        let div = u[rr] - u[c] + v[t] - v[c];
        if (rest > 0) { const comp = dens[c] - rest; if (comp > 0) div -= comp; }
        const pp = -div / sum * or;
        p[c] += pp;
        u[c] -= sx0 * pp; u[rr] += sx1 * pp;
        v[c] -= sy0 * pp; v[t] += sy1 * pp;
      }
    }
  }

  // Pressure force on shapes flagged trackForce, N per metre of depth (multiply by depth outside).
  // p holds the accumulated velocity correction; physical pressure = rho * h / dt * p.
  _shapeForces(dt) {
    const S = this.shapes;
    let any = false;
    for (let k = 0; k < S.length; k++) if (S[k].trackForce) { S[k].fx = 0; S[k].fy = 0; any = true; }
    if (!any) return;
    const { nx, ny, s, p, type, cellShape, h } = this;
    const scale = 1000 * h / dt * h;           // rho * h / dt (pressure) * face length h
    for (let k = 0; k < S.length; k++) {
      const sh = S[k];
      if (!sh.trackForce) continue;
      const i0 = Math.max(1, Math.floor(sh.x0 * this.invH)), i1 = Math.min(nx - 2, Math.floor(sh.x1 * this.invH));
      const j0 = Math.max(1, Math.floor(sh.y0 * this.invH)), j1 = Math.min(ny - 2, Math.floor(sh.y1 * this.invH));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const c = i * ny + j;
        if (s[c] !== 0 || cellShape[c] !== k) continue;
        if (type[c - ny] === FLUID) sh.fx += p[c - ny] * scale;   // fluid on the left pushes +x
        if (type[c + ny] === FLUID) sh.fx -= p[c + ny] * scale;
        if (type[c - 1] === FLUID) sh.fy += p[c - 1] * scale;     // fluid above (smaller y) pushes +y (down)
        if (type[c + 1] === FLUID) sh.fy -= p[c + 1] * scale;
      }
    }
  }

  _toParticles() {
    const { nx, ny, h, invH, u, v, prevU, prevV, type, count, px, py, vx, vy } = this;
    const h2 = 0.5 * h, fr = this.flipRatio, xmax = (nx - 1) * h, ymax = (ny - 1) * h;
    for (let comp = 0; comp < 2; comp++) {
      const dx = comp === 0 ? 0 : h2, dy = comp === 0 ? h2 : 0;
      const f = comp === 0 ? u : v, pf = comp === 0 ? prevU : prevV, out = comp === 0 ? vx : vy;
      const off = comp === 0 ? ny : 1;
      for (let i = 0; i < count; i++) {
        const x = px[i] < h ? h : px[i] > xmax ? xmax : px[i];
        const y = py[i] < h ? h : py[i] > ymax ? ymax : py[i];
        const x0 = Math.min(((x - dx) * invH) | 0, nx - 2), tx = (x - dx - x0 * h) * invH, x1 = Math.min(x0 + 1, nx - 2);
        const y0 = Math.min(((y - dy) * invH) | 0, ny - 2), ty = (y - dy - y0 * h) * invH, y1 = Math.min(y0 + 1, ny - 2);
        const sx = 1 - tx, sy = 1 - ty;
        const d0 = sx * sy, d1 = tx * sy, d2 = tx * ty, d3 = sx * ty;
        const n0 = x0 * ny + y0, n1 = x1 * ny + y0, n2 = x1 * ny + y1, n3 = x0 * ny + y1;
        const v0 = type[n0] !== AIR || type[n0 - off] !== AIR ? 1 : 0;
        const v1 = type[n1] !== AIR || type[n1 - off] !== AIR ? 1 : 0;
        const v2 = type[n2] !== AIR || type[n2 - off] !== AIR ? 1 : 0;
        const v3 = type[n3] !== AIR || type[n3 - off] !== AIR ? 1 : 0;
        const d = v0 * d0 + v1 * d1 + v2 * d2 + v3 * d3;
        if (d > 0) {
          const pic = (v0 * d0 * f[n0] + v1 * d1 * f[n1] + v2 * d2 * f[n2] + v3 * d3 * f[n3]) / d;
          const corr = (v0 * d0 * (f[n0] - pf[n0]) + v1 * d1 * (f[n1] - pf[n1]) + v2 * d2 * (f[n2] - pf[n2]) + v3 * d3 * (f[n3] - pf[n3])) / d;
          out[i] = (1 - fr) * pic + fr * (out[i] + corr);
        }
      }
    }
  }

  // Grid velocity at a point (bubbles, readouts). Writes into out[0], out[1].
  sampleVel(x, y, out) {
    const { nx, ny, h, invH, u, v } = this;
    x = Math.min(Math.max(x, h), (nx - 1) * h); y = Math.min(Math.max(y, h), (ny - 1) * h);
    for (let comp = 0; comp < 2; comp++) {
      const dx = comp === 0 ? 0 : 0.5 * h, dy = comp === 0 ? 0.5 * h : 0, f = comp === 0 ? u : v;
      const x0 = Math.min(Math.floor((x - dx) * invH), nx - 2), tx = (x - dx - x0 * h) * invH, x1 = Math.min(x0 + 1, nx - 2);
      const y0 = Math.min(Math.floor((y - dy) * invH), ny - 2), ty = (y - dy - y0 * h) * invH, y1 = Math.min(y0 + 1, ny - 2);
      out[comp] = (1 - tx) * (1 - ty) * f[x0 * ny + y0] + tx * (1 - ty) * f[x1 * ny + y0] + tx * ty * f[x1 * ny + y1] + (1 - tx) * ty * f[x0 * ny + y1];
    }
    return out;
  }
  cellTypeAt(x, y) { return this.type[this._cellIndex(x, y)]; }

  step(dt) {
    this._integrate(dt);
    if (this.separateIters > 0) this._separate();
    this._markSolids();
    this._collide(dt);
    this._toGrid();
    this._density();
    this._solve();
    this._shapeForces(dt);
    this._toParticles();
  }
}
