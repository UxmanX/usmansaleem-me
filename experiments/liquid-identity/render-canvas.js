// Liquid Identity — Canvas 2D fallback renderer.
// Same idea as the WebGL path at lower resolution: accumulate a density
// field with additive sprites, then threshold and light it per pixel.
import { summarize } from './render-webgl.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const GAIN = 0.22; // sprite peak in 0..1 alpha; field = R / 255 / GAIN

export function createCanvasRenderer(canvas, { colors } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const field = document.createElement('canvas');
  const fctx = field.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas');
  const octx = out.getContext('2d');
  const sprite = document.createElement('canvas');
  let spriteSize = 0;
  let shade = null;
  const ink = hex(colors?.ink || '#181c1c');
  const paper = hex(colors?.paper || '#fbf8f3');
  const orange = hex(colors?.orange || '#ff541e');

  function makeSprite(px) {
    const size = Math.max(4, Math.ceil(px));
    if (size === spriteSize) return;
    spriteSize = size;
    sprite.width = size;
    sprite.height = size;
    const s = sprite.getContext('2d');
    const img = s.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = ((x + 0.5) / size) * 2 - 1;
        const dy = ((y + 0.5) / size) * 2 - 1;
        const r2 = dx * dx + dy * dy;
        const w = r2 < 1 ? (1 - r2) ** 3 : 0;
        const i = (y * size + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(w * GAIN * 255);
      }
    }
    s.putImageData(img, 0, 0);
  }

  function render(model, view, magnet) {
    const q = 0.5; // field resolution relative to css px
    const W = Math.max(1, Math.round(view.width * q));
    const H = Math.max(1, Math.round(view.height * q));
    if (field.width !== W || field.height !== H) {
      field.width = W; field.height = H; out.width = W; out.height = H;
      shade = octx.createImageData(W, H);
    }
    const r = model.kernel * view.scale * q;
    makeSprite(2 * r);
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, W, H);
    fctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < model.count; i += 1) {
      const x = (view.ox + model.x[i] * view.scale) * q - spriteSize / 2;
      const y = (view.oy + model.y[i] * view.scale) * q - spriteSize / 2;
      fctx.drawImage(sprite, x, y);
    }
    const src = fctx.getImageData(0, 0, W, H).data;
    const dst = shade.data;
    const T = model.threshold;
    const f = (x, y) => src[(y * W + x) * 4 + 3] / 255 / GAIN;
    const hgt = (v) => Math.sqrt(Math.max(v - T * 0.55, 0));
    const sx = Math.round(r * 0.32);
    const sy = Math.round(r * 0.45);
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        const i = (y * W + x) * 4;
        const v = f(x, y);
        const a = Math.min(1, Math.max(0, (v - T) / 0.25 + 0.5));
        const xs = Math.min(W - 1, Math.max(0, x - sx));
        const ys = Math.min(H - 1, Math.max(0, y - sy));
        const sv = f(xs, ys);
        const sa = Math.min(1, Math.max(0, (sv - T * 0.15) / (T * 1.6))) * 0.17 * (1 - a);
        if (a <= 0) {
          dst[i] = 77; dst[i + 1] = 61; dst[i + 2] = 46; dst[i + 3] = sa * 255;
          continue;
        }
        const gx = hgt(f(x + 1, y)) - hgt(f(x - 1, y));
        const gy = hgt(f(x, y + 1)) - hgt(f(x, y - 1));
        let nx = -gx * 2.2;
        let ny = gy * 2.2; // flip to y-up lighting
        let nz = 1;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        const diff = Math.max(0, nx * -0.5 + ny * 0.62 + nz * 0.62) / 1.0;
        const hx = -0.5; const hy = 0.62; const hz = 1.62;
        const hl = Math.hypot(hx, hy, hz);
        const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
        const spec = ndh ** 120 * 1.2 + ndh ** 16 * 0.12;
        const fres = (1 - nz) ** 2.4;
        const bounce = Math.max(0, nx * 0.62 - ny * 0.55 + nz * 0.35) ** 3;
        for (let c = 0; c < 3; c += 1) {
          let col = ink[c] * (0.62 + 0.32 * diff);
          col += (paper[c] * 0.78 - col) * fres * 0.55;
          col += orange[c] * bounce * 0.2;
          col += 255 * spec;
          dst[i + c] = Math.min(255, col);
        }
        dst[i + 3] = Math.min(255, (a + sa) * 255);
      }
    }
    octx.putImageData(shade, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, 0, 0, canvas.width, canvas.height);
    if (magnet && magnet.strength > 0) {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      ctx.strokeStyle = `rgba(${orange.join(',')},${magnet.strength})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(magnet.x, magnet.y, magnet.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function readInk(cols = 40, rows = 25) {
    const { width: w, height: h } = canvas;
    const px = ctx.getImageData(0, 0, w, h).data;
    return summarize(px, w, h, cols, rows, false);
  }

  return { kind: 'canvas2d', render, readInk };
}
