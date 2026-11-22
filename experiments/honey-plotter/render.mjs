// Liquid honey rendering helpers: C1 midpoint-spline thread, age-settling optics, tapered filament, brass nozzle.
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (start, end, amount) => start + (end - start) * amount;

export function threadStyle({ settle = 0, gloss = 0.85, pile = 0.2, width = 10 }) {
  const s = clamp(settle, 0, 1);
  const g = clamp(gloss, 0, 1);
  const p = clamp(pile, 0, 1);
  const w = Math.max(1.2, width);

  return {
    shadowOx: lerp(1.9, 0.85, s),
    shadowOy: lerp(4.9, 2.05, s),
    shadowWidth: w + lerp(3.6, 2.1, s) + p * 1.8,
    shadowAlpha: lerp(0.21, 0.13, s),

    causticOx: lerp(1.2, 0.55, s),
    causticOy: lerp(4.05, 1.6, s),
    causticWidth: Math.max(1.4, w * lerp(0.46, 0.62, s)),
    causticAlpha: lerp(0.29, 0.19, s),

    skirtOx: 0.24,
    skirtOy: lerp(0.9, 1.35, s),
    skirtWidth: w * (1.18 + s * 0.34 + p * 0.40),
    skirtAlpha: clamp(0.08 + s * 0.15 + p * 0.12, 0.06, 0.34),

    aoWidth: w + lerp(2.1, 1.05, s),
    aoAlpha: lerp(0.19, 0.08, s),

    rimWidth: w + lerp(1.15, 0.55, s),
    rimAlpha: lerp(0.72, 0.42, s),

    bodyWidth: Math.max(1.5, w - lerp(0.22, 0, s)),
    bodyAlpha: lerp(0.95, 0.86, s),

    coreOx: -lerp(0.28, 0.14, s),
    coreOy: -w * lerp(0.075, 0.036, s),
    coreWidth: Math.max(1.1, w * lerp(0.64, 0.74, s)),
    coreAlpha: lerp(0.86, 0.72, s),

    crownOx: -lerp(0.48, 0.24, s),
    crownOy: -w * lerp(0.15, 0.08, s),
    crownWidth: Math.max(0.9, w * lerp(0.30, 0.44, s)),
    crownAlpha: lerp(0.75, 0.42, s),

    specOx: -lerp(0.72, 0.34, s),
    specOy: -w * lerp(0.22, 0.12, s),
    specWidth: Math.max(0.85, w * lerp(0.135, 0.225, s)),
    specAlpha: clamp((0.34 + g * 0.54) * lerp(1.0, 0.48, s), 0.22, 0.86),
  };
}

export function sampleTrailPoints(model, w, h, beltY) {
  const raw = model.points;
  const pts = [];
  if (raw.length < 2) return pts;

  const pushPoint = p => {
    const age = Math.max(0, model.time - (p.born ?? model.time));
    const settle = typeof model.settleOf === 'function'
      ? model.settleOf(p)
      : clamp(age / (age + 3.4), 0, 1);
    pts.push({
      x: p.x * w,
      y: beltY(p.y, h),
      r: p.r ?? 1,
      pile: p.pile ?? 0.15,
      gloss: p.gloss ?? 0.85,
      settle,
    });
  };

  for (let i = 0; i < raw.length; i += 2) pushPoint(raw[i]);
  if ((raw.length - 1) % 2 !== 0) pushPoint(raw[raw.length - 1]);
  return pts;
}

function highlightBackfill(pts, start, ox, oy, bodyExtend = 0.45) {
  if (start <= 0) return 0;
  const prev = pts[start - 1];
  const curr = pts[start];
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.001) return 0;
  const proj = (ox * dx + oy * dy) / dist;
  const need = proj + bodyExtend;
  return need > 0 ? Math.min(3.5, need) : 0;
}

export function traceSmoothChunk(c, pts, start, end, ox = 0, oy = 0, extendBackPx = 0) {
  const n = pts.length;
  if (n < 2 || start >= end) return;
  c.beginPath();

  if (n === 2) {
    c.moveTo(pts[0].x + ox, pts[0].y + oy);
    c.lineTo(pts[1].x + ox, pts[1].y + oy);
    return;
  }

  if (start === 0) {
    c.moveTo(pts[0].x + ox, pts[0].y + oy);
    const m1x = (pts[0].x + pts[1].x) * 0.5 + ox;
    const m1y = (pts[0].y + pts[1].y) * 0.5 + oy;
    c.lineTo(m1x, m1y);
    for (let k = 1; k < end; k++) {
      const mx = (pts[k].x + pts[k + 1].x) * 0.5 + ox;
      const my = (pts[k].y + pts[k + 1].y) * 0.5 + oy;
      c.quadraticCurveTo(pts[k].x + ox, pts[k].y + oy, mx, my);
    }
  } else {
    const prev = pts[start - 1];
    const curr = pts[start];
    const m0x = (prev.x + curr.x) * 0.5 + ox;
    const m0y = (prev.y + curr.y) * 0.5 + oy;
    if (extendBackPx > 0) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.001) {
        c.moveTo(m0x - (dx / dist) * extendBackPx, m0y - (dy / dist) * extendBackPx);
        c.lineTo(m0x, m0y);
      } else {
        c.moveTo(m0x, m0y);
      }
    } else {
      c.moveTo(m0x, m0y);
    }
    for (let k = start; k < end; k++) {
      const mx = (pts[k].x + pts[k + 1].x) * 0.5 + ox;
      const my = (pts[k].y + pts[k + 1].y) * 0.5 + oy;
      c.quadraticCurveTo(pts[k].x + ox, pts[k].y + oy, mx, my);
    }
  }

  if (end === n - 1) {
    c.lineTo(pts[n - 1].x + ox, pts[n - 1].y + oy);
  }
}

function buildChunks(pts, baseThickness, chunkSize = 8) {
  const chunks = [];
  const lastIdx = pts.length - 1;
  for (let start = 0; start < lastIdx; start += chunkSize) {
    const end = Math.min(lastIdx, start + chunkSize);
    let rSum = 0;
    let pileSum = 0;
    let glossSum = 0;
    let settleSum = 0;
    for (let k = start; k <= end; k++) {
      const p = pts[k];
      rSum += p.r;
      pileSum += p.pile;
      glossSum += p.gloss;
      settleSum += p.settle;
    }
    const count = end - start + 1;
    const style = threadStyle({
      settle: settleSum / count,
      gloss: glossSum / count,
      pile: pileSum / count,
      width: baseThickness * (rSum / count),
    });
    chunks.push({ start, end, style });
  }
  return chunks;
}

export function drawDepositedThread(c, model, w, h, baseThickness, beltY) {
  const pts = sampleTrailPoints(model, w, h, beltY);
  if (pts.length < 2) return;

  const chunks = buildChunks(pts, baseThickness, 8);
  c.lineJoin = 'round';
  c.lineCap = 'butt';

  // Pass 1a: Age-adaptive belt cast shadow (closer and softer as honey slumps flat).
  for (let i = 0; i < chunks.length; i++) {
    const { start, end, style } = chunks[i];
    traceSmoothChunk(c, pts, start, end, style.shadowOx, style.shadowOy, 0);
    c.strokeStyle = `rgba(78, 32, 6, ${style.shadowAlpha.toFixed(3)})`;
    c.lineWidth = style.shadowWidth;
    c.stroke();
  }

  // Pass 1b: Refracted amber caustic glowing inside the cast shadow.
  for (let i = 0; i < chunks.length; i++) {
    const { start, end, style } = chunks[i];
    traceSmoothChunk(c, pts, start, end, style.causticOx, style.causticOy, 0);
    c.strokeStyle = `rgba(252, 182, 42, ${style.causticAlpha.toFixed(3)})`;
    c.lineWidth = style.causticWidth;
    c.stroke();
  }

  // Pass 1c: Warm translucent settling meniscus cushion beneath widening honey.
  for (let i = 0; i < chunks.length; i++) {
    const { start, end, style } = chunks[i];
    traceSmoothChunk(c, pts, start, end, style.skirtOx, style.skirtOy, 0);
    c.strokeStyle = `rgba(174, 86, 12, ${style.skirtAlpha.toFixed(3)})`;
    c.lineWidth = style.skirtWidth;
    c.stroke();
  }

  // Rounded leading drop cap only if oldest end is still visible on-stage.
  const first = pts[0];
  if (first.x <= w + 16 && chunks.length) {
    const s0 = chunks[0].style;
    c.fillStyle = `rgba(194, 102, 12, ${s0.bodyAlpha.toFixed(3)})`;
    c.beginPath();
    c.arc(first.x, first.y, s0.bodyWidth * 0.5, 0, Math.PI * 2);
    c.fill();
  }

  // Pass 2: Chronological overlapping translucent liquid honey rope with C1 midpoint joins.
  for (let i = 0; i < chunks.length; i++) {
    const { start, end, style } = chunks[i];

    // Centered soft overlap warmth (zero directional dark notch at chunk boundaries).
    traceSmoothChunk(c, pts, start, end, 0, 0, 0);
    c.strokeStyle = `rgba(116, 48, 7, ${style.aoAlpha.toFixed(3)})`;
    c.lineWidth = style.aoWidth;
    c.stroke();

    // Warmer softened chestnut-amber rim (reads liquid rather than dark metallic wire).
    traceSmoothChunk(c, pts, start, end, 0, 0, 0);
    c.strokeStyle = `rgba(136, 58, 9, ${style.rimAlpha.toFixed(3)})`;
    c.lineWidth = style.rimWidth;
    c.stroke();

    // Rich translucent amber body (0.4px tangent closure eliminates AA hairlines cleanly).
    traceSmoothChunk(c, pts, start, end, 0, 0, 0.4);
    c.strokeStyle = `rgba(194, 102, 12, ${style.bodyAlpha.toFixed(3)})`;
    c.lineWidth = style.bodyWidth;
    c.stroke();

    // Sunlit subsurface honey glow with exact directional join backfill.
    traceSmoothChunk(
      c,
      pts,
      start,
      end,
      style.coreOx,
      style.coreOy,
      highlightBackfill(pts, start, style.coreOx, style.coreOy, 0.45)
    );
    c.strokeStyle = `rgba(236, 158, 22, ${style.coreAlpha.toFixed(3)})`;
    c.lineWidth = style.coreWidth;
    c.stroke();

    // Broadened golden crown sheen.
    traceSmoothChunk(
      c,
      pts,
      start,
      end,
      style.crownOx,
      style.crownOy,
      highlightBackfill(pts, start, style.crownOx, style.crownOy, 0.45)
    );
    c.strokeStyle = `rgba(255, 212, 92, ${style.crownAlpha.toFixed(3)})`;
    c.lineWidth = style.crownWidth;
    c.stroke();

    // Age-softened liquid specular highlight (tight when fresh, wider & gentler as honey slumps).
    traceSmoothChunk(
      c,
      pts,
      start,
      end,
      style.specOx,
      style.specOy,
      highlightBackfill(pts, start, style.specOx, style.specOy, 0.45)
    );
    c.strokeStyle = `rgba(255, 248, 212, ${style.specAlpha.toFixed(3)})`;
    c.lineWidth = style.specWidth;
    c.stroke();
  }
}

function fillTaperedRibbon(c, spine, widthScale, extraRadius, ox, oy, fillStyle, oxWidthScale = 0) {
  const n = spine.length;
  if (n < 2) return;
  const leftX = new Array(n);
  const leftY = new Array(n);
  const rightX = new Array(n);
  const rightY = new Array(n);

  for (let i = 0; i < n; i++) {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    const hw = Math.max(0.35, spine[i].w * 0.5 * widthScale + extraRadius);
    const cx = spine[i].x + ox + spine[i].w * oxWidthScale;
    const cy = spine[i].y + oy;
    leftX[i] = cx + nx * hw;
    leftY[i] = cy + ny * hw;
    rightX[i] = cx - nx * hw;
    rightY[i] = cy - ny * hw;
  }

  c.beginPath();
  c.moveTo(leftX[0], leftY[0]);
  for (let i = 1; i < n; i++) c.lineTo(leftX[i], leftY[i]);
  for (let i = n - 1; i >= 0; i--) c.lineTo(rightX[i], rightY[i]);
  c.closePath();
  c.fillStyle = fillStyle;
  c.fill();
}

export function drawSuspendedFilament(c, model, w, h, geom, ex, ey, baseThickness, beltY) {
  const { tipX: nx, tipY: ny, angle } = geom;
  const profile = model.filamentProfile();
  const tension = profile.tension;
  const endR = model.points.at(-1)?.r ?? 1;

  // Projected shadow of hanging filament across the belt deck.
  const shadowAnchorX = nx + 14;
  const shadowAnchorY = beltY(model.nozzleY, h) + 5;
  c.save();
  c.beginPath();
  c.moveTo(shadowAnchorX, shadowAnchorY);
  c.quadraticCurveTo(
    (shadowAnchorX + ex) * 0.5 + profile.whip * 14,
    (shadowAnchorY + ey) * 0.5 + 8,
    ex + 2,
    ey + 5
  );
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(78, 32, 6, 0.15)';
  c.lineWidth = Math.max(3, baseThickness * profile.waist * 1.15);
  c.stroke();
  c.restore();

  // Transition from graceful viscous catenary to taut stretched ribbon.
  const slack = 1 - tension * 0.78;
  const cp1x = nx - Math.sin(angle) * 26 * slack + (ex - nx) * (0.24 * tension);
  const cp1y = ny + (ey - ny) * (0.44 - tension * 0.10);
  const cp2x = ex - (ex - nx) * (0.28 * tension) - 4 * slack;
  const cp2y = ey - (ey - ny) * (0.26 - tension * 0.08);

  const samples = 22;
  const spine = [];
  const whipAmpPx = model.whipAmp * (w * 0.022 + 12) * model.whipDir;

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const inv = 1 - u;
    const bx =
      inv * inv * inv * nx +
      3 * inv * inv * u * cp1x +
      3 * inv * u * u * cp2x +
      u * u * u * ex;
    const by =
      inv * inv * inv * ny +
      3 * inv * inv * u * cp1y +
      3 * inv * u * u * cp2y +
      u * u * u * ey;

    const wave =
      Math.sin(u * Math.PI) *
      Math.sin(model.whipPhase - u * 4.4) *
      whipAmpPx;

    const exitCone = Math.exp(-u * 6.5) * 0.34;
    const footFlare = Math.exp(-(1 - u) * 7.0) * Math.max(0, endR - profile.waist) * 0.9;
    const beadDist = (u - profile.beadPos) / 0.15;
    const beadSwell = profile.bead * 0.44 * Math.exp(-beadDist * beadDist);
    const neckDip = Math.sin(u * Math.PI);
    const localR = clamp(
      1.0 * (1 - neckDip) + profile.waist * neckDip + exitCone + footFlare + beadSwell,
      0.28,
      1.6
    );

    spine.push({ x: bx + wave, y: by, w: baseThickness * localR });
  }

  // Continuous seamless tapered ribbon (eliminates segment join steps on hanging filament).
  fillTaperedRibbon(c, spine, 1.0, 2.0, 2.3, 1.8, 'rgba(78, 32, 6, 0.14)');
  fillTaperedRibbon(c, spine, 1.0, 0.65, 0, 0, 'rgba(136, 58, 9, 0.72)');
  fillTaperedRibbon(c, spine, 0.96, 0, 0, 0, 'rgba(198, 106, 12, 0.95)');
  fillTaperedRibbon(c, spine, 0.62, 0, 0, 0, 'rgba(240, 166, 26, 0.88)', -0.06);
  fillTaperedRibbon(
    c,
    spine,
    0.22,
    0,
    0,
    0,
    `rgba(255, 246, 208, ${(0.82 + tension * 0.10).toFixed(3)})`,
    -0.17
  );

  // Seamless liquid touchdown meniscus merging filament into the freshly deposited thread.
  const footRad = Math.max(3.0, baseThickness * endR * 0.58);
  const dome = c.createRadialGradient(
    ex - footRad * 0.28,
    ey - footRad * 0.30,
    footRad * 0.08,
    ex,
    ey,
    footRad * 1.15
  );
  dome.addColorStop(0, 'rgba(255, 246, 206, 0.92)');
  dome.addColorStop(0.32, 'rgba(244, 174, 34, 0.90)');
  dome.addColorStop(0.76, 'rgba(194, 102, 12, 0.78)');
  dome.addColorStop(1, 'rgba(148, 66, 10, 0)');
  c.fillStyle = dome;
  c.beginPath();
  c.arc(ex, ey, footRad * 1.12, 0, Math.PI * 2);
  c.fill();
}

export function drawNozzle(c, model, geom, { dragging = false, hovering = false } = {}) {
  const { collarH, anchorX, anchorY, len, angle } = geom;

  // Sliding machined brass carriage collar on the top gantry rail.
  const collarW = 40;
  const collarGrad = c.createLinearGradient(anchorX - collarW * 0.5, 0, anchorX + collarW * 0.5, 0);
  collarGrad.addColorStop(0, '#5a3d1f');
  collarGrad.addColorStop(0.24, '#bfa570');
  collarGrad.addColorStop(0.46, '#f3e1b6');
  collarGrad.addColorStop(0.72, '#a78649');
  collarGrad.addColorStop(1, '#5d3e1e');
  c.fillStyle = collarGrad;
  c.fillRect(anchorX - collarW * 0.5, 0, collarW, collarH);
  c.fillStyle = 'rgba(42, 24, 9, 0.35)';
  c.fillRect(anchorX - collarW * 0.5, collarH - 2, collarW, 2);

  // Subtle machined side knurl marks signaling a sliding carriage.
  for (const offset of [-14, -11, 10, 13]) {
    c.fillStyle = 'rgba(48, 28, 10, 0.28)';
    c.fillRect(anchorX + offset, 2.5, 1, collarH - 5.5);
    c.fillStyle = 'rgba(255, 240, 200, 0.24)';
    c.fillRect(anchorX + offset + 1, 2.5, 0.8, collarH - 5.5);
  }

  // Turned brass pour spout deflecting with viscous drag shear.
  c.save();
  c.translate(anchorX, anchorY);
  c.rotate(angle);

  const metal = c.createLinearGradient(-15, 0, 15, 0);
  metal.addColorStop(0, '#5f4122');
  metal.addColorStop(0.22, '#baa26e');
  metal.addColorStop(0.44, '#f5e4bc');
  metal.addColorStop(0.68, '#b08f4f');
  metal.addColorStop(1, '#684721');

  c.fillStyle = 'rgba(66, 31, 8, 0.18)';
  c.beginPath();
  c.moveTo(-14, 0);
  c.lineTo(18, 0);
  c.lineTo(12, len + 2);
  c.quadraticCurveTo(2, len + 7, -8, len + 2);
  c.closePath();
  c.fill();

  c.fillStyle = metal;
  c.beginPath();
  c.moveTo(-16, 0);
  c.lineTo(16, 0);
  c.lineTo(9.5, len);
  c.quadraticCurveTo(0, len + 4.8, -9.5, len);
  c.closePath();
  c.fill();

  // Subtle turned grip grooves on the brass body (faint tactile grab affordance even at rest).
  for (const frac of [0.44, 0.56, 0.72]) {
    const gy = len * frac;
    const halfW = lerp(15.2, 9.8, frac);
    c.strokeStyle = frac === 0.72 ? 'rgba(78, 49, 18, 0.36)' : 'rgba(78, 49, 18, 0.26)';
    c.lineWidth = 0.95;
    c.beginPath();
    c.moveTo(-halfW, gy);
    c.quadraticCurveTo(0, gy + 2.0, halfW, gy);
    c.stroke();
    if (frac !== 0.72) {
      c.strokeStyle = 'rgba(255, 242, 206, 0.26)';
      c.lineWidth = 0.75;
      c.beginPath();
      c.moveTo(-halfW + 1, gy + 1.0);
      c.quadraticCurveTo(0, gy + 2.9, halfW - 1, gy + 1.0);
      c.stroke();
    }
  }

  // Faint resting grab halo that brightens smoothly on hover and active drag.
  const haloAlpha = dragging ? 0.72 : hovering ? 0.46 : 0.18;
  const haloWidth = dragging ? 1.6 : hovering ? 1.15 : 0.85;
  c.strokeStyle = `rgba(255, 242, 206, ${haloAlpha})`;
  c.lineWidth = haloWidth;
  c.beginPath();
  c.ellipse(0, len * 0.52, 15.2, 4.9, 0, 0, Math.PI * 2);
  c.stroke();

  c.fillStyle = '#5e3c14';
  c.beginPath();
  c.ellipse(0, len, 8.6, 2.5, 0, 0, Math.PI * 2);
  c.fill();

  const beadScale = clamp(1.05 - model.tension * 0.34 + model.dwell * 0.22 + model.bead * 0.26, 0.65, 1.45);
  c.fillStyle = '#e8a422';
  c.beginPath();
  c.ellipse(0, len + 0.8, 3.6 * beadScale, 2.5 * beadScale, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff5c8';
  c.beginPath();
  c.arc(-1.1 * beadScale, len + 0.2, 1.1 * beadScale, 0, Math.PI * 2);
  c.fill();

  c.restore();
}
