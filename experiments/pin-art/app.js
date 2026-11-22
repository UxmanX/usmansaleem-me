import { mountShell, fitCanvas, makeLoop, loadImage, clamp } from '../shared/shell.js';
import { PinField, buildPortraitRelief } from './model.mjs?v=material-2';

const shell = mountShell({ id: 'pin-art', title: 'Pin art' });
const canvas = document.getElementById('experiment-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const depthInput = document.getElementById('relief-depth');
const depthOutput = document.getElementById('depth-value');

const W = 89;
const H = 116;
const CAP_LEVELS = 64;
const CAP_SIZE = 24;
const PRESS_RADIUS = 12;
const DRAG_RADIUS = 11;
const RELEASE_RADIUS = 15;
const SETTLE_ENERGY = 1e-8;

// Upper-left key light and Blinn-Phong half-vector (screen coords: +x right, +y down, +z viewer)
const LIGHT_X = -0.52;
const LIGHT_Y = -0.58;
const LIGHT_Z = 0.63;
const HALF_LEN = Math.hypot(LIGHT_X, LIGHT_Y, LIGHT_Z + 1);
const HALF_X = LIGHT_X / HALF_LEN;
const HALF_Y = LIGHT_Y / HALF_LEN;
const HALF_Z = (LIGHT_Z + 1) / HALF_LEN;

// Pre-allocated brushed steel / gunmetal shaft palettes (zero per-frame string allocations)
const SHAFT_BODY = Array.from({ length: 16 }, (_, i) => {
  const v = Math.round(16 + (i / 15) * 62);
  return `rgb(${v - 3},${v + 2},${v + 3})`;
});
const SHAFT_HI = Array.from({ length: 16 }, (_, i) => {
  const v = Math.round(44 + (i / 15) * 168);
  return `rgb(${v - 3},${v + 2},${v + 4})`;
});

const caps = [];
let pins = null;
let albedo = null;
let fg = null;
let size = null;
let loop = null;
let geo = null;
let ready = false;
let visible = true;
let interactions = 0;
let playGesture = 0;
let pressing = null;
let depth = depthInput ? clamp((Number(depthInput.value) || 70) / 100, 0.2, 1) : 0.7;

if (depthInput && depthOutput) {
  depthOutput.textContent = `${Math.round(depth * 100)}%`;
}

function buildCaps() {
  const count = CAP_SIZE * CAP_SIZE;
  const maskArr = new Float32Array(count);
  const ndotlArr = new Float32Array(count);
  const specArr = new Float32Array(count);
  const rimArr = new Float32Array(count);
  const edgeArr = new Float32Array(count);

  const cx = (CAP_SIZE - 1) * 0.5;
  const cy = (CAP_SIZE - 1) * 0.5;
  const rx = CAP_SIZE * 0.44;
  const ry = CAP_SIZE * 0.41;

  for (let py = 0; py < CAP_SIZE; py++) {
    const ey = (py - cy) / ry;
    for (let px = 0; px < CAP_SIZE; px++) {
      const idx = py * CAP_SIZE + px;
      const ex = (px - cx) / rx;
      const r2 = ex * ex + ey * ey;
      const rr = Math.sqrt(r2);
      const mask = clamp((1 - rr) * (CAP_SIZE * 0.42), 0, 1);
      maskArr[idx] = mask;
      if (mask <= 0) continue;

      const nzRaw = Math.sqrt(clamp(1 - r2 * 0.88, 0.04, 1));
      const nxRaw = ex * 0.94;
      const nyRaw = ey * 0.94;
      const inv = 1 / Math.hypot(nxRaw, nyRaw, nzRaw);
      const nx = nxRaw * inv;
      const ny = nyRaw * inv;
      const nz = nzRaw * inv;

      ndotlArr[idx] = clamp(nx * LIGHT_X + ny * LIGHT_Y + nz * LIGHT_Z, 0, 1);
      const ndoth = clamp(nx * HALF_X + ny * HALF_Y + nz * HALF_Z, 0, 1);
      specArr[idx] = Math.pow(ndoth, 15);
      // Faint warm bounce from the #ff541e backdrop on lower-right bevel
      rimArr[idx] = clamp(nx * 0.62 + ny * 0.62 - nz * 0.18, 0, 1) * 0.14;
      edgeArr[idx] = clamp((rr - 0.76) / 0.24, 0, 1);
    }
  }

  caps.length = 0;
  for (let i = 0; i < CAP_LEVELS; i++) {
    const c = document.createElement('canvas');
    c.width = CAP_SIZE;
    c.height = CAP_SIZE;
    const x = c.getContext('2d');
    const img = x.createImageData(CAP_SIZE, CAP_SIZE);
    const data = img.data;
    const t = i / (CAP_LEVELS - 1);
    const base = 0.065 + 0.84 * Math.pow(t, 0.95);
    const specGain = 0.07 + 0.48 * t;
    const warmScale = 1 - t * 0.45;

    for (let idx = 0; idx < count; idx++) {
      const m = maskArr[idx];
      if (m <= 0) continue;
      let shade = base * (0.40 + 0.76 * ndotlArr[idx]) + specGain * specArr[idx];
      shade *= 1 - 0.42 * edgeArr[idx];
      const rim = rimArr[idx] * warmScale;
      const o = idx * 4;
      data[o] = clamp(Math.round((shade * 0.97 + rim * 0.24) * 255), 10, 253);
      data[o + 1] = clamp(Math.round((shade * 1.00 + rim * 0.08) * 255), 12, 254);
      data[o + 2] = clamp(Math.round((shade * 1.02 + rim * 0.03) * 255), 13, 255);
      data[o + 3] = Math.round(m * 255);
    }
    x.putImageData(img, 0, 0);
    caps.push(c);
  }
}

function computeGeo(width, height) {
  const aspect = 1.25;
  const shearF = 0.056;
  const dropF = 0.038;
  const maxLiftYF = 0.125;
  const maxLiftXF = 0.030;
  const padX = 0.038;
  const padY = 0.032;
  const thickF = 0.032;

  // Size and center against max-depth envelope so moving the depth slider never shifts the housing
  const totalWF = 1 + 2 * padX + shearF * (1 + 2 * padY) + maxLiftXF + thickF * 0.30;
  const totalHF = aspect * (1 + 2 * padY + dropF * (1 + padX)) + maxLiftYF * 0.92 + thickF;
  const bw = Math.max(40, Math.min((width - 24) / totalWF, (height - 22) / totalHF));
  const bh = bw * aspect;
  const shear = bw * shearF;
  const drop = bh * dropF;
  const liftY = bw * maxLiftYF * depth;
  const liftX = bw * maxLiftXF * depth;
  const thick = Math.max(7, bw * thickF);
  const thickX = thick * (maxLiftXF / maxLiftYF);

  const minX = -padX * bw - bw * maxLiftXF * 0.75;
  const maxX = (1 + padX) * bw + shear * (1 + padY) + thickX;
  const minY = -padY * bh - bw * maxLiftYF * 0.75;
  const maxY = (1 + padY) * bh + drop * (1 + padX) + thick;
  const left = (width - (maxX - minX)) * 0.5 - minX;
  const top = (height - (maxY - minY)) * 0.5 - minY;

  return {
    bw, bh, left, top, shear, drop,
    liftX, liftY, liftLen: Math.hypot(liftX, liftY),
    padX, padY, thick, thickX,
    det: bw * bh + drop * shear,
  };
}

function project(nx, ny, z = 0) {
  const { left, top, bw, bh, shear, drop, liftX, liftY } = geo;
  return [
    left + nx * bw + shear * (1 - ny) - liftX * z,
    top + ny * bh + drop * nx - liftY * z,
  ];
}

function polygon(points, fill) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i) ctx.lineTo(p[0], p[1]);
    else ctx.moveTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function render() {
  if (!pins || !size) return;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.fillStyle = '#ff541e';
  ctx.fillRect(0, 0, size.width, size.height);

  geo = computeGeo(size.width, size.height);
  const { bw, bh, left, top, shear, drop, liftX, liftY, liftLen, padX, padY, thick, thickX } = geo;

  const a = project(-padX, -padY, 0);
  const b = project(1 + padX, -padY, 0);
  const c = project(1 + padX, 1 + padY, 0);
  const d = project(-padX, 1 + padY, 0);

  // Cast shadow onto the orange backdrop
  ctx.save();
  ctx.shadowColor = 'rgba(54,20,10,.34)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 9;
  ctx.shadowOffsetY = 18;
  polygon([a, b, c, d], '#1b2222');
  ctx.restore();

  // Extruded anodized housing walls parallel to -Z (+thickX, +thick)
  const b2 = [b[0] + thickX, b[1] + thick];
  const c2 = [c[0] + thickX, c[1] + thick];
  const d2 = [d[0] + thickX, d[1] + thick];
  polygon([b, c, c2, b2], '#293130');
  polygon([d, c, c2, d2], '#414a48');

  // Machined bezel face
  const plate = ctx.createLinearGradient(left, top, left + bw, top + bh);
  plate.addColorStop(0, '#49524f');
  plate.addColorStop(0.45, '#2b3332');
  plate.addColorStop(1, '#141b1a');
  polygon([a, b, c, d], plate);

  // Subtle top-left bevel catchlight
  ctx.strokeStyle = 'rgba(218,226,222,.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(d[0], d[1]);
  ctx.lineTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();

  // Recessed perforated pin bed
  const wa = project(-0.012, -0.010, 0);
  const wb = project(1.012, -0.010, 0);
  const wc = project(1.012, 1.010, 0);
  const wd = project(-0.012, 1.010, 0);
  polygon([wa, wb, wc, wd], '#0e1313');

  const step = bw / (W - 1);
  const r = step * 0.485;
  const capSize = r * 2.10;
  const capHalf = capSize * 0.5;
  const shaftW = Math.max(0.9, r * 1.48);
  const hiW = Math.max(0.45, r * 0.40);

  // Unit perpendicular offsets for cylindrical shaft shadow & upper-left specular edge
  const invLen = liftLen > 1e-4 ? 1 / liftLen : 0;
  const ux = liftX * invLen;
  const uy = liftY * invLen;
  const hiOffX = -uy * r * 0.35;
  const hiOffY = ux * r * 0.35;
  const shOffX = uy * r * 0.20;
  const shOffY = -ux * r * 0.20;

  const zArr = pins.z;
  const vArr = pins.v;
  const srcArr = pins.source;
  const invWm1 = 1 / (W - 1);
  const invHm1 = 1 / (H - 1);
  const slopeScale = 2.8 * (0.45 + 0.78 * depth);
  const shadowScale = 3.8 * depth;

  ctx.lineCap = 'butt';

  // Back-to-front painter's order matches pins projecting up-left (-liftX, -liftY)
  for (let y = 0; y < H; y++) {
    const ny = y * invHm1;
    const row = y * W;
    const rowUp = y > 0 ? row - W : row;
    const rowDn = y < H - 1 ? row + W : row;
    const baseRowX = left + shear * (1 - ny);
    const baseRowY = top + ny * bh;

    for (let x = 0; x < W; x++) {
      const i = row + x;
      const z = zArr[i];
      const src = srcArr[i];
      const u = z - src;
      const vel = vArr[i];

      const xL = x > 0 ? x - 1 : 0;
      const xR = x < W - 1 ? x + 1 : W - 1;
      const zL = zArr[row + xL];
      const zR = zArr[row + xR];
      const zU = zArr[rowUp + x];
      const zD = zArr[rowDn + x];
      const zUL = zArr[rowUp + xL];

      // Live 3D surface normal combines resting relief slope + dynamic travelling-wave gradient
      const uL = zL - srcArr[row + xL];
      const uR = zR - srcArr[row + xR];
      const uU = zU - srcArr[rowUp + x];
      const uD = zD - srcArr[rowDn + x];
      const gx = (zR - zL) * slopeScale + (uR - uL) * 3.8;
      const gy = (zD - zU) * slopeScale + (uD - uU) * 3.8;
      const invN = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const nxN = -gx * invN;
      const nyN = -gy * invN;
      const nzN = invN;

      const ndotl = clamp(nxN * LIGHT_X + nyN * LIGHT_Y + nzN * LIGHT_Z, 0, 1);
      const ndoth = clamp(nxN * HALF_X + nyN * HALF_Y + nzN * HALF_Z, 0, 1);
      const ndoth2 = ndoth * ndoth;
      const ndoth4 = ndoth2 * ndoth2;
      const spec = ndoth4 * ndoth4 * ndoth;

      const cavity = clamp(((zL + zR + zU + zD) * 0.25 - z) * 4.8, 0, 1);
      const castSh = clamp((zUL - z) * shadowScale, 0, 0.68);
      const dep = u < 0 ? -u : 0;
      const over = u > 0 ? u : 0;
      const absVel = vel < 0 ? -vel : vel;
      const waveEnergy = clamp((u < 0 ? -u : u) * 6.5 + absVel * 0.45, 0, 1);

      const alb = albedo[i];
      const reliefLight = 0.28 + 0.84 * ndotl;
      const tone = clamp(
        alb * (0.56 + 0.56 * reliefLight)
          + (0.15 * fg[i] + 0.24 * waveEnergy) * (ndotl - 0.52)
          + (0.28 + 0.34 * waveEnergy) * spec
          + 0.09 * z
          + 0.34 * over
          + clamp(absVel * 0.09, 0, 0.16)
          - 0.44 * dep
          - 0.30 * cavity
          - 0.28 * castSh,
        0.01,
        0.99
      );

      const nx = x * invWm1;
      const bx = baseRowX + nx * bw;
      const by = baseRowY + nx * drop;
      const px = bx - liftX * z;
      const py = by - liftY * z;
      const shaftPx = z * liftLen;

      if (shaftPx > 0.7) {
        const lit = ndotl * (1 - castSh) * (1 - 0.5 * dep);
        const bodyIdx = clamp(Math.round((lit * 0.56 + alb * 0.36) * 15), 0, 15);
        ctx.strokeStyle = SHAFT_BODY[bodyIdx];
        ctx.lineWidth = shaftW;
        ctx.beginPath();
        ctx.moveTo(bx + shOffX, by + shOffY);
        ctx.lineTo(px + shOffX, py + shOffY);
        ctx.stroke();

        if (shaftPx > 2.0) {
          const hiIdx = clamp(Math.round((lit * 0.54 + alb * 0.24 + over * 0.40) * 15), 0, 15);
          if (hiIdx > 1) {
            ctx.strokeStyle = SHAFT_HI[hiIdx];
            ctx.lineWidth = hiW;
            ctx.beginPath();
            ctx.moveTo(bx + hiOffX, by + hiOffY);
            ctx.lineTo(px + hiOffX, py + hiOffY);
            ctx.stroke();
          }
        }
      }

      ctx.drawImage(
        caps[Math.min(CAP_LEVELS - 1, (tone * (CAP_LEVELS - 1)) | 0)],
        px - capHalf,
        py - capHalf,
        capSize,
        capSize
      );
    }
  }

  // Machined corner socket screws
  const midX = left + bw * 0.5;
  const midY = top + bh * 0.5;
  const screwOffset = Math.max(4, bw * 0.016);
  const screwR = Math.max(2.1, bw * 0.0075);
  for (const [cx, cy] of [a, b, c, d]) {
    const sx = cx + (cx < midX ? screwOffset : -screwOffset);
    const sy = cy + (cy < midY ? screwOffset : -screwOffset);
    ctx.fillStyle = '#181e1e';
    ctx.beginPath();
    ctx.arc(sx, sy, screwR * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9ba5a1';
    ctx.beginPath();
    ctx.arc(sx, sy, screwR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#252c2b';
    ctx.beginPath();
    ctx.arc(sx, sy, screwR * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}

function unprojectAtZ(px, py, z) {
  const { left, top, bw, bh, shear, drop, liftX, liftY, det } = geo;
  const dx = px - left - shear + liftX * z;
  const dy = py - top + liftY * z;
  return {
    x: ((dx * bh + dy * shear) / det) * (W - 1),
    y: ((dy * bw - dx * drop) / det) * (H - 1),
  };
}

/** Pick pointer coordinates against the lifted 3D resting relief surface so features align under cursor. */
function pickPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) * size.width) / Math.max(1, rect.width);
  const py = ((e.clientY - rect.top) * size.height) / Math.max(1, rect.height);
  if (!geo) geo = computeGeo(size.width, size.height);

  const src = pins.source;
  const steps = 14;
  let prevZ = 0.96;
  let prevDiff = 1;
  for (let s = 0; s <= steps; s++) {
    const zTest = 0.96 - (0.86 * s) / steps;
    const pt = unprojectAtZ(px, py, zTest);
    const gx = clamp(Math.round(pt.x), 0, W - 1);
    const gy = clamp(Math.round(pt.y), 0, H - 1);
    const inBoard = pt.x >= -1 && pt.x <= W && pt.y >= -1 && pt.y <= H;
    const hVal = inBoard ? src[gy * W + gx] : 0.14;
    const diff = zTest - hVal;
    if (diff <= 0) {
      const denom = prevDiff - diff;
      const frac = denom > 1e-5 ? clamp(prevDiff / denom, 0, 1) : 1;
      const zHit = prevZ + (zTest - prevZ) * frac;
      return unprojectAtZ(px, py, zHit);
    }
    prevZ = zTest;
    prevDiff = diff;
  }
  return unprojectAtZ(px, py, 0.14);
}

function isNearBoard(pt, margin) {
  return pt.x >= -margin && pt.x <= W - 1 + margin && pt.y >= -margin && pt.y <= H - 1 + margin;
}

function hasActivity() {
  return Boolean(pins && pins.snapshot().energy >= SETTLE_ENERGY);
}

function wake() {
  if (ready && shell.motion && visible && loop && !loop.running) {
    loop.start();
  }
}

function tick(dt) {
  if (pressing) {
    pins.press(pressing.x, pressing.y, PRESS_RADIUS, { strength: 1, hold: 0.05, impulse: 0.4 });
  }
  pins.step(dt);
  if (pressing) {
    pins.press(pressing.x, pressing.y, PRESS_RADIUS, { strength: 1, hold: 0.05, impulse: 0 });
  }
  render();
  if (!pressing && pins.snapshot().energy < SETTLE_ENERGY) {
    loop.stop();
  }
}

function releaseCapture(id) {
  if (canvas.hasPointerCapture && canvas.hasPointerCapture(id)) {
    try { canvas.releasePointerCapture(id); } catch { /* Ignore synthetic pointer cleanup. */ }
  }
}

function endPress(e, { boost = true, shouldWake = true } = {}) {
  if (!pressing) return;
  if (e && e.pointerId !== undefined && e.pointerId !== pressing.id) return;
  const { id, x, y } = pressing;
  pressing = null;
  releaseCapture(id);
  if (pins) {
    pins.release(x, y, RELEASE_RADIUS, boost ? 2.1 : 0.6);
  }
  if (shouldWake && shell.motion) {
    wake();
  } else {
    render();
  }
}

function play() {
  if (!ready || !pins) return;
  const gesture = playGesture % 3;
  playGesture++;
  const motionOn = shell.motion;
  if (gesture === 0) {
    pins.stroke(W * 0.35, H * 0.43, W * 0.64, H * 0.55, 12.5, {
      hold: 0.14,
      stagger: motionOn ? 0.16 : 0,
      impulse: 2.0,
    });
  } else if (gesture === 1) {
    pins.stroke(W * 0.64, H * 0.41, W * 0.36, H * 0.57, 12.5, {
      hold: 0.14,
      stagger: motionOn ? 0.16 : 0,
      impulse: 2.0,
    });
  } else {
    pins.press(W * 0.50, H * 0.48, 15, {
      hold: 0.15,
      impulse: 2.4,
    });
  }
  interactions++;
  render();
  wake();
  shell.setStatus(
    motionOn
      ? 'Pins pressed. Watch the mechanical wave spring the portrait back.'
      : 'Pins pressed in a still pose. Reset or resume motion to recover.'
  );
}

async function init() {
  try {
    const image = await loadImage('../../assets/headshot.jpg');
    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    // Existing portrait crop matching the supplied headshot framing
    offCtx.drawImage(image, 260, 590, 1050, 1450, 0, 0, W, H);
    const pixels = offCtx.getImageData(0, 0, W, H).data;

    const relief = buildPortraitRelief(pixels, W, H);
    albedo = relief.albedo;
    fg = relief.fg;
    pins = new PinField(W, H, relief.heights);

    buildCaps();
    size = fitCanvas(canvas, 1.75);
    render();
    loop = makeLoop(tick, { enabled: false });
    ready = true;
    shell.markReady({ rendering: 'canvas2d' });

    new ResizeObserver(() => {
      size = fitCanvas(canvas, 1.75);
      render();
    }).observe(canvas);

    new IntersectionObserver(entries => {
      visible = Boolean(entries[0] && entries[0].isIntersecting);
      if (!visible) {
        if (pressing) endPress(null, { boost: false, shouldWake: false });
        loop.stop();
      } else if (hasActivity()) {
        wake();
      }
    }).observe(canvas);

    shell.onMotionChange(on => {
      if (!on) {
        if (pressing) {
          releaseCapture(pressing.id);
          pressing = null;
        }
        loop.stop();
        render();
      } else if (hasActivity()) {
        wake();
      }
    });

    canvas.addEventListener('pointerdown', e => {
      if (!ready || pressing || (typeof e.button === 'number' && e.button !== 0)) return;
      const pt = pickPoint(e);
      if (!isNearBoard(pt, PRESS_RADIUS)) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* Ignore synthetic pointers. */ }
      pressing = { id: e.pointerId, x: pt.x, y: pt.y };
      pins.press(pt.x, pt.y, PRESS_RADIUS, {
        strength: 1,
        hold: shell.motion ? 0.08 : 0.14,
        impulse: 1.8,
      });
      interactions++;
      render();
      wake();
    });

    canvas.addEventListener('pointermove', e => {
      if (!pressing || e.pointerId !== pressing.id) return;
      const pt = pickPoint(e);
      pins.stroke(pressing.x, pressing.y, pt.x, pt.y, DRAG_RADIUS, {
        strength: 1,
        hold: shell.motion ? 0.10 : 0.16,
        stagger: shell.motion ? 0.08 : 0,
        impulse: 1.5,
      });
      pressing.x = pt.x;
      pressing.y = pt.y;
      interactions++;
      render();
      wake();
    });

    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(name, e => endPress(e, { boost: name === 'pointerup' }));
    }

    window.addEventListener('blur', () => endPress(null, { boost: false }));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && pressing) endPress(null, { boost: false });
    });

    document.addEventListener('experiment:play', play);
    document.addEventListener('experiment:reset', () => {
      if (pressing) {
        releaseCapture(pressing.id);
        pressing = null;
      }
      loop.stop();
      pins.reset();
      render();
    });

    if (depthInput) {
      depthInput.addEventListener('input', e => {
        depth = clamp(Number(e.target.value) / 100, 0.2, 1);
        if (depthOutput) depthOutput.textContent = `${e.target.value}%`;
        interactions++;
        render();
      });
    }

    if (new URLSearchParams(location.search).has('debug')) {
      window.__experiment = {
        id: 'pin-art',
        snapshot: () => ({
          ...pins.snapshot(),
          depth,
          motion: shell.motion,
          ready,
          interactions,
          pressed: Boolean(pressing),
          running: loop.running,
        }),
      };
    }
  } catch (error) {
    document.body.dataset.imageFailed = 'true';
    const message = document.querySelector('.portrait-message span');
    if (message) message.textContent = 'Portrait unavailable. Reload to try again.';
    shell.setStatus('The portrait could not load. Please reload to try again; portfolio links are available.');
    console.error(error);
  }
}

init();
