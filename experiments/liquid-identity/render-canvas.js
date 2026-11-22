// Liquid Identity — Canvas 2D fallback renderer.
// Matches the WebGL pooled-liquid meniscus shading and tension sheen at lower
// resolution: accumulates a density field with additive sprites, derives
// scale-invariant meniscus normals, and lights the mark as glossy obsidian ink.
import { summarize } from './render-webgl.js?v=material-2';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const GAIN = 0.18; // density sprite peak in 0..1 alpha; field = A / 255 / GAIN (range 0..5.55)
const META_GAIN = 0.08; // lower gain for strain+energy channels so premultiplied alpha never clips

function smoothstep(e0, e1, v) {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function createCanvasRenderer(canvas, { colors } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const field = document.createElement('canvas');
  const fctx = field.getContext('2d', { willReadFrequently: true });
  const meta = document.createElement('canvas');
  const mctx = meta.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas');
  const octx = out.getContext('2d');
  const sprite = document.createElement('canvas');
  const strainSprite = document.createElement('canvas');
  const energySprite = document.createElement('canvas');
  let spriteSize = 0;
  let shade = null;
  const ink = hex(colors?.ink || '#181c1c');
  const paper = hex(colors?.paper || '#fbf8f3');
  const orange = hex(colors?.orange || '#ff541e');
  const copper = [
    orange[0] * 0.72 + 255 * 0.28,
    orange[1] * 0.72 + 168 * 0.28,
    orange[2] * 0.72 + 92 * 0.28,
  ];

  // Normalized lighting vectors matching render-webgl.js.
  const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const L = norm3(-0.46, 0.62, 0.64);
  const Hv = norm3(L[0], L[1], L[2] + 1);
  const L1 = norm3(-0.45, 0.54, 0.71);
  const L2 = norm3(0.56, -0.48, 0.67);
  const Lb = norm3(0.62, -0.55, 0.35);

  function fillSprite(target, r, g, b, size, gain) {
    target.width = size;
    target.height = size;
    const s = target.getContext('2d');
    const img = s.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = ((x + 0.5) / size) * 2 - 1;
        const dy = ((y + 0.5) / size) * 2 - 1;
        const r2 = dx * dx + dy * dy;
        const w = r2 < 1 ? (1 - r2) ** 3 : 0;
        const i = (y * size + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
        img.data[i + 3] = Math.round(w * gain * 255);
      }
    }
    s.putImageData(img, 0, 0);
  }

  function makeSprites(px) {
    const size = Math.max(4, Math.ceil(px));
    if (size === spriteSize) return;
    spriteSize = size;
    fillSprite(sprite, 255, 255, 255, size, GAIN);
    fillSprite(strainSprite, 255, 0, 0, size, META_GAIN);
    fillSprite(energySprite, 0, 255, 0, size, META_GAIN);
  }

  function render(model, view, magnet) {
    const q = 0.5; // field resolution relative to css px
    const W = Math.max(1, Math.round(view.width * q));
    const H = Math.max(1, Math.round(view.height * q));
    if (field.width !== W || field.height !== H) {
      field.width = W; field.height = H;
      meta.width = W; meta.height = H;
      out.width = W; out.height = H;
      shade = octx.createImageData(W, H);
    }
    const r = Math.max(2, model.kernel * view.scale * q);
    makeSprites(2 * r);

    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, W, H);
    fctx.globalCompositeOperation = 'lighter';
    const strainArr = model.strain;
    const energyArr = model.energy;
    let hasMeta = false;
    for (let i = 0; i < model.count; i += 1) {
      const px = (view.ox + model.x[i] * view.scale) * q - spriteSize / 2;
      const py = (view.oy + model.y[i] * view.scale) * q - spriteSize / 2;
      fctx.drawImage(sprite, px, py);
      if ((strainArr && strainArr[i] > 0.03) || (energyArr && energyArr[i] > 0.03)) hasMeta = true;
    }

    let metaSrc = null;
    if (hasMeta) {
      mctx.globalCompositeOperation = 'source-over';
      mctx.globalAlpha = 1;
      mctx.clearRect(0, 0, W, H);
      mctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < model.count; i += 1) {
        const sv = strainArr ? strainArr[i] : 0;
        const ev = energyArr ? energyArr[i] : 0;
        if (sv <= 0.03 && ev <= 0.03) continue;
        const px = (view.ox + model.x[i] * view.scale) * q - spriteSize / 2;
        const py = (view.oy + model.y[i] * view.scale) * q - spriteSize / 2;
        if (sv > 0.03) { mctx.globalAlpha = sv; mctx.drawImage(strainSprite, px, py); }
        if (ev > 0.03) { mctx.globalAlpha = ev; mctx.drawImage(energySprite, px, py); }
      }
      mctx.globalAlpha = 1;
      metaSrc = mctx.getImageData(0, 0, W, H).data;
    }

    const src = fctx.getImageData(0, 0, W, H).data;
    const dst = shade.data;
    const T = model.threshold;
    const invGain = 1 / (255 * GAIN);
    const fAt = (x, y) => src[(y * W + x) * 4 + 3] * invGain;
    const hgt = (v) => {
      const s = v - T * 0.85;
      return s > 0 ? s / (s + 0.72) : 0;
    };

    const step = Math.max(1, Math.round(r * 0.16));
    const gradGain = 1.48 / (2 * (step / r));
    const cxOff = Math.max(1, Math.round(r * 0.075));
    const cyOff = Math.max(1, Math.round(r * 0.095));
    const sxOff = Math.max(1, Math.round(r * 0.22));
    const syOff = Math.max(1, Math.round(r * 0.30));

    dst.fill(0);
    for (let y = 0; y < H; y += 1) {
      const ym = Math.max(0, y - step);
      const yp = Math.min(H - 1, y + step);
      const yc = Math.max(0, y - cyOff);
      const ys = Math.max(0, y - syOff);
      const rowOff = y * W;
      for (let x = 0; x < W; x += 1) {
        const v = src[(rowOff + x) * 4 + 3] * invGain;
        const xc = Math.max(0, x - cxOff);
        const xs = Math.max(0, x - sxOff);
        const vc = src[(yc * W + xc) * 4 + 3] * invGain;
        const vs = src[(ys * W + xs) * 4 + 3] * invGain;
        if (v < T * 0.25 && vc < T * 0.25 && vs < T * 0.14) continue;

        const i = (rowOff + x) * 4;
        const a = smoothstep(T - 0.14, T + 0.14, v);
        const contactA = smoothstep(T * 0.30, T * 1.15, vc) * 0.24;
        const castA = smoothstep(T * 0.14, T * 1.85, vs) * 0.11;
        const shadowA = Math.min(0.34, contactA + castA * (1 - contactA)) * (1 - a);

        if (a <= 0.004) {
          if (shadowA > 0.002) {
            dst[i] = 61; dst[i + 1] = 48; dst[i + 2] = 38;
            dst[i + 3] = Math.round(shadowA * 255);
          }
          continue;
        }

        const xm = Math.max(0, x - step);
        const xp = Math.min(W - 1, x + step);
        const h00 = hgt(fAt(xm, ym));
        const h10 = hgt(fAt(x, ym));
        const h20 = hgt(fAt(xp, ym));
        const h01 = hgt(fAt(xm, y));
        const h21 = hgt(fAt(xp, y));
        const h02 = hgt(fAt(xm, yp));
        const h12 = hgt(fAt(x, yp));
        const h22 = hgt(fAt(xp, yp));
        const gx = ((h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02)) * 0.25;
        const gy = ((h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20)) * 0.25;

        let nx = -gx * gradGain;
        let ny = gy * gradGain; // flip to y-up lighting
        let nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;

        const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const ndh = Math.max(0, nx * Hv[0] + ny * Hv[1] + nz * Hv[2]);
        const fres = (1 - nz) ** 2.6;
        const rx = 2 * nz * nx;
        const ry = 2 * nz * ny;
        const rz = 2 * nz * nz - 1;
        const win1 = smoothstep(0.78, 0.91, rx * L1[0] + ry * L1[1] + rz * L1[2]);
        const win2 = smoothstep(0.80, 0.93, rx * L2[0] + ry * L2[1] + rz * L2[2]) * 0.28;
        const sky = smoothstep(-0.25, 0.80, ry - rx * 0.35);
        const spec = ndh ** 160 * 1.05 + ndh ** 26 * 0.11;
        const bounce = Math.max(0, nx * Lb[0] + ny * Lb[1] + nz * Lb[2]) ** 3.2;

        let localStrain = 0;
        let localEnergy = 0;
        if (metaSrc && v > 1e-4) {
          // Canvas 2D getImageData returns un-premultiplied RGB; multiply by A
          // to recover the additive premultiplied strain and energy sums.
          const ma = metaSrc[i + 3] / 255;
          const metaScale = ma / (255 * META_GAIN * v);
          localStrain = Math.min(1, metaSrc[i] * metaScale);
          localEnergy = Math.min(1, metaSrc[i + 1] * metaScale);
        }
        const rimMask = 0.28 + 0.72 * ((1 - nz) ** 1.3);
        const wetFlash = localEnergy * (0.16 * (ndh ** 22) + 0.28 * fres);
        const totalA = Math.min(1, a + shadowA);
        const invOutA = totalA > 1e-4 ? 1 / totalA : 0;

        for (let c = 0; c < 3; c += 1) {
          let col = ink[c] * (0.42 + 0.34 * diff);
          const env = paper[c] * (0.34 + 0.44 * sky);
          col += (env - col) * fres * 0.52;
          col += orange[c] * bounce * 0.14;
          col += paper[c] * 0.96 * win2;
          col += (c === 0 ? 255 : c === 1 ? 252 : 247) * (spec + win1 * 0.58);
          col += copper[c] * localStrain * rimMask * 0.38;
          col += (c === 0 ? 255 : c === 1 ? 247 : 237) * wetFlash;
          col = Math.min(255, col);
          const sCol = c === 0 ? 61 : c === 1 ? 48 : 38;
          dst[i + c] = Math.min(255, Math.round((col * a + sCol * shadowA) * invOutA));
        }
        dst[i + 3] = Math.round(totalA * 255);
      }
    }

    octx.putImageData(shade, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, 0, 0, canvas.width, canvas.height);

    if (magnet && (magnet.strength > 0 || (magnet.pulse ?? 0) > 0.01)) {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      const t = magnet.tension || 0;
      const p = magnet.pulse || 0;
      if (magnet.strength > 0) {
        const rad = magnet.r * (1 - 0.16 * t);
        const alpha = Math.min(0.9, magnet.strength * (0.85 + 0.35 * t));
        ctx.strokeStyle = `rgba(${orange.join(',')},${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(magnet.x, magnet.y, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p > 0.01) {
        const pr = magnet.r * (0.95 + 0.55 * (1 - p));
        ctx.strokeStyle = `rgba(${orange.join(',')},${(p * 0.55).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(magnet.x, magnet.y, pr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function readInk(cols = 40, rows = 25) {
    const { width: w, height: h } = canvas;
    const px = ctx.getImageData(0, 0, w, h).data;
    return summarize(px, w, h, cols, rows, false);
  }

  return { kind: 'canvas2d', render, readInk };
}
