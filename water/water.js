// usmansaleem.me/water — "Open the gate": a living hydraulic cross-section.
// Solver: flip.js (2-D FLIP). Water look: gl.js (WebGL2). Drawing + annotations: 2-D canvas.
import { Flip, AIR } from './flip.js?v=2';
import { createRenderer } from './gl.js?v=2';

const $ = (s, r = document) => r.querySelector(s);
const DEBUG = new URLSearchParams(location.search).has('debug');
const CLEAN = new URLSearchParams(location.search).has('clean');
const SUBSTEPS = DEBUG && new URLSearchParams(location.search).get('sub') ? Math.max(1, Math.min(4, +new URLSearchParams(location.search).get('sub'))) : 1;
const RHO = 998, MU = 1.002e-3, G0 = 9.81;
const DEPTH = 0.12;            // flume depth into the page (m)
const CD = 0.62;               // sharp-edged orifice discharge coefficient (model)
const E_AL = 69e9, SY_AL = 276e6;                       // 6061-T6
const BOX = { b: 0.12, h: 0.04, t: 0.003 };             // baffle box section (m)
const I_BOX = (BOX.b * BOX.h ** 3 - (BOX.b - 2 * BOX.t) * (BOX.h - 2 * BOX.t) ** 3) / 12;
const C_BOX = BOX.h / 2;
const DEFL_SCALE = 10;

const INK = '#14171a', MUTED = '#5e6876', FAINT = '#8a96a3', HAIR = '#d8d3c8', ORANGE = '#ff541e', ORANGE_TXT = '#c2410c', CYAN = '#00d2ff', CYAN_INK = '#0b7d99';

const stageEl = $('#stage');
let glCanvas = $('#gl');
const inkCanvas = $('#ink');
const ink = inkCanvas.getContext('2d');
const gripEl = $('#grip');
const hintEl = $('#stage-hint');
const gateIn = $('#gate'), gateOut = $('#gate-out');
const radarBtn = $('#radar-btn'), pumpBtn = $('#pump-btn'), refillBtn = $('#refill-btn'), tiltBtn = $('#tilt-btn');
const soundBtn = $('#sound-btn'), motionBtn = $('#motion-btn'), dyeBtn = $('#dye-btn');
const scaleEl = gateIn.closest('.scale'), ticksEl = $('#gate-ticks');
const R = {}; document.querySelectorAll('[data-r]').forEach((el) => { R[el.dataset.r] = el; });

const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

const state = {
  motion: store.get('water-motion') ? store.get('water-motion') === 'on' : !reduceMQ.matches,
  sound: false,
  pump: true,
  dye: store.get('water-dye') !== 'off',     // Reynolds dye needles in the head tank
  coat: 'philic',
  gate: { pos: 0, vel: 0, target: 0 },
  radar: { phase: 'idle', t: 0 },
  tilt: { on: false, gx: 0, gy: 1 },
  shake: { x: screenX, y: screenY, vx: 0, vy: 0, ax: 0, ay: 0 },
  pointer: null,
  focus: null,                                 // linked instrument: null | 'head' | 'orifice' | 'flow' | 'baffle'
  focusLock: false,                            // set by a tap/click (stays until tapped again)
  intro: { t: 0, ping: -1, nudged: false },    // live opening timeline (seconds since boot)
  ultraFailed: false,
  frames: 0, simTime: 0, lastT: 0,
  perf: { sim: 0, draw: 0, frame: 16 },
};
// Reynolds dye: Prussian drafting ink, self-cleaning (half-lives from Neon's spec)
const DYE_TAU = { tank: 30, sump: 9.0 / Math.LN2, weir: 3.5 / Math.LN2 };
const STREAK_MAX = 64;

let world = null;       // { W, H, scale, cell, sim, G, ... }
let renderer = null;
let fallback2d = null;
let partData = null;
let sheetCanvas = null;
const staticInk = document.getElementById('ink-static');   // drawn once per layout, never per frame

// ---------------------------------------------------------------- geometry
function buildWorld() {
  const rect = stageEl.getBoundingClientRect();
  const cssW = Math.max(240, Math.round(rect.width)), cssH = Math.max(240, Math.round(rect.height));
  const phone = cssW < 640;
  const W = phone ? 1.5 : 2.4;
  const scale = cssW / W;
  const H = cssH / scale;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // ultra: finer water on capable desktops, confirmed by a silent benchmark in fillWater()
  const ultraOK = !phone && !coarse && (navigator.hardwareConcurrency || 4) >= 8 && !state.ultraFailed;
  const tier = DEBUG && new URLSearchParams(location.search).get('tier') || (phone || coarse ? 'mid' : ultraOK ? 'ultra' : 'high');
  const cells = tier === 'ultra' ? 150 : tier === 'high' ? 104 : tier === 'mid' ? 64 : 50;
  const cell = W / cells;
  const r = 0.3 * cell;
  const G = { W, H, cell, phone };
  const t = Math.max(2.1 * cell, 0.045);
  G.t = t;
  G.tankX0 = W * (phone ? 0.22 : 0.20); G.tankX1 = W * (phone ? 0.80 : 0.74);
  G.tankTop = H * 0.085; G.floorY = H * (phone ? 0.315 : 0.335);
  G.floorT = Math.max(2.2 * cell, 0.05);
  G.xc = (G.tankX0 + G.tankX1) / 2;
  G.aMax = Math.min(0.20, (G.tankX1 - G.tankX0) * 0.155);
  G.leafL = G.aMax / 2 + Math.max(0.05, 2 * cell);
  G.h0 = (G.floorY - G.tankTop) * 0.74;
  // the sump's left wall sits under the tank's left wall: one concrete pier with soil behind it
  G.sX0 = G.tankX0; G.sX1 = W * 0.935;
  G.sFloor = H * 0.955; G.sTop = H * 0.70;
  G.weirX = W * 0.80; G.weirT = Math.max(1.8 * cell, 0.035);
  G.weirCrest = G.sFloor - (G.sFloor - G.sTop) * 0.46;
  G.sFill = G.sFloor - (G.sFloor - G.sTop) * 0.22;
  // baffle: cantilevered from the pier at up to 35°, so most of the jet runs down-slope. A plate at angle θ
  // sends (1 - sin θ)/2 of the flow uphill; that part decelerates at g·sin θ and stops short of the pier.
  G.beamT = Math.max(1.9 * cell, 0.04);
  G.colX0 = G.sX0 - t; G.colX1 = G.sX0;
  G.tipX = G.xc + (phone ? 0.17 : 0.22);
  G.tipY = G.sTop + 0.04;
  G.rootY = Math.max(G.floorY + G.floorT + 0.10, G.tipY - (G.tipX - G.colX1) * Math.tan(35 * Math.PI / 180));
  G.beamAng = Math.atan((G.tipY - G.rootY) / (G.tipX - G.colX1));
  G.pierTop = G.floorY + G.floorT;
  G.beamL = (G.tipX - G.colX1) / Math.cos(G.beamAng);
  G.pipeX = (G.sX1 + t + W) / 2;
  G.hdrY = G.tankTop - 0.055;                               // distribution header (riser end) across the tank
  G.hdrX0 = G.tankX0 + Math.max(0.07, 3 * cell); G.hdrX1 = G.tankX1 - Math.max(0.07, 3 * cell);
  // Reynolds dye needles: hung from a manifold at the tank top, tips 0.35 h0 above the gate floor,
  // the outer two about one gate width either side so their streaklines must turn into the vena contracta
  const nOff = G.aMax * 0.95, nY = G.floorY - 0.35 * G.h0;
  G.needles = [[G.xc - nOff, nY], [G.xc, nY - 0.04], [G.xc + nOff, nY]];

  const maxP = tier === 'ultra' ? 15000 : tier === 'high' ? 11000 : tier === 'mid' ? 5200 : 3200;
  const sim = new Flip({ width: W, height: H, cell, maxParticles: maxP, radius: r });
  sim.iters = tier === 'ultra' || tier === 'high' ? 34 : 26;
  sim.dyeMix = 0.004;
  const box = (x0, y0, x1, y1, extra = {}) => sim.addShape({ kind: 'box', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2, ...extra });
  const S = {};
  // head tank
  S.tankL = box(G.tankX0 - t, G.tankTop - 0.02, G.tankX0, G.floorY + G.floorT);
  S.tankR = box(G.tankX1, G.tankTop - 0.02, G.tankX1 + t, G.floorY + G.floorT);
  S.floorL = box(G.tankX0 - t, G.floorY, G.xc - G.aMax / 2, G.floorY + G.floorT);
  S.floorR = box(G.xc + G.aMax / 2, G.floorY, G.tankX1 + t, G.floorY + G.floorT);
  const ly0 = G.floorY + G.floorT * 0.18, ly1 = G.floorY + G.floorT * 0.82;
  S.leafL = box(G.xc - G.leafL, ly0, G.xc, ly1, { leaf: -1, dynamic: true, thin: true });
  S.leafR = box(G.xc, ly0, G.xc + G.leafL, ly1, { leaf: 1, dynamic: true, thin: true });
  // sump (the left wall rises into the pier that carries the baffle). Both walls run out to the domain
  // edge so a splash over them falls back instead of collecting in a dead-end slot outside the sump.
  S.sumpL = box(0, G.pierTop, G.sX0, G.sFloor + t);
  S.sumpR = box(G.sX1, G.sTop, W, G.sFloor + t);
  S.sumpF = box(G.sX0 - t, G.sFloor, G.sX1 + t, G.sFloor + t + 0.05);
  // The weir is a thin plate. Declared rotated 90° so its thin dimension is the swept-collision axis: water
  // crowded into the foot of the plate can no longer be pushed out through the far face into the pump intake.
  S.weir = sim.addShape({ kind: 'box', cx: G.weirX + G.weirT / 2, cy: (G.weirCrest + G.sFloor) / 2, hw: (G.sFloor - G.weirCrest) / 2, hh: G.weirT / 2, angle: Math.PI / 2, thin: true });
  // baffle segments (rebuilt from the deflected shape every frame)
  const K = 10;
  S.beam = [];
  for (let k = 0; k < K; k++) S.beam.push(sim.addShape({ kind: 'box', cx: 0, cy: 0, hw: 0.01, hh: G.beamT / 2, angle: 0, beam: k, coat: 'philic', trackForce: true, dynamic: true, thin: true }));
  G.K = K;

  world = { cssW, cssH, W, H, scale, cell, r, sim, G, S, tier, phone,
    loads: new Float64Array(K), loadF: new Float64Array(K), defl: new Float64Array(K + 1),
    prevVX: null, prevVY: null, above: null,
    bubbles: [], flux: 0, fluxEMA: 0, pumpEMA: 0, pumpAcc: 0, hSim: G.h0, hModel: G.h0, cdEMA: 0,
    trace: [], traceT0: 0, sigma: 0, delta: 0, Ap: 0, topoff: null,
    // displacement-velocity grid at cell centres (honest motion: no per-step gravity/drift tug-of-war)
    fgU: new Float32Array(sim.nx * sim.ny), fgV: new Float32Array(sim.nx * sim.ny), fgW: new Float32Array(sim.nx * sim.ny),
    wallB: new Uint8Array(sim.nx * sim.ny), wallKey: '', gridTex: new Uint8Array(sim.nx * sim.ny * 4),
    streaks: G.needles.map(() => ({ pts: [], emitT: 0 })), ribbon: new Float32Array(3 * (STREAK_MAX * 2 + 2) * 4), ribbonN: 0,
    vc: { b: 0, y: 0, ok: false } };
  updateBeam(0);
  fillWater(state.motion && state.frames === 0);
  world.prevVX = new Float32Array(sim.maxP); world.prevVY = new Float32Array(sim.maxP);
  world.above = new Uint8Array(sim.maxP);
  for (let i = 0; i < sim.count; i++) world.above[i] = inTank(sim.px[i], sim.py[i]) ? 1 : 0;
  partData = new Float32Array(sim.maxP * 8);
  return world;
}

// Head tank + sump. With `opening`, the tank starts at 88 % and the header tops it off live (0.85 s),
// so the first seconds show a working rig instead of a still picture.
function fillWater(opening = false) {
  const { sim, G } = world;
  sim.count = 0;
  sim.fillRect(G.sX0, G.sFill, G.weirX, G.sFloor);     // the intake chamber starts dry: the pump waits for the weir
  const nSump = sim.count;
  sim.fillRect(G.tankX0, G.floorY - G.h0, G.tankX1, G.floorY);
  const nFull = sim.count - nSump;
  world.Ap = ((G.tankX1 - G.tankX0) * G.h0) / Math.max(1, nFull);
  world.topoff = null;
  if (opening) {
    sim.count = nSump;
    sim.fillRect(G.tankX0, G.floorY - G.h0 * 0.88, G.tankX1, G.floorY);
    const left = nFull - (sim.count - nSump);
    if (left > 0) world.topoff = { left, total: left, t: 0, dur: 0.85 };
  }
  sim.restDensity = 0;
  sim.u.fill(0); sim.v.fill(0);
  // let the lattice settle (gate shut, no pump) so the first frame shows still water. The last steps double as
  // the ultra-tier benchmark: a desktop that cannot hold ~6 ms per step drops to the 104-cell tier.
  let tBench = 0;
  for (let k = 0; k < 24; k++) { const t0 = performance.now(); sim.step(1 / 60); if (k >= 16) tBench += performance.now() - t0; }
  world.benchMs = tBench / 8;
  for (let i = 0; i < sim.count; i++) { sim.vx[i] *= 0.2; sim.vy[i] *= 0.2; }
  world.hSim = world.hModel = opening ? G.h0 * 0.88 : G.h0;
  world.trace = []; world.traceT0 = state.simTime; world.fluxEMA = 0; world.cdEMA = 0;
  // a refill is a fresh experiment: no residual bending, pump history or dye
  world.loads.fill(0); world.loadF.fill(0); world.defl.fill(0); world.sigma = 0; world.delta = 0;
  world.pumpEMA = 0; world.pumpAcc = 0;
  sim.dye.fill(0, 0, sim.maxP);
  for (const s of world.streaks) { s.pts.length = 0; s.emitT = 0; }
}

function inTank(x, y) { const G = world.G; return x > G.tankX0 && x < G.tankX1 && y < G.floorY + G.floorT * 0.5 && y > G.tankTop - 0.3; }

// cantilever: loads[k] at s_k from the root -> deflection (m) at the K+1 nodes, root stress
function updateBeam(dt) {
  const { G, S, sim } = world;
  const K = G.K, L = G.beamL, EI = E_AL * I_BOX;
  const tau = 0.22, a = dt > 0 ? 1 - Math.exp(-dt / tau) : 1;
  let M = 0;
  for (let k = 0; k < K; k++) {
    world.loadF[k] += (world.loads[k] - world.loadF[k]) * a;
    M += world.loadF[k] * (k + 0.5) / K * L;
  }
  world.sigma = M * C_BOX / I_BOX;
  for (let n = 0; n <= K; n++) {
    const x = n / K * L;
    let y = 0;
    for (let k = 0; k < K; k++) {
      const F = world.loadF[k], s = (k + 0.5) / K * L;
      y += x <= s ? F * x * x * (3 * s - x) / (6 * EI) : F * s * s * (3 * x - s) / (6 * EI);
    }
    world.defl[n] = y;
  }
  world.delta = world.defl[K];
  // place the K collision boxes along the (exaggerated) deflected centreline
  const ca = Math.cos(G.beamAng), sa = Math.sin(G.beamAng);
  for (let k = 0; k < K; k++) {
    const s0 = k / K * L, s1 = (k + 1) / K * L;
    const d0 = world.defl[k] * DEFL_SCALE, d1 = world.defl[k + 1] * DEFL_SCALE;
    const x0 = G.colX1 + s0 * ca - d0 * sa, y0 = G.rootY + s0 * sa + d0 * ca;
    const x1 = G.colX1 + s1 * ca - d1 * sa, y1 = G.rootY + s1 * sa + d1 * ca;
    const sh = S.beam[k];
    const ncx = (x0 + x1) / 2, ncy = (y0 + y1) / 2;
    sh.hw = Math.hypot(x1 - x0, y1 - y0) / 2 + (k === 0 ? 0 : G.beamT * 0.15);
    sh.angle = Math.atan2(y1 - y0, x1 - x0);
    sh.coat = state.coat;
    sim.moveShape(sh, ncx, ncy, dt);
    if (dt > 0) { sh.vx *= 0.3; sh.vy *= 0.3; }
  }
}

function beamPoint(s, side, G, extra = 0) { // world point on the deflected beam at arc length s, side -1 top / +1 bottom / 0 axis
  const K = G.K, L = G.beamL;
  const f = Math.min(Math.max(s / L * K, 0), K - 1e-6), k = Math.floor(f), tt = f - k;
  const d = (world.defl[k] * (1 - tt) + world.defl[k + 1] * tt) * DEFL_SCALE;
  const ca = Math.cos(G.beamAng), sa = Math.sin(G.beamAng);
  const off = side * (G.beamT / 2 + extra) + d;
  return [G.colX1 + s * ca - off * sa, G.rootY + s * sa + off * ca];
}

// ---------------------------------------------------------------- gate + radar
function setGateTarget(v, from) {
  state.gate.target = Math.min(Math.max(v, 0), 1);
  if (from !== 'input') gateIn.value = Math.round(state.gate.target * 100);
  if (scaleEl) scaleEl.style.setProperty('--fill', `${(gateIn.value / 100) * 100}%`);
  if (from !== 'radar' && state.radar.phase !== 'idle') stopRadar();
  if (state.gate.target > 0.02) gripEl.classList.add('used');
}
function stepGate(dt) {
  const g = state.gate, G = world.G;
  // trapezoidal profile on the leaf: accel 2.2 m/s^2, max 0.45 m/s (per leaf), in opening units.
  // Dead-beat arrival: the desired speed never exceeds what can stop exactly on the target this step,
  // so intermediate stops settle instead of limit-cycling.
  const half = G.aMax / 2, amax = 2.2 / half, vmax = 0.45 / half;
  const err = g.target - g.pos;
  const vDes = Math.sign(err) * Math.min(vmax, Math.sqrt(2 * amax * Math.abs(err)), Math.abs(err) / dt);
  g.vel += Math.max(-amax * dt, Math.min(amax * dt, vDes - g.vel));
  const prev = g.pos, vArr = Math.abs(g.vel);
  // dead-beat landing: a step that would reach or cross the target lands on it and stops (never past it)
  if (err !== 0 && g.vel * Math.sign(err) * dt >= Math.abs(err)) { g.pos = g.target; g.vel = 0; }
  else g.pos = Math.min(Math.max(g.pos + g.vel * dt, 0), 1);
  if ((g.pos === 0 || g.pos === 1) && prev !== g.pos) { audio.clunk(vArr * half); g.vel = 0; }
  const { S } = world, o = g.pos * half;
  world.sim.moveShape(S.leafL, G.xc - G.leafL / 2 - o, S.leafL.cy, dt);
  world.sim.moveShape(S.leafR, G.xc + G.leafL / 2 + o, S.leafR.cy, dt);
  audio.motor(Math.abs(g.vel) * half);
}
function startRadar() {
  if (!state.motion) { setGateTarget(state.gate.target > 0.5 ? 0 : 1); return; }   // paused scene: just toggle the gate
  state.radar = { phase: 'open', t: 0 };
  setGateTarget(1, 'radar');
  radarBtn.classList.add('running'); radarBtn.setAttribute('aria-pressed', 'true');
}
function stopRadar() { state.radar.phase = 'idle'; radarBtn.classList.remove('running'); radarBtn.setAttribute('aria-pressed', 'false'); }
function stepRadar(dt) {
  const r = state.radar;
  if (r.phase === 'idle') return;
  r.t += dt;
  if (r.phase === 'open' && state.gate.pos >= 0.999) { r.phase = 'hold'; r.t = 0; }
  else if (r.phase === 'hold' && r.t > 5.0) { r.phase = 'close'; r.t = 0; setGateTarget(0, 'radar'); }
  else if (r.phase === 'close' && state.gate.pos <= 0.001) stopRadar();
}

// ---------------------------------------------------------------- simulation step
function simulate(dt) {
  const { sim, G, S } = world;
  const t0 = performance.now();
  stepGate(dt);
  stepRadar(dt);
  // gravity: tilt + window inertia (clamped)
  let gx = 0, gy = G0;
  if (state.tilt.on) { gx = G0 * state.tilt.gx; gy = G0 * state.tilt.gy; }
  const sh = state.shake;
  gx += Math.max(-6, Math.min(6, sh.ax)); gy += Math.max(-6, Math.min(6, sh.ay));
  sim.gx = gx; sim.gy = gy;

  // pointer: pipette after a still 180 ms hold, otherwise stirring (velocity matching inside a soft radius)
  const p = state.pointer;
  const n = sim.count, px = sim.px, py = sim.py, vx = sim.vx, vy = sim.vy;
  if (p && p.active && !p.pipette && !p.moved && performance.now() - p.t0 > 180) { p.pipette = true; p.kick = false; }
  if (p && p.active && !p.pipette) {
    const R0 = p.touch ? 0.16 : 0.13, R2 = R0 * R0;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - p.x, dy = py[i] - p.y, d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      const f = 1 - d2 / R2;
      if (p.kick) { const d = Math.sqrt(d2) + 1e-4; vx[i] += dx / d * 2.4 * f; vy[i] += dy / d * 2.4 * f - 0.6 * f; }
      else { vx[i] += (p.vx - vx[i]) * 0.4 * f; vy[i] += (p.vy - vy[i]) * 0.4 * f; }
    }
    p.kick = false;
    p.vx *= 0.85; p.vy *= 0.85;      // a held, motionless pointer stops pushing
  }

  world.prevVX.set(vx.subarray(0, n)); world.prevVY.set(vy.subarray(0, n));
  world.loads.fill(0);
  const ca = Math.cos(G.beamAng), sa = Math.sin(G.beamAng);
  sim.cohesion = state.coat === 'phobic' ? 0.05 : 0;
  const sub = SUBSTEPS;
  for (let k = 0; k < G.K; k++) world.loads[k] = 0;
  for (let s = 0; s < sub; s++) {
    sim.step(dt / sub);
    // FLIP pressure on the beam cells, projected on the beam normal (+ = bends it down), N
    for (let k = 0; k < G.K; k++) {
      const shp = S.beam[k];
      world.loads[k] += (-shp.fx * sa + shp.fy * ca) * DEPTH / sub;
    }
  }
  updateBeam(dt);

  // pump: move particles from the intake chamber bottom up to the spout
  let moved = 0;
  if (state.pump) {
    const capLps = 18;                                     // pump capacity, L/s (illustrative)
    world.pumpAcc += capLps / 1000 / (world.Ap * DEPTH) * dt;
    const want = Math.floor(world.pumpAcc);
    const zx0 = G.weirX + G.weirT, zy0 = G.sFloor - Math.max(0.09, 3 * G.cell);
    for (let i = 0; i < sim.count && moved < want; i++) {
      if (px[i] > zx0 && py[i] > zy0) {
        // perforated distribution header across the tank: spread inflow evenly so it does not drive a
        // one-sided current across the orifice
        px[i] = G.hdrX0 + Math.random() * (G.hdrX1 - G.hdrX0); py[i] = G.hdrY + 0.015 + Math.random() * 0.02;
        vx[i] = (Math.random() - 0.5) * 0.06; vy[i] = 0.5;
        sim.foam[i] = 0.1; sim.dye[i] = 0; world.above[i] = 1;     // recirculated water returns clear
        moved++;
      }
    }
    world.pumpAcc -= want;
    if (world.pumpAcc > 3) world.pumpAcc = 3;
  }
  const qp = moved * world.Ap * DEPTH * 1000 / dt;
  world.pumpEMA += (qp - world.pumpEMA) * (1 - Math.exp(-dt / 0.6));

  // live opening: the header tops the tank off (front-loaded, like a valve cracked open then eased)
  const T = world.topoff;
  if (T) {
    T.t += dt;
    const u = Math.min(1, T.t / T.dur), f = 1 - (1 - u) ** 3;
    let k = Math.round(T.total * f) - (T.total - T.left);
    while (k-- > 0 && T.left > 0) {
      const i = sim.add(G.hdrX0 + Math.random() * (G.hdrX1 - G.hdrX0), G.hdrY + 0.015 + Math.random() * 0.02, (Math.random() - 0.5) * 0.06, 0.5);
      if (i < 0) { T.left = 0; break; }
      sim.foam[i] = 0.1; world.above[i] = 1; world.prevVX[i] = 0; world.prevVY[i] = 0.5;
      T.left--;
    }
    if (T.left <= 0) { world.topoff = null; world.hModel = world.hSim; world.trace = []; world.traceT0 = state.simTime; }
  }

  // flux through the orifice, tank level, foam, bubbles, dye decay
  let cross = 0, nTank = 0;
  const xo0 = G.xc - G.aMax, xo1 = G.xc + G.aMax, yOut = G.floorY + G.floorT;
  const dye = sim.dye, kTank = Math.exp(-dt / DYE_TAU.tank), kSump = Math.exp(-dt / DYE_TAU.sump), kWeir = Math.exp(-dt / DYE_TAU.weir);
  const xWeir = G.weirX + G.weirT;
  const wIn0 = G.weirX - 0.25 * world.r, wIn1 = xWeir + 0.25 * world.r, wTop = G.weirCrest + world.r;
  // vena contracta: narrowest jet width about half an opening below the lip (sharp-edged orifice)
  const aNow = state.gate.pos * G.aMax, yVC = yOut + 0.5 * aNow, bandVC = 0.6 * G.cell;
  let vcMin = 1e9, vcMax = -1e9, vcN = 0;
  for (let i = 0; i < sim.count; i++) {
    let x = px[i];
    const y = py[i];
    // water reaches the pump intake only over the crest: anything found inside the plate (crowded in through
    // the corner where the plate meets the floor) goes back to the sump side
    if (x > wIn0 && x < wIn1 && y > wTop && y < G.sFloor + 0.02) { x = px[i] = G.weirX - world.r * 1.05; if (vx[i] > 0) vx[i] = 0; }
    const a = inTank(x, y) ? 1 : 0;
    if (a) nTank++;
    if (world.above[i] && !a && x > xo0 && x < xo1 && y > G.floorY && y < yOut + 0.3) cross++;
    world.above[i] = a;
    if (aNow > 0.03 && y > yVC - bandVC && y < yVC + bandVC && x > G.xc - aNow && x < G.xc + aNow) { if (x < vcMin) vcMin = x; if (x > vcMax) vcMax = x; vcN++; }
    if (dye[i] > 0) { dye[i] *= y > G.sTop ? (x > xWeir ? kWeir : kSump) : kTank; if (dye[i] < 0.004) dye[i] = 0; }
    // whitewater: sudden velocity change inside the body = entrained air
    const dvx = vx[i] - world.prevVX[i], dvy = vy[i] - world.prevVY[i];
    const dv = Math.sqrt(dvx * dvx + dvy * dvy);
    const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
    let f = sim.foam[i] * Math.exp(-dt / 0.9);
    if (dv > 0.9 && sp > 0.6) {
      f = Math.max(f, Math.min(1, (dv - 0.9) * 0.55));
      if (sim.near[i] > 5 && world.bubbles.length < 180 && Math.random() < Math.min(0.12, (dv - 0.9) * 0.04)) spawnBubble(x, y);
    }
    sim.foam[i] = f;
  }
  const q = cross * world.Ap * DEPTH * 1000 / dt;        // L/s
  world.fluxEMA += (q - world.fluxEMA) * (1 - Math.exp(-dt / 0.45));
  world.hSim = nTank * world.Ap / (G.tankX1 - G.tankX0);
  // contraction coefficient Cc = b_vc / a (particle extent + one particle diameter), smoothed
  const vc = world.vc;
  if (vcN >= 3) { const b = Math.min(aNow, vcMax - vcMin + 2 * world.r); vc.b = vc.ok ? vc.b + (b - vc.b) * 0.15 : b; vc.y = yVC; vc.ok = true; }
  else vc.ok = false;

  buildFlowGrid(dt);
  stepStreaks(dt);
  stepPipette();

  // model: dh/dt = (Qin - Cd a W sqrt(2 g h)) / (A_tank)    (per metre of flume depth)
  const a = state.gate.pos * G.aMax;
  const At = (G.tankX1 - G.tankX0) * DEPTH;
  const qin = world.pumpEMA / 1000;
  const qout = CD * a * DEPTH * Math.sqrt(2 * G0 * Math.max(world.hModel, 0));
  world.hModel = Math.max(0, world.hModel + (qin - qout) / At * dt);
  world.qModel = CD * a * DEPTH * Math.sqrt(2 * G0 * Math.max(world.hSim, 0)) * 1000;
  if (a > 0.02 && world.hSim > 0.03) {
    const cd = q / 1000 / (a * DEPTH * Math.sqrt(2 * G0 * world.hSim));   // same-instant flux and opening
    world.cdEMA = world.cdEMA > 0 ? world.cdEMA + (cd - world.cdEMA) * (1 - Math.exp(-dt / 0.5)) : cd;
  } else world.cdEMA = 0;

  stepBubbles(dt);
  state.simTime += dt;
  const tt = state.simTime - world.traceT0;
  if (!world.trace.length || tt - world.trace[world.trace.length - 1][0] > 0.1) {
    world.trace.push([tt, world.hSim, world.hModel]);
    if (tt > 90) { world.trace = []; world.traceT0 = state.simTime; world.hModel = world.hSim; }
  }
  audio.update(world.fluxEMA, moved > 0);
  state.perf.sim = state.perf.sim * 0.9 + (performance.now() - t0) * 0.1;
}

function spawnBubble(x, y) {
  const r = 0.0015 + Math.random() * 0.0035;
  world.bubbles.push({ x, y, r, life: 0, max: 2 + Math.random() * 3 });
  audio.plink(r);
}
function stepBubbles(dt) {
  const B = world.bubbles, sim = world.sim, v = world.tmp2 || (world.tmp2 = [0, 0]);
  for (let i = B.length - 1; i >= 0; i--) {
    const b = B[i];
    sim.sampleVel(b.x, b.y, v);
    b.x += (v[0] * 0.8) * dt + (Math.random() - 0.5) * 0.01;
    b.y += (v[1] * 0.8 - 0.28) * dt;
    b.life += dt;
    if (b.life > b.max || sim.cellTypeAt(b.x, b.y) === AIR) B.splice(i, 1);
  }
}

// ---------------------------------------------------------------- flow field, wall field, grid upload
// Cell-centre velocity from each particle's actual displacement over the step. At rest the FLIP grid
// carries gravity and the drift-compensation spring cancelling each other (about -0.15 m/s per step);
// the displacement is about 0, so streaklines and flow-advected foam don't drift on still water.
function buildFlowGrid(dt) {
  const sim = world.sim, nx = sim.nx, ny = sim.ny, inv = sim.invH;
  const U = world.fgU, V = world.fgV, Wt = world.fgW;
  U.fill(0); V.fill(0); Wt.fill(0);
  const px = sim.px, py = sim.py, ox = sim.ox, oy = sim.oy, n = sim.count, idt = 1 / dt;
  for (let i = 0; i < n; i++) {
    const gx = px[i] * inv - 0.5, gy = py[i] * inv - 0.5;
    const i0 = Math.floor(gx), j0 = Math.floor(gy);
    if (i0 < 0 || j0 < 0 || i0 >= nx - 1 || j0 >= ny - 1) continue;
    const vx = (px[i] - ox[i]) * idt, vy = (py[i] - oy[i]) * idt;
    const fx = gx - i0, fy = gy - j0, c = i0 * ny + j0;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    U[c] += w00 * vx; V[c] += w00 * vy; Wt[c] += w00;
    U[c + ny] += w10 * vx; V[c + ny] += w10 * vy; Wt[c + ny] += w10;
    U[c + 1] += w01 * vx; V[c + 1] += w01 * vy; Wt[c + 1] += w01;
    U[c + ny + 1] += w11 * vx; V[c + ny + 1] += w11 * vy; Wt[c + ny + 1] += w11;
  }
  for (let c = 0; c < U.length; c++) { const w = Wt[c]; if (w > 1e-4) { U[c] /= w; V[c] /= w; } }
}
function flowAt(x, y, out) {   // bilinear m/s; out[2] = local particle weight (0 = dry)
  const sim = world.sim, nx = sim.nx, ny = sim.ny, inv = sim.invH;
  const gx = x * inv - 0.5, gy = y * inv - 0.5;
  const i0 = Math.max(0, Math.min(nx - 2, Math.floor(gx))), j0 = Math.max(0, Math.min(ny - 2, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - i0)), fy = Math.min(1, Math.max(0, gy - j0));
  const c = i0 * ny + j0, U = world.fgU, V = world.fgV, Wt = world.fgW;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  out[0] = U[c] * w00 + U[c + ny] * w10 + U[c + 1] * w01 + U[c + ny + 1] * w11;
  out[1] = V[c] * w00 + V[c + ny] * w10 + V[c + 1] * w01 + V[c + ny + 1] * w11;
  out[2] = Wt[c] * w00 + Wt[c + ny] * w10 + Wt[c + 1] * w01 + Wt[c + ny + 1] * w11;
  return out;
}
// Signed wall distance at cell centres (cells), packed 0.5 = face. Recomputed only when solids move.
function updateWallField() {
  const sim = world.sim, nx = sim.nx, ny = sim.ny, h = sim.h, B = world.wallB;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const d = sim.sdf((i + 0.5) * h, (j + 0.5) * h, 2.5 * h) / h;
    B[i * ny + j] = ((Math.max(-1, Math.min(1, d / 2)) * 0.5 + 0.5) * 255 + 0.5) | 0;
  }
}
function uploadGrid() {
  if (!renderer || !renderer.setGrid) return;
  const { sim, scale, G } = world, nx = sim.nx, ny = sim.ny, h = sim.h;
  const key = state.gate.pos.toFixed(4) + '|' + Math.round(world.delta * DEFL_SCALE / h * 4);
  if (key !== world.wallKey) { world.wallKey = key; updateWallField(); }
  const U = world.fgU, V = world.fgV, B = world.wallB, T = world.gridTex, VM = 6, inv2h = 1 / (2 * h), WMAX = 40;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = i * ny + j, o = (j * nx + i) * 4;
      T[o] = ((Math.max(-1, Math.min(1, U[c] / VM)) * 0.5 + 0.5) * 255 + 0.5) | 0;
      T[o + 1] = ((Math.max(-1, Math.min(1, V[c] / VM)) * 0.5 + 0.5) * 255 + 0.5) | 0;
      T[o + 2] = B[c];
      let w = 0;
      if (i > 0 && i < nx - 1 && j > 0 && j < ny - 1) w = Math.abs((V[c + ny] - V[c - ny]) * inv2h - (U[c + 1] - U[c - 1]) * inv2h);
      T[o + 3] = Math.min(255, (w / WMAX * 255) | 0);
    }
  }
  renderer.setGrid(T, nx, ny, [0, 0, nx * h * scale, ny * h * scale], VM * scale);
}

// ---------------------------------------------------------------- Reynolds dye: needles, streaklines, pipette
// particles within R of (x, y) take dye: mode 'max' (streak hand-off) or 'add' (pipette)
function depositDye(x, y, R, amount, add) {
  const sim = world.sim, inv = sim.pInv, pnx = sim.pnx, pny = sim.pny, R2 = R * R, dye = sim.dye;
  const xi = Math.floor(x * inv), yi = Math.floor(y * inv), rr = Math.ceil(R * inv);
  const a0 = Math.max(0, xi - rr), a1 = Math.min(pnx - 1, xi + rr), y0 = Math.max(0, yi - rr), y1 = Math.min(pny - 1, yi + rr);
  if (a0 > a1 || y0 > y1) return;
  for (let a = a0; a <= a1; a++) {
    const base = a * pny;
    for (let k = sim.pFirst[base + y0], l = sim.pFirst[base + y1 + 1]; k < l; k++) {
      const id = sim.pIds[k], dx = sim.px[id] - x, dy = sim.py[id] - y, d2 = dx * dx + dy * dy;
      if (d2 >= R2) continue;
      if (add) dye[id] = Math.min(1, dye[id] + amount * (1 - d2 / R2));
      else if (dye[id] < amount) dye[id] = amount;
    }
  }
}
function needleWake() { return state.dye ? (state.motion ? Math.min(1, Math.max(0, (state.intro.t - 0.25) / 0.35)) : 1) : 0; }
function stepStreaks(dt) {
  const { G, scale } = world;
  const v = world.tmp3 || (world.tmp3 = [0, 0, 0]);
  const wake = needleWake();
  // below the vena contracta the ink stops being a laminar filament and is handed to the particles
  const yHand = G.floorY + G.floorT + Math.max(0.08, 0.55 * G.aMax);
  for (let k = 0; k < world.streaks.length; k++) {
    const s = world.streaks[k], P = s.pts, nz = G.needles[k];
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.fade !== undefined) { p.fade += dt; if (p.fade > 0.12) P.splice(i, 1); continue; }
      const inj = 0.035 * Math.exp(-p.age / 0.6);                 // the needle's own discharge, decaying
      flowAt(p.x, p.y, v);
      const mx = p.x + v[0] * dt * 0.5, my = p.y + (v[1] + inj) * dt * 0.5;
      flowAt(mx, my, v);                                           // RK2 midpoint
      p.x += v[0] * dt; p.y += (v[1] + inj) * dt;
      p.sp = Math.hypot(v[0], v[1]);
      if (p.y > yHand || v[2] < 0.2) { depositDye(p.x, p.y, 1.0 * G.cell, 0.55, false); p.fade = 0; }
    }
    if (wake <= 0 || !state.dye) continue;
    // emit: evenly spaced in slow water, every step in fast water
    s.emitT += dt;
    const last = P[P.length - 1];
    const gap = last ? Math.hypot(last.x - nz[0], last.y - nz[1]) * scale : 1e9;
    if (gap > 1.6 || s.emitT > 1 / 30) { P.push({ x: nz[0], y: nz[1] + 0.003, age: 0, sp: 0 }); s.emitT = 0; }
    while (P.length > STREAK_MAX) {                               // the oldest end dissolves into the water
      const o = P.shift();
      if (o.fade === undefined) depositDye(o.x, o.y, 0.9 * G.cell, 0.35, false);
    }
  }
}
function stepPipette() {
  const p = state.pointer;
  if (!p || !p.active || !p.pipette) return;
  depositDye(p.x, p.y, Math.max(0.035, 1.6 * world.G.cell), 0.22, true);
}
// Triangle strip for the three filaments: [x, y, across, alpha], CSS px, degenerate-stitched.
function buildRibbons() {
  const out = world.ribbon, sc = world.scale, wake = needleWake();
  let n = 0, prev = null;
  if (wake > 0) {
    for (const s of world.streaks) {
      const P = s.pts, m = P.length;
      if (m < 2) continue;
      let firstV = true;
      for (let q = m - 1; q >= 0; q--) {                          // nozzle (newest) -> tail (oldest)
        const p = P[q], pa = P[Math.min(m - 1, q + 1)], pb = P[Math.max(0, q - 1)];
        let tx = pb.x - pa.x, ty = pb.y - pa.y; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
        const width = 2.4 * Math.min(1, Math.max(0.58, 1 / Math.sqrt(1 + (p.sp || 0) * sc / 220)));
        const half = width / 2 + 0.8;
        const al = wake * Math.min(1, q / 10) * (p.fade !== undefined ? Math.max(0, 1 - p.fade / 0.12) : 1);
        const X = p.x * sc, Y = p.y * sc, nX = -ty * half, nY = tx * half;
        if (firstV && prev) {                                     // stitch: repeat previous end + this start, invisible
          out[n++] = prev[0]; out[n++] = prev[1]; out[n++] = -1; out[n++] = 0;
          out[n++] = X + nX; out[n++] = Y + nY; out[n++] = 1; out[n++] = 0;
        }
        firstV = false;
        out[n++] = X + nX; out[n++] = Y + nY; out[n++] = 1; out[n++] = al;
        out[n++] = X - nX; out[n++] = Y - nY; out[n++] = -1; out[n++] = al;
        prev = [X - nX, Y - nY];
      }
    }
  }
  world.ribbonN = n / 4;
}
// reduced motion: still plumes hanging from the needles (no animation)
function staticPlumes() {
  const { G } = world;
  for (let k = 0; k < world.streaks.length; k++) {
    const P = world.streaks[k].pts; P.length = 0;
    const [x0, y0] = G.needles[k];
    for (let i = 24; i >= 0; i--) P.push({ x: x0 + 0.004 * Math.sin(i * 0.5 + k), y: y0 + 0.003 + i * 0.0035, age: 1, sp: 0 });
  }
}

// ---------------------------------------------------------------- the drawing (sheet texture, behind the water)
function drawSheet(dpr) {
  const { cssW, cssH, scale, G, W, H } = world;
  const c = sheetCanvas || (sheetCanvas = document.createElement('canvas'));
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#fbf8f3'; x.fillRect(0, 0, cssW, cssH);
  // paper grain
  const grain = x.createImageData(Math.min(256, c.width), Math.min(256, c.height));
  for (let i = 0; i < grain.data.length; i += 4) { const v = 236 + Math.random() * 20; grain.data[i] = v; grain.data[i + 1] = v - 3; grain.data[i + 2] = v - 10; grain.data[i + 3] = 10; }
  const gc = document.createElement('canvas'); gc.width = grain.width; gc.height = grain.height; gc.getContext('2d').putImageData(grain, 0, 0);
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = x.createPattern(gc, 'repeat'); x.fillRect(0, 0, c.width, c.height); x.restore();
  const P = (v) => v * scale;
  // grid: 50 mm minor, 250 mm major (world units)
  x.lineWidth = 1;
  for (let gx = 0; gx <= W + 1e-6; gx += 0.05) {
    const major = Math.abs(gx / 0.25 - Math.round(gx / 0.25)) < 1e-6;
    x.strokeStyle = major ? 'rgba(120, 140, 160, 0.30)' : 'rgba(120, 140, 160, 0.13)';
    x.beginPath(); x.moveTo(Math.round(P(gx)) + 0.5, 0); x.lineTo(Math.round(P(gx)) + 0.5, cssH); x.stroke();
  }
  for (let gy = 0; gy <= H + 1e-6; gy += 0.05) {
    const major = Math.abs(gy / 0.25 - Math.round(gy / 0.25)) < 1e-6;
    x.strokeStyle = major ? 'rgba(120, 140, 160, 0.30)' : 'rgba(120, 140, 160, 0.13)';
    x.beginPath(); x.moveTo(0, Math.round(P(gy)) + 0.5); x.lineTo(cssW, Math.round(P(gy)) + 0.5); x.stroke();
  }
  // governing equations written on the paper behind the water (they get lensed)
  x.fillStyle = 'rgba(20, 23, 26, 0.16)';
  const fs = Math.max(13, Math.min(30, cssW / 34));
  x.font = `600 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
  x.textAlign = 'center';
  x.fillText('Q = Cd · a · W · √(2gh)', P(G.xc), P(G.floorY - G.h0 * 0.42));
  x.font = `600 ${fs * 0.8}px "JetBrains Mono", ui-monospace, monospace`;
  x.fillText('h(t) = (√h₀ − (Cd·a·W / 2A)·√(2g)·t)²', P((G.sX0 + G.weirX) / 2), P(G.sFloor - (G.sFloor - G.sFill) * 0.45));
  // datum lines (dash-dot) at the gate and the weir crest
  x.setLineDash([14, 4, 2, 4]);
  x.strokeStyle = 'rgba(11, 125, 153, 0.45)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(P(G.sX0), P(G.weirCrest) + 0.5); x.lineTo(P(G.weirX + G.weirT + 0.12), P(G.weirCrest) + 0.5); x.stroke();
  x.setLineDash([]);
  // drawing border + zones
  const m = 10;
  x.strokeStyle = INK; x.lineWidth = 1.5; x.strokeRect(m + 0.5, m + 0.5, cssW - 2 * m - 1, cssH - 2 * m - 1);
  x.lineWidth = 0.75; x.strokeRect(m + 4.5, m + 4.5, cssW - 2 * m - 9, cssH - 2 * m - 9);
  x.font = '600 9px "JetBrains Mono", monospace'; x.fillStyle = MUTED; x.textAlign = 'center'; x.textBaseline = 'middle';
  const zc = Math.max(3, Math.round(cssW / 180)), zr = Math.max(3, Math.round(cssH / 180));
  for (let i = 0; i < zc; i++) { const zx = m + (cssW - 2 * m) * (i + 0.5) / zc; x.fillText(String(i + 1), zx, m + 2.5); x.fillText(String(i + 1), zx, cssH - m - 2); }
  for (let j = 0; j < zr; j++) { const zy = m + (cssH - 2 * m) * (j + 0.5) / zr; x.fillText('ABCDEFGH'[j], m + 2.5, zy); x.fillText('ABCDEFGH'[j], cssW - m - 2.5, zy); }
  x.textBaseline = 'alphabetic';
  return c;
}

// ---------------------------------------------------------------- the ink layer (cut solids + live annotations, in front)
function hatch(x, path, spacing = 7, ang = Math.PI / 4, color = 'rgba(20,23,26,0.55)') {
  x.save(); x.clip(path);
  const b = 4000; x.strokeStyle = color; x.lineWidth = 1;
  x.beginPath();
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let d = -b; d < b; d += spacing) { x.moveTo(-b * ca - d * sa, -b * sa + d * ca); x.lineTo(b * ca - d * sa, b * sa + d * ca); }
  x.stroke(); x.restore();
}
function rectPath(x0, y0, x1, y1) { const p = new Path2D(); p.rect(x0, y0, x1 - x0, y1 - y0); return p; }

function drawStaticInk(dpr) {
  const { cssW, cssH, scale, G } = world;
  const c = staticInk;
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, cssW, cssH);
  const P = (v) => v * scale, t = G.t;
  // drawn solids are padded by about one particle radius so the rendered water meets them flush
  const pad = world.padPx = Math.round(world.r * scale + 2);
  const R = (x0, y0, x1, y1) => rectPath(P(x0) - pad, P(y0) - pad, P(x1) + pad, P(y1) + pad);
  const solid = (path, fill = '#f1ece2', hatchSp = 6, ang) => { x.fillStyle = fill; x.fill(path); hatch(x, path, hatchSp, ang); x.strokeStyle = INK; x.lineWidth = 1.4; x.stroke(path); };
  // tank walls (glass with steel frame): draw as cut glass
  for (const [x0, x1] of [[G.tankX0 - t, G.tankX0], [G.tankX1, G.tankX1 + t]]) {
    const p = R(x0, G.tankTop - 0.02, x1, G.floorY + G.floorT);
    x.fillStyle = 'rgba(196, 232, 242, 0.95)'; x.fill(p);
    x.strokeStyle = INK; x.lineWidth = 1.4; x.stroke(p);
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1; x.beginPath(); x.moveTo(P(x0) - pad + 3, P(G.tankTop)); x.lineTo(P(x0) - pad + 3, P(G.floorY) - pad - 4); x.stroke();
  }
  // floor slab either side of the opening
  solid(R(G.tankX0 - t, G.floorY, G.xc - G.aMax / 2, G.floorY + G.floorT), '#efe9dd', 7, Math.PI / 4);
  solid(R(G.xc + G.aMax / 2, G.floorY, G.tankX1 + t, G.floorY + G.floorT), '#efe9dd', 7, Math.PI / 4);
  // soil retained behind the pier (civil-drawing earth hatch) and the pier itself (concrete)
  {
    const sx0 = 14, sy0 = P(G.pierTop), sx1 = P(G.sX0 - t) - pad, sy1 = P(G.sFloor + t + 0.05);
    if (sx1 > sx0 + 4) {
      const soil = rectPath(sx0, sy0, sx1, sy1);
      x.fillStyle = '#f1ebdf'; x.fill(soil);
      x.save(); x.clip(soil); x.strokeStyle = 'rgba(120, 98, 70, 0.35)'; x.lineWidth = 1;
      for (let yy = sy0 + 8; yy < sy1; yy += 11) for (let xx = sx0 + ((yy / 11) % 2) * 7; xx < sx1; xx += 14) { x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx + 5, yy - 5); x.stroke(); }
      x.restore();
      x.strokeStyle = INK; x.lineWidth = 1.6; x.beginPath(); x.moveTo(sx0, sy0); x.lineTo(sx1, sy0); x.stroke();
      x.lineWidth = 1; for (let xx = sx0 + 4; xx < sx1 - 2; xx += 9) { x.beginPath(); x.moveTo(xx, sy0); x.lineTo(xx - 5, sy0 + 6); x.stroke(); }
    }
  }
  // sump: pier (under the tank wall), right wall, floor: concrete hatch
  const sw = [R(G.sX0 - t, G.pierTop, G.sX0, G.sFloor + t), R(G.sX1, G.sTop, G.sX1 + t, G.sFloor + t), R(G.sX0 - t, G.sFloor, G.sX1 + t, G.sFloor + t + 0.05)];
  for (const p of sw) { x.fillStyle = '#ece6da'; x.fill(p); hatch(x, p, 9, -Math.PI / 4, 'rgba(20,23,26,0.4)'); x.strokeStyle = INK; x.lineWidth = 1.4; x.stroke(p); }
  // weir plate (steel)
  solid(R(G.weirX, G.weirCrest, G.weirX + G.weirT, G.sFloor), '#dfe5ea', 4, Math.PI / 4);
  // riser pipe (double line) from the intake up the margin into a perforated distribution header across the tank
  const pr = Math.max(4, P(0.022));
  const path = [[P(G.weirX + G.weirT + 0.06), P(G.sFloor - 0.05)], [P(G.pipeX), P(G.sFloor - 0.05)], [P(G.pipeX), P(G.hdrY)], [P(G.hdrX0), P(G.hdrY)]];
  world.pipe = path;
  x.lineJoin = 'round'; x.lineCap = 'butt';
  x.strokeStyle = INK; x.lineWidth = pr * 2 + 2.6; strokePoly(x, path);
  x.strokeStyle = '#f7f9fa'; x.lineWidth = pr * 2; strokePoly(x, path);
  x.strokeStyle = INK; x.lineWidth = 1.3;
  x.beginPath(); x.moveTo(P(G.hdrX0), P(G.hdrY) - pr - 1.3); x.lineTo(P(G.hdrX0), P(G.hdrY) + pr + 1.3); x.stroke();   // end cap
  x.lineWidth = 1;
  for (let xx = P(G.hdrX0) + 9; xx < P(G.hdrX1); xx += 15) { x.beginPath(); x.moveTo(xx, P(G.hdrY) + pr + 1); x.lineTo(xx, P(G.hdrY) + pr + 5); x.stroke(); }   // nozzles
  // pump symbol P-101 at the corner
  const [pxp, pyp] = [path[1][0], path[1][1]];
  x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 1.4;
  x.beginPath(); x.arc(pxp, pyp, pr * 2.2, 0, Math.PI * 2); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(pxp - pr * 1.1, pyp + pr * 1.4); x.lineTo(pxp, pyp - pr * 1.9); x.lineTo(pxp + pr * 1.1, pyp + pr * 1.4); x.stroke();
  world.pumpXY = [pxp, pyp, pr * 2.2];
  // radar sensor hung under the header on the gate centreline (like a door operator's sensor)
  x.strokeStyle = INK; x.lineWidth = 1.2; x.fillStyle = '#e6eaee';
  const hy = P(G.hdrY) + pr + 1;
  const hp = rectPath(P(G.xc) - 15, hy, P(G.xc) + 15, hy + 8);
  x.fill(hp); x.stroke(hp);
  world.radarXY = [P(G.xc), hy + 8];
  // labels, with a paper halo so they stay legible over water
  x.font = '600 10px "JetBrains Mono", monospace';
  const lab = (txt, X, Y, align = 'left', col = MUTED) => {
    x.textAlign = align; x.lineJoin = 'round';
    x.strokeStyle = 'rgba(251, 248, 243, 0.92)'; x.lineWidth = 3.5; x.strokeText(txt, X, Y);
    x.fillStyle = col; x.fillText(txt, X, Y);
  };
  const lx = P(G.tankX0 - t) - pad - 8, ly = Math.max(P(G.tankTop) + 12, G.phone ? 0 : 66);
  if (lx > 120) lab('HEAD TANK TK-101', lx, ly, 'right');
  else { lab('HEAD TANK', lx, ly, 'right'); lab('TK-101', lx, ly + 13, 'right'); }
  lab('SUMP TK-102', P(G.sX0) + pad + 8, P(G.sTop) + 14);
  lab(G.phone ? 'WEIR' : 'WEIR · CREST LEVELLED', P(G.weirX) - pad - 6, P(G.sTop) + 14, 'right');
  x.strokeStyle = MUTED; x.lineWidth = 0.8; x.beginPath(); x.moveTo(P(G.weirX) - pad - 4, P(G.sTop) + 18); x.lineTo(P(G.weirX), P(G.weirCrest) - pad - 2); x.stroke();
  lab('P-101', Math.min(pxp, cssW - 16 - x.measureText('P-101').width / 2), pyp - pr * 2.2 - 6, 'center', INK);
  // Reynolds dye injectors: a small manifold under the header, three hypodermic needles into the tank
  {
    const my = P(G.tankTop) + 12, xs = G.needles.map((nd) => P(nd[0]));
    x.strokeStyle = INK; x.lineWidth = 1.1; x.fillStyle = '#e9edf0';
    const mp = rectPath(Math.min(...xs) - 7, my - 3, Math.max(...xs) + 7, my + 3);
    x.fill(mp); x.stroke(mp);
    for (const [ndx, ndy] of G.needles) {
      const X = P(ndx), Y = P(ndy);
      x.strokeStyle = '#3f4852'; x.lineWidth = 1; x.beginPath(); x.moveTo(X, my + 3); x.lineTo(X, Y - 2.5); x.stroke();
      x.fillStyle = '#3f4852'; x.beginPath(); x.moveTo(X - 0.9, Y - 2.6); x.lineTo(X + 0.9, Y - 2.6); x.lineTo(X + 0.9, Y); x.closePath(); x.fill();   // bevelled tip
      x.fillStyle = '#1b4379'; x.beginPath(); x.arc(X, Y + 1, 1, 0, Math.PI * 2); x.fill();                                                          // ink bead
    }
    lab(G.phone ? 'DYE' : 'DYE · REYNOLDS 1883', Math.max(...xs) + 12, my + 3.5);
  }
  { // callout along the member, under it (the dry side)
    const s = G.beamL * (G.phone ? 0.12 : 0.18), ca = Math.cos(G.beamAng), sa = Math.sin(G.beamAng), off = G.beamT / 2 + (pad + 12) / scale;
    const X = P(G.colX1 + s * ca - off * sa), Y = P(G.rootY + s * sa + off * ca);
    x.save(); x.translate(X, Y); x.rotate(G.beamAng); lab(G.phone ? 'BAFFLE · 6061-T6' : 'BAFFLE · 6061-T6 BOX 120×40×3 · CANTILEVER', 0, 0); x.restore();
  }
  if (!G.phone) {
    x.font = '800 13px "Plus Jakarta Sans", sans-serif'; lab('SECTION A–A', 24, 34, 'left', INK);
    x.font = '600 9.5px "JetBrains Mono", monospace'; lab('NTS · 2-D FLIP · ILLUSTRATIVE', 24, 48, 'left', FAINT);
  }
  return c;
}
function strokePoly(x, pts) { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.stroke(); }

function stressColor(f) { // 0 neutral aluminium -> steel blue -> orange
  f = Math.min(Math.max(f, 0), 1);
  const a = [223, 229, 234], b = [43, 125, 163], c = [255, 84, 30];
  const m = f < 0.5 ? f / 0.5 : (f - 0.5) / 0.5, p = f < 0.5 ? a : b, q = f < 0.5 ? b : c;
  return `rgb(${Math.round(p[0] + (q[0] - p[0]) * m)},${Math.round(p[1] + (q[1] - p[1]) * m)},${Math.round(p[2] + (q[2] - p[2]) * m)})`;
}

function drawInk(time) {
  const { cssW, cssH, scale, G, S } = world;
  const x = ink;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
  const d = inkCanvas.width / cssW;
  x.setTransform(d, 0, 0, d, 0, 0);
  const P = (v) => v * scale, pad = world.padPx || 0;
  // gate leaves (steel, hatched) with the hidden part in the pocket dashed
  for (const L of [S.leafL, S.leafR]) {
    const x0 = P(L.cx - L.hw), x1 = P(L.cx + L.hw), y0 = P(L.cy - L.hh), y1 = P(L.cy + L.hh);
    const vis0 = Math.max(x0 - pad, P(G.xc - G.aMax / 2)), vis1 = Math.min(x1 + pad, P(G.xc + G.aMax / 2));
    if (vis1 > vis0) {
      const p = rectPath(vis0, y0 - pad, vis1, y1 + pad);
      x.fillStyle = '#d9e1e8'; x.fill(p); hatch(x, p, 4, -Math.PI / 4, 'rgba(20,23,26,0.6)');
      x.strokeStyle = INK; x.lineWidth = 1.4; x.stroke(p);
    }
    x.setLineDash([4, 3]); x.strokeStyle = 'rgba(20,23,26,0.55)'; x.lineWidth = 1;
    x.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1); x.setLineDash([]);
  }
  // baffle: deflected box with live bending-stress gradient (root = max)
  {
    const N = 24, top = [], bot = [], ex = pad / scale;
    for (let i = 0; i <= N; i++) { const s = -ex + i / N * (G.beamL + 2 * ex); const a = beamPoint(s, -1, G, ex), b = beamPoint(s, 1, G, ex); top.push([P(a[0]), P(a[1])]); bot.push([P(b[0]), P(b[1])]); }
    const sMax = 40e6;                               // colour scale: 40 MPa = full orange
    const grad = x.createLinearGradient(top[0][0], top[0][1], top[N][0], top[N][1]);
    // M(x) for distributed loads, sampled at 6 stations
    for (let k = 0; k <= 6; k++) {
      const xs = k / 6 * G.beamL; let M = 0;
      for (let j = 0; j < G.K; j++) { const s = (j + 0.5) / G.K * G.beamL; if (s > xs) M += world.loadF[j] * (s - xs); }
      grad.addColorStop(k / 6, stressColor(Math.abs(M) * C_BOX / I_BOX / sMax));
    }
    const p = new Path2D();
    p.moveTo(top[0][0], top[0][1]); for (let i = 1; i <= N; i++) p.lineTo(top[i][0], top[i][1]);
    for (let i = N; i >= 0; i--) p.lineTo(bot[i][0], bot[i][1]); p.closePath();
    x.fillStyle = grad; x.fill(p);
    x.strokeStyle = INK; x.lineWidth = 1.4; x.stroke(p);
    // hollow-section inner line (box wall)
    x.strokeStyle = 'rgba(20,23,26,0.45)'; x.lineWidth = 0.8; x.setLineDash([5, 3]);
    x.beginPath(); for (let i = 0; i <= N; i++) { const m = [(top[i][0] * 0.62 + bot[i][0] * 0.38), (top[i][1] * 0.62 + bot[i][1] * 0.38)]; i ? x.lineTo(m[0], m[1]) : x.moveTo(m[0], m[1]); } x.stroke(); x.setLineDash([]);
    // undeflected outline (phantom line)
    x.strokeStyle = 'rgba(94,104,118,0.55)'; x.lineWidth = 0.8; x.setLineDash([12, 3, 3, 3]);
    const ca = Math.cos(G.beamAng), sa = Math.sin(G.beamAng);
    x.beginPath(); x.moveTo(P(G.colX1), P(G.rootY)); x.lineTo(P(G.colX1 + G.beamL * ca), P(G.rootY + G.beamL * sa)); x.stroke(); x.setLineDash([]);
    if (world.delta * DEFL_SCALE * scale > 2) {
      const tip = bot[N];
      x.fillStyle = ORANGE_TXT; x.font = '700 10px "JetBrains Mono", monospace'; x.textAlign = 'left';
      x.fillText(`δ ${(world.delta * 1000).toFixed(1)} mm (×${DEFL_SCALE})`, tip[0] + 8, tip[1] + 12);
    }
  }
  // theory overlay: falling-sheet envelope b(y) = q / sqrt(v0² + 2 g y), from the vena contracta
  const a = state.gate.pos * G.aMax, hNow = Math.max(world.hSim, 0);
  if (a > 0.01 && hNow > 0.01 && !CLEAN) {
    const v0 = Math.sqrt(2 * G0 * hNow), b0 = 0.62 * a, q = b0 * v0;
    const yTop = G.floorY + G.floorT, yEnd = Math.min(beamPoint((G.xc - G.colX1) / Math.cos(G.beamAng), -1, G)[1] - 0.02, G.sTop);
    x.strokeStyle = ORANGE; x.lineWidth = 1.2; x.setLineDash([6, 4]);
    for (const sgn of [-1, 1]) {
      x.beginPath();
      for (let yy = yTop; yy <= yEnd; yy += 0.02) { const b = q / Math.sqrt(v0 * v0 + 2 * G0 * (yy - yTop)); const X = P(G.xc + sgn * b / 2), Y = P(yy); yy === yTop ? x.moveTo(X, Y) : x.lineTo(X, Y); }
      x.stroke();
    }
    x.setLineDash([]);
    if (state.focus !== 'orifice' && state.focus !== 'flow') {   // instrument callouts take this spot when active
      x.fillStyle = ORANGE_TXT; x.font = '700 10px "JetBrains Mono", monospace'; x.textAlign = 'left';
      x.fillText(G.phone ? 'b(y) theory' : 'b(y) = q / √(v₀² + 2gy)', P(G.xc + b0 / 2) + 10, P(yTop + 0.12));
    }
  }
  // level symbol + head dimension in the tank
  const ySurf = G.floorY - hNow;
  if (hNow > 0.005) {
    const X = P(G.tankX0) + 26, Y = P(ySurf);
    x.fillStyle = CYAN_INK; x.beginPath(); x.moveTo(X - 6, Y - 9); x.lineTo(X + 6, Y - 9); x.lineTo(X, Y - 1); x.closePath(); x.fill();
    x.strokeStyle = CYAN_INK; x.lineWidth = 1; x.beginPath(); x.moveTo(X - 10, Y + 3); x.lineTo(X + 10, Y + 3); x.moveTo(X - 6, Y + 6); x.lineTo(X + 6, Y + 6); x.stroke();
    // dimension line h
    const dx = P(G.tankX1) - 18;
    dimV(x, dx, P(ySurf), P(G.floorY), `h ${hNow.toFixed(3)} m`);
  }
  // gate opening dimension
  if (a > 0.004) dimH(x, P(G.xc - a / 2), P(G.xc + a / 2), P(G.floorY + G.floorT) + 16, `a ${Math.round(a * 1000)} mm`);
  // radar sensor (cyan arc, pulses while the radar cycle runs)
  {
    const [rx, ry] = world.radarXY;
    x.strokeStyle = CYAN; x.lineWidth = 2;
    x.beginPath(); x.arc(rx, ry, 7, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
    if (state.radar.phase !== 'idle' && state.motion) {
      const ph = (time * 1.6) % 1;
      x.strokeStyle = `rgba(0, 210, 255, ${0.6 * (1 - ph)})`;
      x.beginPath(); x.arc(rx, ry, 7 + ph * 26, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();
    }
    if (state.intro.ping >= 0) {                     // the opening ping: the sensor wakes up once
      const u = Math.min(1, state.intro.ping / 0.45), e = 1 - (1 - u) ** 3;
      x.strokeStyle = `rgba(34, 184, 207, ${0.75 * (1 - u)})`; x.lineWidth = 1.6;
      x.beginPath(); x.arc(rx, ry, 7 + e * 30, 0.18 * Math.PI, 0.82 * Math.PI); x.stroke();
    }
  }
  // pump running indicator: chevrons travelling along the riser
  if (state.pump && world.pipe) {
    const flow = Math.min(1, world.pumpEMA / 20);
    if (flow > 0.02) {
      x.strokeStyle = `rgba(11,125,153,${0.35 + 0.5 * flow})`; x.lineWidth = 1.6; x.setLineDash([3, 9]);
      x.lineDashOffset = -((time * 60 * (0.4 + flow)) % 12);
      strokePoly(x, world.pipe); x.setLineDash([]); x.lineDashOffset = 0;
    }
    const [pxp, pyp, rr] = world.pumpXY;
    x.save(); x.translate(pxp, pyp); x.rotate(state.motion ? time * 7 * flow : 0);
    x.strokeStyle = INK; x.lineWidth = 1; x.beginPath(); for (let i = 0; i < 3; i++) { const an = i * 2.094; x.moveTo(0, 0); x.lineTo(Math.cos(an) * rr * 0.6, Math.sin(an) * rr * 0.6); } x.stroke(); x.restore();
  }
  // bubbles (inside the water)
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1;
  for (const b of world.bubbles) {
    const X = P(b.x), Y = P(b.y), rr = Math.max(1.2, b.r * scale * 0.9);
    x.beginPath(); x.arc(X, Y, rr, 0, Math.PI * 2); x.stroke();
  }
  // instrument bubbles (ISA tags) — also hit targets for the linked instruments
  const tLT = [P(G.tankX1 + G.t) + 20, P(G.floorY - G.h0 * 0.55)], tZT = [P(G.xc - G.aMax / 2) - 34, P(G.floorY + G.floorT) + 30];
  isa(x, tLT[0], tLT[1], 'LT', '101', P(G.tankX1 + G.t));
  isa(x, tZT[0], tZT[1], 'ZT', '101');
  world.tags = [{ k: 'head', X: tLT[0], Y: tLT[1] }, { k: 'orifice', X: tZT[0], Y: tZT[1] }];
  if (world.pipe) {
    const tFT = [world.pipe[2][0] - 26, P((G.sTop + G.tankTop) / 2)];
    isa(x, tFT[0], tFT[1], 'FT', '102', world.pipe[2][0]);
    world.tags.push({ k: 'flow', X: tFT[0], Y: tFT[1] });
  }
  for (const tg of world.tags) if (tg.k === state.focus) {   // lit tag: a drafting halo
    x.strokeStyle = 'rgba(27, 67, 121, 0.85)'; x.lineWidth = 1.4; x.setLineDash([3, 3]);
    x.beginPath(); x.arc(tg.X, tg.Y, 19, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
  }
  drawInstrument(x, P);
  // pipette: dashed ring that blooms while ink is injected
  const pp = state.pointer;
  if (pp && pp.active && pp.pipette) {
    const u = Math.min(1, ((performance.now() - pp.t0 - 180) % 700) / 350), e = 1 - Math.pow(1 - Math.min(1, u), 3);
    x.strokeStyle = '#1b4379'; x.lineWidth = 1.5; x.setLineDash([3, 3]);
    x.beginPath(); x.arc(P(pp.x), P(pp.y), 7 + 4 * e, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
  }
}

// ---------------------------------------------------------------- linked instruments (readouts <-> drawing)
const VERM = '#f04e23', INST = '#1b4379';
function drawInstrument(x, P) {
  const f = state.focus;
  if (!f || !world) return;
  const { G } = world, h = Math.max(world.hSim, 0), a = state.gate.pos * G.aMax;
  x.save();
  x.font = '700 10px "JetBrains Mono", monospace';
  // drafting callout: paper plate + hairline border, so labels stay crisp over moving water
  const lab = (txt, X, Y, align = 'left', col = INST) => {
    const w = x.measureText(txt).width, X0 = align === 'right' ? X - w : align === 'center' ? X - w / 2 : X;
    x.fillStyle = 'rgba(251, 248, 243, 0.94)'; x.strokeStyle = col === INST ? 'rgba(27, 67, 121, 0.35)' : 'rgba(194, 65, 12, 0.35)'; x.lineWidth = 0.8;
    x.beginPath(); x.roundRect ? x.roundRect(X0 - 4, Y - 10, w + 8, 14, 3) : x.rect(X0 - 4, Y - 10, w + 8, 14); x.fill(); x.stroke();
    x.textAlign = 'left'; x.fillStyle = col; x.fillText(txt, X0, Y);
  };
  if (f === 'head' && h > 0.005) {
    // hydrostatic pressure on the tank wall: p = ρgh, zero at the surface, linear with depth
    const X1 = P(G.tankX1) - world.padPx - 2, Ys = P(G.floorY - h), Yb = P(G.floorY) - world.padPx, w = G.phone ? 30 : 48;
    const tri = new Path2D(); tri.moveTo(X1, Ys); tri.lineTo(X1, Yb); tri.lineTo(X1 - w, Yb); tri.closePath();
    x.fillStyle = 'rgba(27, 67, 121, 0.10)'; x.fill(tri);
    x.strokeStyle = INST; x.fillStyle = INST; x.lineWidth = 1;
    for (let k = 1; k <= 4; k++) {
      const Y = Ys + (Yb - Ys) * k / 4.3, L = w * (Y - Ys) / (Yb - Ys);
      x.beginPath(); x.moveTo(X1 - L, Y); x.lineTo(X1 - 2, Y); x.stroke(); arrowHead(x, X1 - 1, Y, 0);
    }
    x.lineWidth = 1.2; x.stroke(tri);
    lab(`p = ρgh = ${(RHO * G0 * h / 1000).toFixed(2)} kPa`, X1 - w - 6, Yb - 4, 'right');
  } else if (f === 'orifice') {
    const vc = world.vc;
    if (a > 0.03 && vc.ok) {
      // caliper across the jet at the vena contracta: Cc = a_c / a, measured from the particles
      const Y = P(vc.y), x0 = P(G.xc - vc.b / 2), x1 = P(G.xc + vc.b / 2);
      x.strokeStyle = INST; x.fillStyle = INST; x.lineWidth = 1;
      x.beginPath(); x.moveTo(x0, Y - 9); x.lineTo(x0, Y + 9); x.moveTo(x1, Y - 9); x.lineTo(x1, Y + 9); x.moveTo(x0 + 2, Y); x.lineTo(x1 - 2, Y); x.stroke();
      arrowHead(x, x0, Y, Math.PI); arrowHead(x, x1, Y, 0);
      lab(`a_c = ${(vc.b / a).toFixed(2)} a`, x1 + 10, Y - 2, 'left');
      lab(G.phone ? 'vena contracta' : 'vena contracta: Cd ≈ Cc · Cv', x1 + 10, Y + 11, 'left', MUTED);
    } else lab(G.phone ? 'open the gate' : 'Open the gate to measure the vena contracta', P(G.xc), P(G.floorY + G.floorT) + 58, 'center');
  } else if (f === 'flow') {
    if (a > 0.004 && h > 0.005) {
      const v = Math.sqrt(2 * G0 * h), b = world.vc.ok ? world.vc.b : CD * a;
      const Y = P(world.vc.ok ? world.vc.y : G.floorY + G.floorT + 0.5 * a), L = Math.min(72, v * (G.phone ? 10 : 15));
      x.strokeStyle = INST; x.fillStyle = INST; x.lineWidth = 1.5;
      for (const fr of [-0.3, 0, 0.3]) { const X = P(G.xc + fr * b); x.beginPath(); x.moveTo(X, Y); x.lineTo(X, Y + L - 2); x.stroke(); arrowHead(x, X, Y + L, Math.PI / 2); }
      const lx = P(G.xc + b / 2) + 12;
      lab(`v = √(2gh) = ${v.toFixed(2)} m/s`, lx, Y + L * 0.45, 'left');
      const Dh = 2 * a * DEPTH / (a + DEPTH), re = RHO * v * Dh / MU;
      reBar(x, lx, Y + L * 0.45 + 12, G.phone ? 110 : 150, re, lab);
    } else lab(G.phone ? 'open the gate' : 'Open the gate: no flow yet', P(G.xc), P(G.floorY + G.floorT) + 58, 'center');
  } else if (f === 'baffle') {
    // bending-moment diagram on the tension (loaded) side, ordinates to scale, root = max
    const N = 24, Ms = [];
    let Mmax = 0;
    for (let i = 0; i <= N; i++) {
      const xs = i / N * G.beamL; let M = 0;
      for (let j = 0; j < G.K; j++) { const s = (j + 0.5) / G.K * G.beamL; if (s > xs) M += world.loadF[j] * (s - xs); }
      Ms.push(Math.abs(M)); Mmax = Math.max(Mmax, Math.abs(M));
    }
    const sc = Mmax > 0.5 ? (G.phone ? 38 : 58) / Mmax : 0, ca = Math.cos(G.beamAng), sa = Math.sin(G.beamAng);
    const pts = [];
    for (let i = 0; i <= N; i++) { const [bx, by] = beamPoint(i / N * G.beamL, -1, G, world.padPx / world.scale); const X = P(bx), Y = P(by); pts.push([X, Y, X + sa * Ms[i] * sc, Y - ca * Ms[i] * sc]); }
    const poly = new Path2D(); poly.moveTo(pts[0][0], pts[0][1]); for (const q of pts) poly.lineTo(q[2], q[3]); poly.lineTo(pts[N][0], pts[N][1]); poly.closePath();
    x.fillStyle = 'rgba(240, 78, 35, 0.12)'; x.fill(poly);
    x.strokeStyle = VERM; x.lineWidth = 0.8;
    for (let i = 0; i <= N; i += 3) { x.beginPath(); x.moveTo(pts[i][0], pts[i][1]); x.lineTo(pts[i][2], pts[i][3]); x.stroke(); }
    x.lineWidth = 1.3; x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(q[2], q[3]) : x.moveTo(q[2], q[3]))); x.stroke();
    if (Mmax > 0.5) {
      // lettered along the diagram's hypotenuse, just outside it (as on a drawing)
      const A = pts[0], B = pts[N], ang = Math.atan2(B[3] - A[3], B[2] - A[2]);
      const mx = A[2] + (B[2] - A[2]) * 0.42 + Math.sin(ang) * 9, my = A[3] + (B[3] - A[3]) * 0.42 - Math.cos(ang) * 9;
      x.save(); x.translate(mx, my); x.rotate(ang);
      lab(G.phone ? `M ${Mmax.toFixed(0)} N·m` : `M(x) · root ${Mmax.toFixed(0)} N·m · σ = Mc/I = ${(Math.abs(world.sigma) / 1e6).toFixed(1)} MPa`, 0, 0, 'center', ORANGE_TXT);
      x.restore();
    } else lab('No load yet: open the gate', pts[N >> 1][0] + 10, pts[N >> 1][1] - 10, 'left', ORANGE_TXT);
  }
  x.restore();
}
// Reynolds number on a log bar: laminar < 2,300 < transitional < 4,000 < turbulent
function reBar(x, X0, Y0, W, re, lab) {
  const lg = (v) => X0 + (Math.log10(v) - 2) / 4 * W;      // 10² .. 10⁶
  const H = 6;
  x.fillStyle = 'rgba(27, 67, 121, 0.10)'; x.fillRect(X0, Y0, lg(2300) - X0, H);
  x.fillStyle = 'rgba(27, 67, 121, 0.22)'; x.fillRect(lg(2300), Y0, lg(4000) - lg(2300), H);
  x.fillStyle = 'rgba(27, 67, 121, 0.38)'; x.fillRect(lg(4000), Y0, X0 + W - lg(4000), H);
  x.strokeStyle = INST; x.lineWidth = 0.8; x.strokeRect(X0, Y0, W, H);
  x.font = '600 8.5px "JetBrains Mono", monospace'; x.fillStyle = MUTED; x.textAlign = 'center';
  for (let e = 2; e <= 6; e++) { const X = X0 + (e - 2) / 4 * W; x.beginPath(); x.moveTo(X, Y0 + H); x.lineTo(X, Y0 + H + 3); x.stroke(); x.fillText(`10${SUP[e]}`, X, Y0 + H + 12); }
  const M = Math.min(X0 + W, Math.max(X0, lg(Math.max(re, 100))));
  x.fillStyle = VERM; x.beginPath(); x.moveTo(M, Y0 - 1); x.lineTo(M - 4, Y0 - 7); x.lineTo(M + 4, Y0 - 7); x.closePath(); x.fill();
  x.font = '700 10px "JetBrains Mono", monospace';
  lab(`Re ${sci(re)} · ${re < 2300 ? 'laminar' : re < 4000 ? 'transitional' : 'turbulent'}`, X0, Y0 + H + 26, 'left');
}
function tagAt(e) {
  if (!world || !world.tags) return null;
  const r = stageEl.getBoundingClientRect(), X = e.clientX - r.left, Y = e.clientY - r.top;
  for (const tg of world.tags) if (Math.hypot(X - tg.X, Y - tg.Y) < 18) return tg.k;
  // the baffle itself: distance to the member's centreline
  const { G, scale } = world, ax = G.colX1 * scale, ay = G.rootY * scale;
  const bx = (G.colX1 + G.beamL * Math.cos(G.beamAng)) * scale, by = (G.rootY + G.beamL * Math.sin(G.beamAng)) * scale;
  const t = Math.max(0, Math.min(1, ((X - ax) * (bx - ax) + (Y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  if (Math.hypot(X - (ax + t * (bx - ax)), Y - (ay + t * (by - ay))) < G.beamT * scale / 2 + 8) return 'baffle';
  return null;
}
function setFocus(k) {
  state.focus = k;
  document.querySelectorAll('[data-inst]').forEach((el) => el.classList.toggle('lit', el.dataset.inst === k));
}
function hoverTags(e) {
  const k = tagAt(e);
  stageEl.style.cursor = k ? 'pointer' : '';
  if (!state.focusLock && e.pointerType === 'mouse') setFocus(k);
}
function clickTags(e) {
  const k = tagAt(e);
  if (k && !(state.focus === k && state.focusLock)) { state.focusLock = true; setFocus(k); }
  else if (state.focusLock) { state.focusLock = false; setFocus(null); }
}

function isa(x, X, Y, a, b, leaderTo) {
  const r = 13;
  if (leaderTo !== undefined) { x.strokeStyle = MUTED; x.lineWidth = 0.8; x.beginPath(); x.moveTo(X + (leaderTo > X ? r : -r), Y); x.lineTo(leaderTo, Y); x.stroke(); }
  x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 1.1;
  x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(X - r, Y); x.lineTo(X + r, Y); x.stroke();
  x.fillStyle = INK; x.textAlign = 'center'; x.font = '700 8.5px "JetBrains Mono", monospace';
  x.fillText(a, X, Y - 3); x.fillText(b, X, Y + 9);
}
function arrowHead(x, X, Y, ang) { x.beginPath(); x.moveTo(X, Y); x.lineTo(X - 6 * Math.cos(ang - 0.35), Y - 6 * Math.sin(ang - 0.35)); x.lineTo(X - 6 * Math.cos(ang + 0.35), Y - 6 * Math.sin(ang + 0.35)); x.closePath(); x.fill(); }
function dimV(x, X, y0, y1, label) {
  x.strokeStyle = INK; x.fillStyle = INK; x.lineWidth = 0.9;
  x.beginPath(); x.moveTo(X, y0); x.lineTo(X, y1); x.stroke();
  arrowHead(x, X, y0, -Math.PI / 2); arrowHead(x, X, y1, Math.PI / 2);
  x.save(); x.translate(X - 6, (y0 + y1) / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.font = '700 10px "JetBrains Mono", monospace';
  const w = x.measureText(label).width + 8; x.fillStyle = 'rgba(251,248,243,0.9)'; x.fillRect(-w / 2, -10, w, 13); x.fillStyle = INK; x.fillText(label, 0, 0); x.restore();
}
function dimH(x, x0, x1, Y, label) {
  x.strokeStyle = INK; x.fillStyle = INK; x.lineWidth = 0.9;
  x.beginPath(); x.moveTo(x0, Y); x.lineTo(x1, Y); x.moveTo(x0, Y - 5); x.lineTo(x0, Y + 5); x.moveTo(x1, Y - 5); x.lineTo(x1, Y + 5); x.stroke();
  x.textAlign = 'left'; x.font = '700 10px "JetBrains Mono", monospace';
  x.fillText(label, x1 + 8, Y + 3.5);
}

// ---------------------------------------------------------------- readouts + chart
let lastReadout = 0;
function updateReadouts(now) {
  if (now - lastReadout < 120) return;
  lastReadout = now;
  const G = world.G, a = state.gate.pos * G.aMax, h = Math.max(world.hSim, 0);
  gateOut.textContent = `${Math.round(a * 1000)} mm`;
  R.h.textContent = h.toFixed(3);
  R.qm.textContent = (world.qModel || 0).toFixed(1);
  R.qs.textContent = Math.max(0, world.fluxEMA).toFixed(1);
  R.cd.textContent = a > 0.02 && h > 0.03 && world.cdEMA > 0 ? world.cdEMA.toFixed(2) : '–';
  if (a > 0.004 && h > 0.005) {
    const v = Math.sqrt(2 * G0 * h), Dh = 2 * a * DEPTH / (a + DEPTH), re = RHO * v * Dh / MU;
    R.re.textContent = sci(re);
  } else R.re.textContent = '–';
  const sig = Math.abs(world.sigma) / 1e6;
  R.sig.textContent = sig.toFixed(1);
  R.del.textContent = (Math.abs(world.delta) * 1000).toFixed(2);
  R.sf.textContent = sig > 0.05 ? Math.min(999, SY_AL / 1e6 / sig).toFixed(0) : '–';
  R.qp.textContent = Math.max(0, world.pumpEMA).toFixed(1);
  drawChart();
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function sci(v) {   // 34 512 → "3.5 × 10⁴"
  const e = Math.floor(Math.log10(v)), m = v / 10 ** e;
  return `${m.toFixed(1)} × 10${String(e).split('').map((c) => SUP[+c]).join('')}`;
}
let chartKey = '';
function drawChart() {
  const svg = $('#chart'), tr = world.trace;
  const W = 360, H = 150, l = 30, r = 8, t = 14, b = 20;
  const tMax = Math.max(20, tr.length ? tr[tr.length - 1][0] : 0);
  const hMax = Math.max(world.G.h0 * 1.15, 0.05);
  const X = (v) => l + (v / tMax) * (W - l - r), Y = (v) => H - b - (v / hMax) * (H - t - b);
  const step = tMax > 60 ? 20 : tMax > 30 ? 10 : 5;
  const key = `${tMax.toFixed(1)}|${hMax.toFixed(3)}`;
  if (key !== chartKey) {   // the grid only changes when the axes rescale
    chartKey = key;
    let g = '';
    for (let s = 0; s <= tMax + 1e-6; s += step) g += `<line x1="${X(s)}" y1="${t}" x2="${X(s)}" y2="${H - b}"/><text x="${X(s)}" y="${H - 6}" text-anchor="middle">${s}</text>`;
    for (let v = 0; v <= hMax + 1e-6; v += 0.1) g += `<line x1="${l}" y1="${Y(v)}" x2="${W - r}" y2="${Y(v)}"/><text x="${l - 4}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`;
    $('#chart-grid').innerHTML = g;
  }
  let ds = '', dm = '';
  for (let i = 0; i < tr.length; i++) { ds += (i ? 'L' : 'M') + X(tr[i][0]).toFixed(1) + ' ' + Y(tr[i][1]).toFixed(1); dm += (i ? 'L' : 'M') + X(tr[i][0]).toFixed(1) + ' ' + Y(tr[i][2]).toFixed(1); }
  $('#chart-sim').setAttribute('d', ds); $('#chart-model').setAttribute('d', dm);
}

// ---------------------------------------------------------------- render
function packParticles() {
  const { sim, scale } = world;
  const n = sim.count, d = partData, dye = sim.dye, seed = sim.seed;
  for (let i = 0, j = 0; i < n; i++, j += 8) {
    d[j] = sim.px[i] * scale; d[j + 1] = sim.py[i] * scale;
    d[j + 2] = sim.vx[i] * scale; d[j + 3] = sim.vy[i] * scale;
    d[j + 4] = sim.foam[i];
    const nb = sim.near[i]; d[j + 5] = nb >= 4 ? 0 : (4 - nb) / 4;
    d[j + 6] = dye[i]; d[j + 7] = seed[i];
  }
  return n;
}
function render(time) {
  const t0 = performance.now();
  if (renderer) {
    const n = packParticles();
    if (!state.motion && state.dye && world.streaks[0].pts.length === 0) staticPlumes();
    buildRibbons();
    uploadGrid();
    renderer.draw(partData, n, time, world.ribbon, world.ribbonN);
  } else if (fallback2d) drawFallback();
  drawInk(time);
  placeGrip();
  state.perf.draw = state.perf.draw * 0.9 + (performance.now() - t0) * 0.1;
}
function drawFallback() {
  const x = fallback2d, { sim, scale, cssW, cssH } = world;
  const d = glCanvas.width / cssW;
  x.setTransform(d, 0, 0, d, 0, 0);
  x.drawImage(sheetCanvas, 0, 0, cssW, cssH);
  x.fillStyle = 'rgba(29, 107, 130, 0.55)';
  const r = Math.max(2, world.r * scale * 1.6);
  x.beginPath();
  for (let i = 0; i < sim.count; i++) { const X = sim.px[i] * scale, Y = sim.py[i] * scale; x.moveTo(X + r, Y); x.arc(X, Y, r, 0, Math.PI * 2); }
  x.fill();
}

function placeGrip() {
  const { G, scale } = world;
  const a = state.gate.pos * G.aMax;
  const X = (G.xc - a / 2) * scale - 34 * Math.min(1, a / 0.03);   // slide the grip off the leaf edge smoothly
  const Y = (G.floorY + G.floorT * 0.5) * scale;
  gripEl.style.transform = `translate(${X}px, ${Y}px) translate(-50%, -50%)`;
}

// ---------------------------------------------------------------- loop
function frame(now) {
  requestAnimationFrame(frame);
  if (!world) return;
  const dt = Math.min(Math.max((now - state.lastT) / 1000, 0), 1 / 30);
  state.lastT = now;
  if (state.visible === false && state.frames > 2) return;     // off-screen: no solver, no draw
  state.perf.frame = state.perf.frame * 0.95 + dt * 1000 * 0.05;
  pollShake(dt);
  if (state.motion && dt > 0) {
    // fixed 1/60 s solver step. Fast devices catch up with up to two steps per frame; slow ones take one
    // and run in gentle slow motion instead of spiralling into longer frames.
    const maxSteps = state.perf.sim > 7 ? 1 : 2;
    state.acc = Math.min((state.acc || 0) + dt, maxSteps / 60);
    let steps = 0;
    while (state.acc >= 1 / 60 - 1e-4 && steps < maxSteps) { simulate(1 / 60); state.acc -= 1 / 60; steps++; }
  }
  else if (!state.motion) { stepGateStatic(); }
  if (state.motion && dt > 0) {
    // live opening timeline: needles wake at 0.25 s, the radar sensor pings at 0.95 s, then the grip nudges once
    const I = state.intro, t1 = I.t + dt;
    if (I.t < 0.95 && t1 >= 0.95) I.ping = 0;
    if (!I.nudged && t1 >= 1.15) { I.nudged = true; if (!store.get('water-grip-used')) { gripEl.classList.remove('nudge'); void gripEl.offsetWidth; gripEl.classList.add('nudge'); } }
    I.t = t1;
    if (I.ping >= 0) { I.ping += dt; if (I.ping > 0.45) I.ping = -1; }
  }
  render(now / 1000);
  updateReadouts(now);
  adaptQuality();
  state.frames++;
  if (state.frames === 2) stageEl.classList.add('live');
}
function stepGateStatic() { // reduced motion: leaves jump to the target, water waits
  const g = state.gate; g.pos = g.target; g.vel = 0;
  placeLeaves(g.pos);
}
function placeLeaves(pos) {
  const G = world.G, half = G.aMax / 2, o = pos * half;
  const L = world.S.leafL, Rr = world.S.leafR;
  L.cx = G.xc - G.leafL / 2 - o; Rr.cx = G.xc + G.leafL / 2 + o; L.vx = Rr.vx = 0;
  world.sim._bounds(L); world.sim._bounds(Rr);
}

// Step quality down if the device cannot keep up: GPU resolution when drawing is slow, solver work when
// the solver is slow. At most two steps, each after ~2.5 s of evidence.
function adaptQuality() {
  const q = state.quality || (state.quality = { level: 0, since: 0 });
  q.since++;
  if (q.since < 150 || q.level >= 2 || !state.motion) return;
  if (state.perf.frame > 24 || state.perf.sim > 9) {
    q.level++; q.since = 0;
    if (state.perf.sim > 9 || !renderer) {
      world.sim.iters = Math.max(18, Math.round(world.sim.iters * 0.7)); world.sim.separateIters = 1;
    } else {
      const f = q.level === 1 ? 0.75 : 0.55;   // each GPU step really lowers the resolution
      const dpr = Math.max(1, Math.min(devicePixelRatio || 1, world.phone ? 1.75 : 2) * f);
      renderer.resize(world.cssW, world.cssH, dpr);
    }
    if (DEBUG) console.info('water: quality step', q.level, JSON.stringify(state.perf));
  }
}

function pollShake(dt) {
  const s = state.shake;
  if (dt <= 0) return;
  const nx = window.screenX, ny = window.screenY;
  // a jump of more than 120 px in one frame is a teleport (monitor change, emulation), not a shake
  if (Math.abs(nx - s.x) > 120 || Math.abs(ny - s.y) > 120 || performance.now() < 800) {
    s.x = nx; s.y = ny; s.vx = 0; s.vy = 0; s.ax *= 0.5; s.ay *= 0.5; return;
  }
  const vx = (nx - s.x) / dt, vy = (ny - s.y) / dt;
  let ax = (vx - s.vx) / dt, ay = (vy - s.vy) / dt;
  s.x = nx; s.y = ny; s.vx = vx; s.vy = vy;
  if (!world) return;
  // window accelerates right -> water is pushed left (inertial frame); px -> m via the stage scale
  ax = -ax / world.scale; ay = -ay / world.scale;
  const k = 1 - Math.exp(-dt / 0.05);
  s.ax += (Math.max(-6, Math.min(6, ax)) - s.ax) * k;
  s.ay += (Math.max(-6, Math.min(6, ay)) - s.ay) * k;
}

// ---------------------------------------------------------------- audio (opt-in, Minnaert bubbles)
const audio = (() => {
  let ctx = null, master = null, noiseGain = null, motorGain = null, motorOsc = null, plinks = 0, plinkWindow = 0;
  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; ch[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
    src.connect(bp); bp.connect(noiseGain); noiseGain.connect(master); src.start();
    motorOsc = ctx.createOscillator(); motorOsc.type = 'sawtooth'; motorOsc.frequency.value = 70;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    motorGain = ctx.createGain(); motorGain.gain.value = 0;
    motorOsc.connect(lp); lp.connect(motorGain); motorGain.connect(master); motorOsc.start();
  }
  return {
    set(on) { if (on) init(); this.sync(); },
    // sound plays only while it is on AND the water is actually moving on screen
    sync() {
      if (!ctx) return;
      const live = state.sound && state.motion && state.visible !== false && !document.hidden;
      if (live && ctx.state === 'suspended') ctx.resume();
      else if (!live && ctx.state === 'running') ctx.suspend();
    },
    update(q, pumping) {
      if (!ctx || !state.sound) return;
      const t = ctx.currentTime;
      noiseGain.gain.setTargetAtTime(Math.min(0.5, Math.sqrt(Math.max(q, 0)) * 0.06), t, 0.15);
    },
    motor(v) { if (!ctx || !state.sound) return; motorGain.gain.setTargetAtTime(Math.min(0.12, v * 0.5), ctx.currentTime, 0.04); motorOsc.frequency.setTargetAtTime(55 + v * 180, ctx.currentTime, 0.05); },
    clunk(v) {
      if (!ctx || !state.sound) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      g.gain.setValueAtTime(Math.min(0.35, 0.1 + v), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
    },
    plink(R) { // Minnaert: f ≈ 3.26 m·Hz / R, with the slight upward chirp of a rising bubble
      if (!ctx || !state.sound) return;
      const t = ctx.currentTime;
      if (t - plinkWindow > 0.1) { plinkWindow = t; plinks = 0; }
      if (++plinks > 2) return;
      const f0 = 3.26 / R, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.18, t + 0.06);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07 + R * 8);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12 + R * 8);
    },
  };
})();

// ---------------------------------------------------------------- input
function stageToWorld(e) { const r = stageEl.getBoundingClientRect(); return [(e.clientX - r.left) / world.scale, (e.clientY - r.top) / world.scale]; }
gripEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  if (gripEl.classList.contains('dragging')) return;   // one finger drives the gate; a second is ignored
  gripEl.setPointerCapture(e.pointerId); gripEl.classList.add('dragging');
  gripEl.classList.remove('nudge');
  const [wx] = stageToWorld(e);
  const G = world.G, id = e.pointerId;
  const start = { x: wx, open: state.gate.target };
  const move = (ev) => {
    if (ev.pointerId !== id) return;
    const [mx] = stageToWorld(ev);
    const dOpen = (start.x - mx) * 2 / G.aMax;   // dragging the left edge outward (left) opens
    setGateTarget(start.open + dOpen, 'grip');
  };
  const up = (ev) => {
    if (ev.pointerId !== id) return;
    gripEl.classList.remove('dragging'); gripEl.removeEventListener('pointermove', move); gripEl.removeEventListener('pointerup', up); gripEl.removeEventListener('pointercancel', up);
  };
  gripEl.addEventListener('pointermove', move); gripEl.addEventListener('pointerup', up); gripEl.addEventListener('pointercancel', up);
});
stageEl.addEventListener('pointerdown', (e) => {
  if (!world || e.target === gripEl || gripEl.contains(e.target) || (e.target.closest && e.target.closest('button'))) return;
  const [x, y] = stageToWorld(e);
  const touch = e.pointerType !== 'mouse';
  const now = performance.now();
  // a press that holds still for 180 ms becomes the ink pipette; a drag stirs; a tap on a phone pokes
  state.pointer = { x, y, vx: 0, vy: 0, active: true, touch, kick: touch, t: now, t0: now, sx: e.clientX, sy: e.clientY, moved: false, pipette: false };
  if (!touch) stageEl.setPointerCapture(e.pointerId);
});
stageEl.addEventListener('pointermove', (e) => {
  const p = state.pointer;
  if (!world) return;
  if (!p || !p.active) { hoverTags(e); return; }
  const [x, y] = stageToWorld(e);
  const now = performance.now(), dt = Math.max((now - p.t) / 1000, 1 / 240);
  p.vx = Math.max(-6, Math.min(6, (x - p.x) / dt)); p.vy = Math.max(-6, Math.min(6, (y - p.y) / dt));
  p.x = x; p.y = y; p.t = now;
  if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.moved = true;
});
const endPointer = (e) => {
  const p = state.pointer;
  if (p && p.active && !p.moved && !p.pipette && e && e.type === 'pointerup') clickTags(e);
  if (p) p.active = false;
};
stageEl.addEventListener('pointerup', endPointer); stageEl.addEventListener('pointercancel', endPointer); stageEl.addEventListener('pointerleave', endPointer);

gateIn.addEventListener('input', () => setGateTarget(gateIn.value / 100, 'input'));
radarBtn.addEventListener('click', () => { if (state.radar.phase === 'idle') startRadar(); else { stopRadar(); setGateTarget(0); } });
pumpBtn.addEventListener('click', () => { state.pump = !state.pump; toggleUI(pumpBtn, state.pump); });
refillBtn.addEventListener('click', () => { setGateTarget(0); stopRadar(); state.gate.pos = 0; state.gate.vel = 0; placeLeaves(0); fillWater(state.motion); world.bubbles = []; });
document.querySelectorAll('input[name=coat]').forEach((r) => r.addEventListener('change', () => { state.coat = r.value; }));
soundBtn.addEventListener('click', () => { state.sound = !state.sound; toggleUI(soundBtn, state.sound); audio.set(state.sound); });
dyeBtn.addEventListener('click', () => {
  state.dye = !state.dye; toggleUI(dyeBtn, state.dye); store.set('water-dye', state.dye ? 'on' : 'off');
  if (!state.dye && world) for (const s of world.streaks) s.pts.length = 0;
});
motionBtn.addEventListener('click', () => { state.motion = !state.motion; syncMotionBtn(); store.set('water-motion', state.motion ? 'on' : 'off'); updateHint(); audio.sync(); });
document.addEventListener('visibilitychange', () => audio.sync());
function toggleUI(btn, on) { btn.setAttribute('aria-pressed', String(on)); const s = btn.querySelector('[data-state]'); if (s) s.textContent = on ? 'on' : 'off'; }
function syncMotionBtn() { toggleUI(motionBtn, state.motion); const l = motionBtn.querySelector('[data-label]'); if (l) l.textContent = state.motion ? 'Pause' : 'Play'; }
function updateHint() { hintEl.textContent = state.motion ? '' : 'Paused: the water waits. Press Play to run it.'; }
// readout rows light their instrument in the drawing (hover / keyboard focus / tap to pin)
document.querySelectorAll('[data-inst]').forEach((row) => {
  const k = row.dataset.inst;
  row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !state.focusLock) setFocus(k); });
  row.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !state.focusLock) setFocus(null); });
  row.addEventListener('focus', () => { if (!state.focusLock) setFocus(k); });
  row.addEventListener('blur', () => { if (!state.focusLock) setFocus(null); });
  row.addEventListener('click', () => { if (state.focusLock && state.focus === k) { state.focusLock = false; setFocus(null); } else { state.focusLock = true; setFocus(k); } });
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
});
function updateTicks() {
  if (!ticksEl || !world) return;
  // engineering scale: round major steps (25 mm on a 135 mm phone gate, 50 mm on the 200 mm desktop gate)
  const mm = Math.round(world.G.aMax * 1000);
  const step = [10, 20, 25, 50, 100].find((s) => mm / s <= 6) || 100;
  let html = '';
  for (let v = 0; v <= mm + 0.5; v += step) html += `<span style="left:${(v / mm * 100).toFixed(2)}%">${v}${v + step > mm + 0.5 ? ' mm' : ''}</span>`;
  ticksEl.innerHTML = html;
  if (scaleEl) scaleEl.style.setProperty('--minor', `${(step / 5 / mm * 100).toFixed(3)}%`);
}

// tilt (phones)
if ('DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) {
  tiltBtn.hidden = false;
  tiltBtn.addEventListener('click', async () => {
    if (!state.tilt.on && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch { return; }
    }
    state.tilt.on = !state.tilt.on; toggleUI(tiltBtn, state.tilt.on);
    if (!state.tilt.on) { state.tilt.gx = 0; state.tilt.gy = 1; }
  });
  addEventListener('deviceorientation', (e) => {
    if (!state.tilt.on) return;
    // left-right tilt is gamma in portrait; in landscape the screen's horizontal is the device's long axis,
    // so the same gesture shows up in beta (sign set by which way the phone was turned)
    const ang = (screen.orientation && screen.orientation.angle) ?? (typeof window.orientation === 'number' ? window.orientation : 0);
    let t = e.gamma;
    if (ang === 90) t = e.beta; else if (ang === 270 || ang === -90) t = e.beta == null ? null : -e.beta;
    if (t == null) return;
    const g = Math.max(-40, Math.min(40, t)) * Math.PI / 180;
    state.tilt.gx = Math.sin(g); state.tilt.gy = Math.cos(g);
  });
}

// ---------------------------------------------------------------- boot
function setup() {
  buildWorld();
  if (world.tier === 'ultra' && world.benchMs > 6.5 && !(DEBUG && new URLSearchParams(location.search).get('tier'))) {
    if (DEBUG) console.info('water: ultra benchmark', world.benchMs.toFixed(2), 'ms/step -> high tier');
    state.ultraFailed = true;
    buildWorld();
  }
  placeLeaves(state.gate.pos);   // a rebuild (resize, rotation) keeps the leaves where they were: no full-stroke jump
  const dprCap = world.phone ? 1.75 : 2;
  const dpr = Math.min(devicePixelRatio || 1, dprCap);
  const inkDpr = Math.min(devicePixelRatio || 1, 2.5);
  const dynDpr = Math.min(devicePixelRatio || 1, world.phone ? 2 : 2.5);   // moving annotations: a little cheaper on phones
  inkCanvas.width = Math.round(world.cssW * dynDpr); inkCanvas.height = Math.round(world.cssH * dynDpr);
  drawSheet(dpr);
  drawStaticInk(inkDpr);
  if (!renderer && !fallback2d) {
    const r = createRenderer(glCanvas, { maxParticles: world.phone ? 6000 : 16000, low: world.phone });
    if (r.ok) renderer = r;
    else {
      // a canvas that already holds a WebGL context can never give a 2-D one: swap in a fresh canvas
      console.warn('water: WebGL2 path unavailable (' + r.reason + '), using 2-D fallback');
      const c2 = document.createElement('canvas');
      c2.className = glCanvas.className; c2.id = glCanvas.id; c2.setAttribute('aria-hidden', 'true');
      glCanvas.replaceWith(c2); glCanvas = c2;
      fallback2d = glCanvas.getContext('2d');
    }
  }
  if (renderer) {
    renderer.resize(world.cssW, world.cssH, dpr);
    const P = renderer.P;
    // kernel (1 - r²)² over ~2.3 particle spacings; its disc integral is πR²/3. Normalise so the resting
    // bulk sums to ~1 and the iso-surface sits near the particles.
    const rPx = world.r * world.scale, R = 2.3 * 2 * rPx;
    P.radiusPx = R;
    P.norm = 1 / ((1 / (3.46 * rPx * rPx)) * Math.PI * R * R / 3);
    P.shadow = [1.5, 2.5];
    renderer.setSheet(sheetCanvas);
  } else { glCanvas.width = Math.round(world.cssW * dpr); glCanvas.height = Math.round(world.cssH * dpr); }
  setGateTarget(state.gate.target, 'setup');
  updateTicks();
  if (DEBUG) window.__water = { get world() { return world; }, state, renderer, setGateTarget, fillWater, audio, setFocus };
}

let resizeTimer = 0, lastW = 0, lastH = 0;
function onResize() {
  const r = stageEl.getBoundingClientRect();
  if (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2) return;
  lastW = r.width; lastH = r.height;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const keep = state.gate.target; setup(); setGateTarget(keep, 'setup'); }, world ? 180 : 0);
}

function boot() {
  syncMotionBtn();
  toggleUI(dyeBtn, state.dye);
  updateHint();
  const r = stageEl.getBoundingClientRect(); lastW = r.width; lastH = r.height;
  setup();
  new ResizeObserver(onResize).observe(stageEl);
  // pause the solver and the renderer while the drawing is scrolled out of view
  state.visible = true;
  new IntersectionObserver((es) => { state.visible = es[es.length - 1].isIntersecting; audio.sync(); }, { threshold: 0.02 }).observe(stageEl);
  glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); renderer = null; });
  glCanvas.addEventListener('webglcontextrestored', () => { setup(); });
  gripEl.addEventListener('pointerdown', () => store.set('water-grip-used', '1'), { once: true });
  state.lastT = performance.now();
  requestAnimationFrame(frame);
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot); else boot();
