// WebGL2 renderer for the water, Rev B. Optics, palette and layer design: Gemini 4 Neon (spec);
// implementation: Hermes. Particle splats (carrying foam, spray and Reynolds dye) -> edge-aware smoothed field ->
// optical composite over the drafting sheet, then laminar dye ribbons and ballistic spray droplets.
// Interface: createRenderer(canvas, { maxParticles, low }) ->
//   { ok, gl, P, resize(wCss, hCss, dpr), setSheet(canvas2d), setGrid(rgba8, nx, ny, rect, velMax),
//     draw(pData, pCount, time, rData, rVertCount), size, lost }
// pData stride 8: [x, y, vx, vy, foam, spray, dye, seed] in stage CSS px (+y down).
// setGrid: RGBA8 row-major, j = 0 at the top. R/G cell velocity (0.5 = 0), B wall SDF (0.5 = face), A |vorticity|.
// rData stride 4: [x, y, across, alpha] final strip vertices in CSS px, degenerate-stitched TRIANGLE_STRIP.

const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SPLAT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_p;      // x, y, vx, vy  (stage px, px/s, +y down)
layout(location = 2) in vec4 a_q;      // foam, spray, dye, seed
uniform vec2 u_stage;
uniform float u_radius;
uniform float u_stretch;
uniform float u_maxStretch;
uniform float u_norm;
uniform float u_dead;                  // px/s dead-band: still water neither stretches nor shimmers
out vec2 v_local;
out vec3 v_attr;
out float v_amp;
void main() {
  vec2 vel = a_p.zw;
  float sp = length(vel);
  float spe = max(sp - u_dead, 0.0);
  vec2 dir = sp > 1e-3 ? vel / sp : vec2(1.0, 0.0);
  float s = clamp(1.0 + spe * u_stretch, 1.0, u_maxStretch);
  vec2 nrm = vec2(-dir.y, dir.x);
  float spray = a_q.y;
  float rad = u_radius * mix(1.0, 0.8, spray);
  vec2 pos = a_p.xy + dir * (a_corner.x * rad * s) + nrm * (a_corner.y * rad);
  vec2 clip = pos / u_stage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_corner;
  // bulk -> spray hand-off: isolated droplets leave the bulk field and are drawn as sprites instead.
  // Thin jets (2-3 neighbours) stay in the bulk; the weaker stretch penalty (0.12) stops jets pinching.
  float bulk = 1.0 - smoothstep(0.55, 0.95, spray);
  v_amp = u_norm * mix(1.0, inversesqrt(s), 0.12) * bulk;
  v_attr = vec3(clamp(spe / 600.0, 0.0, 1.0), clamp(a_q.x + 0.22 * spray, 0.0, 1.0), a_q.z);
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_attr;
in float v_amp;
out vec4 o;
void main() {
  float r2 = dot(v_local, v_local);
  if (r2 >= 1.0) discard;
  float k = 1.0 - r2;
  float w = k * k * v_amp;
  o = vec4(w, w * v_attr.x, w * v_attr.y, w * v_attr.z);   // density, speed, foam, dye
}`;

// Separable 9-tap blur, edge-aware on the density channel so thin jets survive.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
uniform float u_edge;
out vec4 o;
void main() {
  const float W0 = 0.2270270, W1 = 0.1945946, W2 = 0.1216216, W3 = 0.0540540, W4 = 0.0162162;
  vec4 c = texture(u_tex, v_uv);
  vec4 acc = c * W0;
  float ws = W0;
  float cr = min(c.r, 0.75);
  for (int i = 1; i <= 4; i++) {
    float wi = i == 1 ? W1 : i == 2 ? W2 : i == 3 ? W3 : W4;
    vec4 a = texture(u_tex, v_uv + u_dir * float(i));
    vec4 b = texture(u_tex, v_uv - u_dir * float(i));
    float ar = min(a.r, 0.75), br = min(b.r, 0.75);
    float bridge = step(0.06, c.r) * smoothstep(0.08, 0.35, min(ar, br) - cr);
    float e = u_edge * (1.0 - 0.92 * bridge);
    float ea = wi * exp(-abs(ar - cr) * e);
    float eb = wi * exp(-abs(br - cr) * e);
    acc += a * ea + b * eb;
    ws += ea + eb;
  }
  o = acc / ws;
}`;

// 4-tap box downsample of the water mask (thickness proxy source).
const DOWN_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_thresh;
out vec4 o;
void main() {
  float m = 0.0;
  m += smoothstep(u_thresh * 0.7, u_thresh * 1.3, texture(u_tex, v_uv + u_texel * vec2(-0.5, -0.5)).r);
  m += smoothstep(u_thresh * 0.7, u_thresh * 1.3, texture(u_tex, v_uv + u_texel * vec2( 0.5, -0.5)).r);
  m += smoothstep(u_thresh * 0.7, u_thresh * 1.3, texture(u_tex, v_uv + u_texel * vec2(-0.5,  0.5)).r);
  m += smoothstep(u_thresh * 0.7, u_thresh * 1.3, texture(u_tex, v_uv + u_texel * vec2( 0.5,  0.5)).r);
  o = vec4(m * 0.25, 0.0, 0.0, 1.0);
}`;

// Laminar dye filaments: anti-aliased strips into an R8 coverage target (MAX blend).
const RIBBON_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_r;      // x, y (stage px), across (-1..1), alpha
uniform vec2 u_stage;
out float v_across;
out float v_alpha;
void main() {
  vec2 clip = a_r.xy / u_stage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_across = a_r.z;
  v_alpha = a_r.w;
}`;
const RIBBON_FS = `#version 300 es
precision highp float;
in float v_across;
in float v_alpha;
uniform float u_aa;
out vec4 o;
void main() {
  float cov = 1.0 - smoothstep(1.0 - u_aa, 1.0, abs(v_across));
  o = vec4(cov * v_alpha, 0.0, 0.0, 1.0);
}`;

// Ballistic spray: airborne droplets as velocity-stretched optical teardrops over the composite.
const SPRAY_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_p;
layout(location = 2) in vec4 a_q;      // foam, spray, dye, seed
uniform vec2 u_stage;
uniform float u_dead;
uniform float u_scale;                 // droplet size multiplier
out vec2 v_local;
out float v_alpha;
out float v_dye;
void main() {
  float act = smoothstep(0.55, 0.95, a_q.y);
  v_local = a_corner; v_alpha = act; v_dye = a_q.z;
  if (act < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }    // not spray: culled
  vec2 vel = a_p.zw;
  float sp = length(vel);
  vec2 dir = sp > 1e-3 ? vel / sp : vec2(0.0, 1.0);
  float r = mix(1.3, 2.9, a_q.w) * u_scale;                             // per-particle seed
  float s = clamp(1.0 + max(sp - u_dead, 0.0) / 320.0, 1.0, 3.4);
  float hl = min(r * s, 5.5);                                           // streak <= 11 px
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = a_p.xy + dir * (a_corner.x * hl) + nrm * (a_corner.y * r);
  vec2 clip = pos / u_stage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;
const SPRAY_FS = `#version 300 es
precision highp float;
in vec2 v_local;
in float v_alpha;
in float v_dye;
uniform vec3 u_dyeSigma;
out vec4 o;
void main() {
  float r = length(v_local);
  if (r >= 1.0) discard;
  float edge = 1.0 - smoothstep(0.7, 1.0, r);                               // ~0.75 px AA
  vec3 core = vec3(0.549, 0.796, 0.851);                                    // #8CCBD9
  vec3 rim = vec3(0.365, 0.616, 0.690);                                     // #5D9DB0
  vec3 col = mix(core, rim, smoothstep(0.5, 1.0, r) * 0.55);
  col *= exp(-u_dyeSigma * v_dye * 0.45);                                   // dyed spray carries a little ink
  float spec = 1.0 - smoothstep(0.0, 0.3, length(v_local - vec2(-0.32, -0.30)));
  col = mix(col, vec3(1.0), spec * 0.9);                                    // pinpoint glint
  o = vec4(col, edge * v_alpha * 0.55);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sheet;
uniform sampler2D u_field;
uniform sampler2D u_thick;
uniform sampler2D u_grid;
uniform sampler2D u_streak;
uniform int u_hasGrid;
uniform int u_hasStreak;
uniform vec4 u_gridRect;     // css px: x0, y0, w, h
uniform vec2 u_stagePx;      // css px
uniform float u_velMax;      // css px/s
uniform vec2 u_texField;     // 1 / field size
uniform vec2 u_res;          // GL px
uniform float u_time;
uniform float u_thresh;      // density iso-level of the free surface
uniform float u_refract;     // refraction strength (uv units per unit slope)
uniform float u_slope;       // height-proxy slope gain -> how rounded edges look
uniform vec3 u_sigma;        // Beer-Lambert absorption per unit thickness (r,g,b)
uniform float u_depth;       // thickness gain
uniform vec2 u_shadowOff;    // uv offset of the soft contact shadow
uniform float u_caustic;     // caustic strength
uniform vec3 u_dyeSigma;     // Prussian drafting ink absorption at dye = 1
uniform float u_dyeGain;
uniform float u_foamScale;
uniform int u_debug;
out vec4 o;

// Saturates well below resting bulk (~1.0): flat glass inside, curved meniscus only at free surfaces.
float hz(float d) { return smoothstep(u_thresh * 0.82, u_thresh * 1.55, d); }

// Rotated two-octave warped wave interference: soft optical ribbons, no rectangular mosaic.
float caustic(vec2 p, float t) {
  const mat2 R = mat2(0.80, -0.60, 0.60, 0.80);
  vec2 q = p + 0.42 * vec2(sin(p.y * 1.35 + t * 0.70), cos(p.x * 1.25 - t * 0.55));
  float w1 = abs(sin(q.x * 1.65 + sin(q.y * 1.45 - t * 0.48)));
  q = R * (q * 1.32) + vec2(0.26 * t, -0.20 * t);
  float w2 = abs(sin(q.x * 1.75 + cos(q.y * 1.55 + t * 0.60)));
  return pow(1.0 - clamp(0.55 * w1 + 0.45 * w2, 0.0, 1.0), 4.2);
}

//__WHITEWATER__

void main() {
  vec2 uv = v_uv;
  vec2 px = vec2(uv.x * u_stagePx.x, (1.0 - uv.y) * u_stagePx.y);           // stage css px, y down
  vec4 Gd = vec4(0.5, 0.5, 1.0, 0.0);
  if (u_hasGrid == 1) Gd = texture(u_grid, (px - u_gridRect.xy) / u_gridRect.zw);
  float wall = Gd.b;                                                       // 0.5 = solid face
  float wallNear = 1.0 - smoothstep(0.5, 0.8, wall);                       // 1 at a face, 0 beyond ~1.2 cells
  float solidClip = smoothstep(0.46, 0.53, wall);

  vec4 F = texture(u_field, uv);
  float D = F.r;
  float fw = max(fwidth(D), 1e-4);
  float a = smoothstep(u_thresh - fw * 0.85, u_thresh + fw * 0.85, D) * solidClip;   // no water inside solids

  vec3 paper = texture(u_sheet, uv).rgb;
  float sh = smoothstep(u_thresh * 0.45, u_thresh * 1.45, texture(u_field, uv + u_shadowOff).r);
  sh *= smoothstep(0.5, 0.65, wall);                                       // no shadow against walls
  vec3 outside = mix(paper, paper * vec3(0.906, 0.941, 0.949), 0.42 * sh);  // #E7F0F2 tint, max 0.42

  if (a <= 0.001 && u_debug == 0) { o = vec4(outside, 1.0); return; }

  float minRes = min(u_res.x, u_res.y);
  vec2 aspect = u_res / minRes;
  vec2 stageUV = uv * aspect;
  vec2 invAspect = 1.0 / aspect;

  // meniscus normal: curved only at free surfaces, flattened along solid walls
  vec2 e = max(u_texField, 0.0028 * invAspect);
  float hl = hz(texture(u_field, uv - vec2(e.x, 0.0)).r);
  float hr = hz(texture(u_field, uv + vec2(e.x, 0.0)).r);
  float hd = hz(texture(u_field, uv - vec2(0.0, e.y)).r);
  float hu = hz(texture(u_field, uv + vec2(0.0, e.y)).r);
  vec2 gEdge = vec2(hr - hl, hu - hd) * (u_slope * 0.28) * (1.0 - 0.9 * wallNear);
  vec3 n = normalize(vec3(-gEdge, 1.0));
  float hzC = hz(D);
  float edgeSlope = clamp(1.0 - n.z, 0.0, 1.0);

  vec2 te = 0.014 * invAspect;
  float tl = texture(u_thick, uv - vec2(te.x, 0.0)).r;
  float tr = texture(u_thick, uv + vec2(te.x, 0.0)).r;
  float td = texture(u_thick, uv - vec2(0.0, te.y)).r;
  float tu = texture(u_thick, uv + vec2(0.0, te.y)).r;
  float thick = 0.25 * (tl + tr + td + tu);
  vec2 gBulk = vec2(tr - tl, tu - td);
  float T = clamp(thick, 0.0, 1.0) * u_depth;

  float invD = 1.0 / max(D, 1e-3);
  float spd = clamp(F.g * invD, 0.0, 1.0);                                 // dead-banded in the splat

  vec2 flowWave = vec2(sin(stageUV.y * 42.0 - u_time * 3.2), cos(stageUV.x * 38.0 + u_time * 2.7)) * (0.0008 * spd);
  vec2 off = (-n.xy * 0.65 + gBulk * 0.45) * u_refract + flowWave;
  vec3 bg;
#ifdef LOW
  bg = texture(u_sheet, uv + off).rgb;
#else
  vec2 cs = -n.xy * (u_refract * 0.08 * edgeSlope);
  bg = vec3(texture(u_sheet, uv + off + cs).r, texture(u_sheet, uv + off).g, texture(u_sheet, uv + off - cs).b);
#endif

  // Beer-Lambert: a soft rim path instead of the old dark cartoon outline
  float rimFade = 1.0 - 0.9 * wallNear;
  float rimPath = pow(edgeSlope, 1.8) * 0.45 * (1.0 - smoothstep(0.70, 0.99, hzC)) * rimFade;
  vec3 trans = exp(-u_sigma * (T * 0.95 + 0.09 + rimPath));
  vec3 col = bg * trans;

  // Reynolds dye: particle-carried ink plus the laminar filaments, subtractive Prussian drafting ink
  float dyeP = clamp(F.a * invD, 0.0, 1.0);
  float streak = u_hasStreak == 1 ? texture(u_streak, uv).r : 0.0;
  float dye = clamp(max(dyeP, streak) * u_dyeGain, 0.0, 1.0);
  col *= exp(-u_dyeSigma * dye);

  // live caustics across the bulk (no longer extinguished in deep water), stronger where water moves
  float ca = caustic(stageUV * 9.5 + n.xy * 0.45, u_time * 0.95);
  float caDepth = smoothstep(0.06, 0.25, thick) * mix(1.0, 0.45, smoothstep(0.6, 1.6, T));
  float caMotion = 0.35 + 0.65 * smoothstep(0.02, 0.35, spd);
  col *= 1.0 + (ca - 0.14) * 0.42 * caDepth * caMotion * (u_caustic / 0.55) * (1.0 - 0.6 * dye);

  // studio optics: thin translucent TIR rim (max 0.18), sky-facing Fresnel, back-scatter, pinpoint glint
  float tir = pow(edgeSlope, 2.2) * (1.0 - smoothstep(0.65, 0.98, hzC)) * rimFade;
  col *= mix(vec3(1.0), vec3(0.310, 0.541, 0.620), clamp(tir * 1.65, 0.0, 0.18));
  float fres = 0.02 + 0.98 * pow(edgeSlope, 3.2);
  float sky = smoothstep(-0.10, 0.75, n.y);
  col = mix(col, vec3(0.957, 0.984, 1.0), clamp(fres * sky * 0.55, 0.0, 0.52) * rimFade);
  col = mix(col, vec3(0.902, 0.969, 0.988), 0.28 * smoothstep(0.05, 0.4, edgeSlope) * (1.0 - hzC) * rimFade);
  vec3 L = normalize(vec3(-0.42, 0.72, 0.55));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 180.0);
  col += vec3(1.0, 0.992, 0.976) * spec * smoothstep(0.01, 0.08, edgeSlope) * 0.85 * rimFade;

  // whitewater: flow-advected aeration milk, torn lace, micro-bubbles
  float foam = clamp(F.b * invD * u_foamScale, 0.0, 1.0);
  float foamAmt = 0.0;
  if (foam > 0.06) {
    vec2 flow = (Gd.rg * 2.0 - 1.0) * u_velMax;
    vec4 ww = whitewater(px, flow, Gd.a, foam, n, u_time);
    foamAmt = ww.a;
    col = mix(col, ww.rgb * mix(vec3(1.0), exp(-u_dyeSigma * dye * 0.6), 0.8), ww.a);
  }

  vec3 outc = mix(outside, col, a);
  if (u_debug == 1) outc = vec3(D / (u_thresh * 3.0));
  else if (u_debug == 2) outc = n * 0.5 + 0.5;
  else if (u_debug == 3) outc = vec3(T);
  else if (u_debug == 4) outc = vec3(foamAmt);
  else if (u_debug == 5) outc = vec3(1.0 - dye);
  else if (u_debug == 6) outc = vec3(wall);
  else if (u_debug == 7) outc = vec3(Gd.rg, Gd.a);
  o = vec4(outc, 1.0);
}`;

// Whitewater to Neon's layer spec: aeration milk (#D8EEF4, max 36 %), torn lacy fBm web (22 / 9.5 px,
// sheared along the flow, #F9FBFD crests to #CFE2EC troughs), sparse jittered micro-bubbles with a glint.
// Flow-mapped on a 1.6 s two-phase cycle so the pattern travels with the water instead of a fixed stencil.
const WHITEWATER = `
float ww_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ww_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ww_hash(i), ww_hash(i + vec2(1.0, 0.0)), u.x), mix(ww_hash(i + vec2(0.0, 1.0)), ww_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ww_lace(vec2 q, vec2 dir) {
  vec2 a = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
  a.x *= 0.62;
  float n1 = ww_noise(a / 22.0);
#ifdef LOW
  float n = n1;
#else
  float n = n1 * 0.62 + ww_noise(a / 9.5 + 17.3) * 0.38;
#endif
  return smoothstep(0.50, 0.66, n) * (1.0 - smoothstep(0.78, 0.92, n));
}
float ww_bubbles(vec2 q, float scale, float seed, out float glint) {
  vec2 g = q / scale, id = floor(g), f = fract(g) - 0.5;
  float keep = step(0.45, ww_hash(id + seed));
  vec2 j = (vec2(ww_hash(id + seed + 3.1), ww_hash(id + seed + 7.7)) - 0.5) * 0.84;
  float r = mix(1.2, 3.0, ww_hash(id + seed + 11.3)) / scale;
  vec2 d = f - j;
  float dist = length(d);
  float ring = smoothstep(r - 0.9 / scale, r - 0.25 / scale, dist) * (1.0 - smoothstep(r - 0.25 / scale, r + 0.35 / scale, dist));
  glint = keep * (1.0 - smoothstep(0.0, 0.45 * r, length(d - vec2(-0.38, -0.38) * r)));
  return keep * ring;
}
vec4 whitewater(vec2 px, vec2 flow, float vort, float foam, vec3 n, float t) {
  float sp = length(flow);
  vec2 dir = sp > 1e-3 ? flow / sp : vec2(0.0, 1.0);
  vec2 adv = dir * min(sp / 2500.0, 1.0) * 22.0;
  float ph1 = fract(t / 1.6), ph2 = fract(t / 1.6 + 0.5);
  float w1 = 1.0 - abs(2.0 * ph1 - 1.0);
  vec2 q1 = px - adv * ph1, q2 = px - adv * ph2 + 37.0;
  float milk = smoothstep(0.06, 0.55, foam) * 0.36;
  float lace = mix(ww_lace(q2, dir), ww_lace(q1, dir), w1) * smoothstep(0.15, 0.85, foam);
  float g1, g2 = 0.0;
  vec2 qb = mix(q2, q1, w1);
  float b = ww_bubbles(qb, 9.0, 1.0, g1);
#ifndef LOW
  b = max(b, ww_bubbles(mat2(0.8, -0.6, 0.6, 0.8) * qb, 6.5, 4.0, g2));
#endif
  b *= smoothstep(0.25, 0.95, foam);
  float glint = max(g1, g2) * smoothstep(0.25, 0.95, foam);
  vec3 crest = vec3(0.976, 0.984, 0.992), trough = vec3(0.812, 0.886, 0.925), milkC = vec3(0.847, 0.933, 0.957);
  vec3 laceC = mix(trough, crest, clamp(0.5 + 0.5 * n.y + 0.3 * lace, 0.0, 1.0));
  vec3 c = mix(milkC, laceC, clamp(lace * 1.4, 0.0, 1.0));
  c = mix(c, vec3(1.0), clamp(b * 0.6 + glint, 0.0, 1.0));
  float cov = min(0.90, milk + lace * 0.72 + b * 0.5 + glint * 0.4);
  return vec4(c, cov);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('shader: ' + log);
  }
  return s;
}
function program(gl, vs, fs, defines = '') {
  const p = gl.createProgram();
  const fsrc = defines ? fs.replace('#version 300 es', '#version 300 es\n' + defines) : fs;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export function createRenderer(canvas, { maxParticles = 12000, low = false, whitewater = WHITEWATER } = {}) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return { ok: false, reason: 'no-webgl2' };
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return { ok: false, reason: 'no-float-rt' };

  let progs;
  try {
    const defs = low ? '#define LOW 1' : '';
    progs = {
      splat: program(gl, SPLAT_VS, SPLAT_FS),
      blur: program(gl, FULLSCREEN_VS, BLUR_FS),
      down: program(gl, FULLSCREEN_VS, DOWN_FS),
      comp: program(gl, FULLSCREEN_VS, COMPOSITE_FS.replace('//__WHITEWATER__', whitewater), defs),
      ribbon: program(gl, RIBBON_VS, RIBBON_FS),
      spray: program(gl, SPRAY_VS, SPRAY_FS),
    };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }

  const emptyVao = gl.createVertexArray();
  // instanced quad shared by the splat and spray passes
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, maxParticles * 8 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);
  // ribbon strip
  const rvao = gl.createVertexArray();
  gl.bindVertexArray(rvao);
  const rbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
  gl.bufferData(gl.ARRAY_BUFFER, 4096 * 4 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  gl.bindVertexArray(null);

  function texParams(filter) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function makeTarget(w, h, kind = 'rgba16f') {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (kind === 'r8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    texParams(gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h, ok };
  }
  function freeTarget(t) { if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }

  const sheetTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sheetTex);
  texParams(gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([251, 248, 243, 255]));
  const gridTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, gridTex);
  texParams(gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 255, 0]));
  let gridW = 1, gridH = 1, hasGrid = false, gridRect = [0, 0, 1, 1], velMax = 1;

  const P = {
    thresh: 0.42, norm: 0.19, refract: 0.012, slope: 9.0, sigma: [0.58, 0.21, 0.12], depth: 1.0,
    shadow: [1.5, 2.5], caustic: 0.55, radiusPx: 9, stretch: 0.0022, maxStretch: 3.8, dead: 120, debug: 0,
    fieldScale: 0.5, thickScale: 0.125, edge: 2.0,
    dyeSigma: [1.70, 1.12, 0.59], dyeGain: 1.0, sprayScale: 0.75, foamScale: 1.0, ribbonAA: 0.42,
  };
  let W = 1, H = 1, cssW = 1, cssH = 1, dpr = 1;
  let A = null, B = null, S1 = null, S2 = null, RB = null;

  function resize(wCss, hCss, dprGL) {
    cssW = wCss; cssH = hCss; dpr = dprGL;
    W = Math.max(2, Math.round(wCss * dprGL)); H = Math.max(2, Math.round(hCss * dprGL));
    canvas.width = W; canvas.height = H;
    [A, B, S1, S2, RB].forEach(freeTarget);
    const fw = Math.max(2, Math.round(W * P.fieldScale)), fh = Math.max(2, Math.round(H * P.fieldScale));
    const sw = Math.max(2, Math.round(W * P.thickScale)), shh = Math.max(2, Math.round(H * P.thickScale));
    A = makeTarget(fw, fh); B = makeTarget(fw, fh);
    S1 = makeTarget(sw, shh); S2 = makeTarget(sw, shh);
    RB = makeTarget(W, H, 'r8');                                  // filament coverage at full resolution
    streakDirty = true;
    return A.ok && B.ok && S1.ok && S2.ok && RB.ok;
  }

  function setSheet(source) {
    gl.bindTexture(gl.TEXTURE_2D, sheetTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  function setGrid(data, nx, ny, rect, vMax) {
    gl.bindTexture(gl.TEXTURE_2D, gridTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (nx !== gridW || ny !== gridH) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, nx, ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); gridW = nx; gridH = ny; }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nx, ny, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gridRect = rect; velMax = vMax; hasGrid = true;
  }

  function fullscreen(prog, target, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function blurPass(src, dst, dx, dy, edge) {
    const pr = progs.blur;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(pr.u.u_tex, 0);
    gl.uniform2f(pr.u.u_dir, dx / src.w, dy / src.h);
    gl.uniform1f(pr.u.u_edge, edge);
    fullscreen(pr, dst, dst.w, dst.h);
  }

  let streakDirty = true;
  function draw(data, count, time, rData, rCount = 0) {
    // 1) splat
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
    gl.viewport(0, 0, A.w, A.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 8);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const pr = progs.splat;
      gl.useProgram(pr.p);
      gl.uniform2f(pr.u.u_stage, cssW, cssH);
      gl.uniform1f(pr.u.u_radius, P.radiusPx);
      gl.uniform1f(pr.u.u_stretch, P.stretch);
      gl.uniform1f(pr.u.u_maxStretch, P.maxStretch);
      gl.uniform1f(pr.u.u_norm, P.norm);
      gl.uniform1f(pr.u.u_dead, P.dead);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.disable(gl.BLEND);
    }
    // 2) smooth A -> B -> A
    const stride = Math.min(1.8, Math.max(1.0, dpr * 0.8));
    blurPass(A, B, stride, 0, P.edge);
    blurPass(B, A, 0, stride, P.edge);
    // 3) thickness: A -> S1 (down) -> blur S2 -> S1
    {
      const pr = progs.down;
      gl.useProgram(pr.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.uniform1i(pr.u.u_tex, 0);
      gl.uniform2f(pr.u.u_texel, 1 / S1.w, 1 / S1.h);
      gl.uniform1f(pr.u.u_thresh, P.thresh);
      fullscreen(pr, S1, S1.w, S1.h);
      blurPass(S1, S2, 1.6, 0, 0.0);
      blurPass(S2, S1, 0, 1.6, 0.0);
      blurPass(S1, S2, 1.6, 0, 0.0);
      blurPass(S2, S1, 0, 1.6, 0.0);
    }
    // 4) laminar dye filaments -> R8 coverage
    const hasStreak = !!(rCount > 2 && rData);
    if (hasStreak || streakDirty) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, RB.fb);
      gl.viewport(0, 0, RB.w, RB.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      streakDirty = false;
      if (hasStreak) {
        const n = Math.min(rCount, 4096);
        gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, rData, 0, n * 4);
        const pr = progs.ribbon;
        gl.useProgram(pr.p);
        gl.uniform2f(pr.u.u_stage, cssW, cssH);
        gl.uniform1f(pr.u.u_aa, P.ribbonAA);
        gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(rvao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, n);
        gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);
        streakDirty = true;                                       // clear next frame even if no ribbons come
      }
    }
    // 5) composite
    const pr = progs.comp;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sheetTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, S1.tex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, gridTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, RB.tex);
    gl.uniform1i(pr.u.u_sheet, 0); gl.uniform1i(pr.u.u_field, 1); gl.uniform1i(pr.u.u_thick, 2);
    gl.uniform1i(pr.u.u_grid, 3); gl.uniform1i(pr.u.u_streak, 4);
    gl.uniform1i(pr.u.u_hasGrid, hasGrid ? 1 : 0); gl.uniform1i(pr.u.u_hasStreak, hasStreak ? 1 : 0);
    gl.uniform4f(pr.u.u_gridRect, gridRect[0], gridRect[1], gridRect[2], gridRect[3]);
    gl.uniform2f(pr.u.u_stagePx, cssW, cssH);
    gl.uniform1f(pr.u.u_velMax, velMax);
    gl.uniform2f(pr.u.u_texField, 1 / A.w, 1 / A.h);
    gl.uniform2f(pr.u.u_res, W, H);
    gl.uniform1f(pr.u.u_time, time);
    gl.uniform1f(pr.u.u_thresh, P.thresh);
    gl.uniform1f(pr.u.u_refract, P.refract);
    gl.uniform1f(pr.u.u_slope, P.slope);
    gl.uniform3f(pr.u.u_sigma, P.sigma[0], P.sigma[1], P.sigma[2]);
    gl.uniform1f(pr.u.u_depth, P.depth);
    gl.uniform2f(pr.u.u_shadowOff, -P.shadow[0] / cssW, P.shadow[1] / cssH);
    gl.uniform1f(pr.u.u_caustic, P.caustic);
    gl.uniform3f(pr.u.u_dyeSigma, P.dyeSigma[0], P.dyeSigma[1], P.dyeSigma[2]);
    gl.uniform1f(pr.u.u_dyeGain, P.dyeGain);
    gl.uniform1f(pr.u.u_foamScale, P.foamScale);
    gl.uniform1i(pr.u.u_debug, P.debug);
    fullscreen(pr, null, W, H);
    // 6) ballistic spray droplets over the composite
    if (count > 0 && P.sprayScale > 0) {
      const sp = progs.spray;
      gl.useProgram(sp.p);
      gl.uniform2f(sp.u.u_stage, cssW, cssH);
      gl.uniform1f(sp.u.u_dead, P.dead);
      gl.uniform1f(sp.u.u_scale, P.sprayScale);
      gl.uniform3f(sp.u.u_dyeSigma, P.dyeSigma[0], P.dyeSigma[1], P.dyeSigma[2]);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.disable(gl.BLEND);
    }
  }

  return {
    ok: true, gl, P,
    resize, setSheet, setGrid, draw,
    get size() { return { W, H }; },
    lost: () => gl.isContextLost(),
  };
}
