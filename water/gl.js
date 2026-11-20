// WebGL2 renderer for the water: particle splats -> smoothed field -> optical composite over the drafting sheet.
// Interface: createRenderer(canvas) -> { ok, resize, setSheet, draw, setParam, lose }

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
layout(location = 2) in vec2 a_q;      // foam 0..1, spray 0..1
uniform vec2 u_stage;
uniform float u_radius;
uniform float u_stretch;
uniform float u_maxStretch;
uniform float u_norm;
out vec2 v_local;
out vec3 v_attr;
out float v_amp;
void main() {
  vec2 vel = a_p.zw;
  float sp = length(vel);
  vec2 dir = sp > 1e-3 ? vel / sp : vec2(1.0, 0.0);
  float s = clamp(1.0 + sp * u_stretch, 1.0, u_maxStretch);
  vec2 nrm = vec2(-dir.y, dir.x);
  float rad = u_radius * mix(1.0, 0.8, a_q.y);
  vec2 pos = a_p.xy + dir * (a_corner.x * rad * s) + nrm * (a_corner.y * rad);
  vec2 clip = pos / u_stage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_corner;
  v_amp = u_norm * mix(1.0, inversesqrt(s), 0.3);
  v_attr = vec3(clamp(sp / 600.0, 0.0, 1.0), a_q.x, a_q.y);
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
  o = vec4(w, w * v_attr.x, w * v_attr.y, w * v_attr.z);
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

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sheet;
uniform sampler2D u_field;
uniform sampler2D u_thick;
uniform vec2 u_texField;     // 1 / field size
uniform vec2 u_res;          // GL px
uniform float u_time;
uniform float u_thresh;      // density iso-level of the free surface
uniform float u_refract;     // refraction strength (uv units per unit slope)
uniform float u_slope;       // height-proxy slope gain -> how rounded edges look
uniform vec3 u_sigma;        // Beer-Lambert absorption per unit thickness (r,g,b)
uniform float u_depth;       // thickness gain
uniform vec2 u_shadowOff;    // uv offset of the soft drop shadow
uniform float u_caustic;     // caustic brightness
uniform int u_debug;
out vec4 o;

// Saturates well below resting bulk (~1.0): flat glass inside, curved meniscus only at free surfaces.
float hz(float d) { return smoothstep(u_thresh * 0.82, u_thresh * 1.55, d); }

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Seamless 2x2 cellular distance (max jitter 0.22 < 0.25 guarantees exact F1 in 4 taps).
float cellDist(vec2 p, float t) {
  vec2 b = floor(p - 0.5);
  float md = 2.0;
  for (int y = 0; y <= 1; y++) {
    for (int x = 0; x <= 1; x++) {
      vec2 c = b + vec2(float(x), float(y));
      vec2 h = hash22(c);
      vec2 pt = c + 0.5 + 0.22 * sin(h * 6.28318 + t * (1.1 + h.y * 0.9));
      vec2 d = pt - p;
      md = min(md, dot(d, d));
    }
  }
  return sqrt(md);
}

// Rotated two-octave warped wave interference: soft optical ribbons, no rectangular mosaic.
float caustic(vec2 p, float t) {
  const mat2 R = mat2(0.80, -0.60, 0.60, 0.80);
  vec2 q = p + 0.42 * vec2(sin(p.y * 1.35 + t * 0.70), cos(p.x * 1.25 - t * 0.55));
  float w1 = abs(sin(q.x * 1.65 + sin(q.y * 1.45 - t * 0.48)));
  q = R * (q * 1.32) + vec2(0.26 * t, -0.20 * t);
  float w2 = abs(sin(q.x * 1.75 + cos(q.y * 1.55 + t * 0.60)));
  return pow(1.0 - clamp(0.55 * w1 + 0.45 * w2, 0.0, 1.0), 4.2);
}

void main() {
  vec2 uv = v_uv;
  vec4 F = texture(u_field, uv);                                           // fetch 1
  float D = F.r;
  float fw = max(fwidth(D), 1e-4);
  float a = smoothstep(u_thresh - fw * 0.85, u_thresh + fw * 0.85, D);

  vec3 paper = texture(u_sheet, uv).rgb;                                   // fetch 2
  // Subtle cool-tinted transmissive contact shadow on warm paper
  float sh = smoothstep(u_thresh * 0.45, u_thresh * 1.45,
                        texture(u_field, uv + u_shadowOff).r);             // fetch 3
  vec3 outside = paper * mix(vec3(1.0), vec3(0.915, 0.955, 0.972), 0.75 * sh);

  // Safe early-out on dry paper (fwidth already computed; samplers have no mipmaps)
  if (a <= 0.001 && u_debug == 0) {
    o = vec4(outside, 1.0);
    return;
  }

  // DPR-independent, stage-proportional coordinates (0..1 across shorter dimension)
  float minRes = min(u_res.x, u_res.y);
  vec2 aspect = u_res / minRes;
  vec2 stageUV = uv * aspect;
  vec2 invAspect = 1.0 / aspect;

  // Meniscus normal from saturated hz(D) at a DPR-stable UV step (fetches 4..7)
  vec2 e = max(u_texField, 0.0028 * invAspect);
  float hl = hz(texture(u_field, uv - vec2(e.x, 0.0)).r);
  float hr = hz(texture(u_field, uv + vec2(e.x, 0.0)).r);
  float hd = hz(texture(u_field, uv - vec2(0.0, e.y)).r);
  float hu = hz(texture(u_field, uv + vec2(0.0, e.y)).r);
  vec2 gEdge = vec2(hr - hl, hu - hd) * (u_slope * 0.28);
  vec3 n = normalize(vec3(-gEdge, 1.0));
  float hzC = hz(D);
  float edgeSlope = clamp(1.0 - n.z, 0.0, 1.0);

  // Smooth thickness + gentle zero-bias bulk lensing from 1/8-res u_thick (fetches 8..11)
  vec2 te = 0.014 * invAspect;
  float tl = texture(u_thick, uv - vec2(te.x, 0.0)).r;
  float tr = texture(u_thick, uv + vec2(te.x, 0.0)).r;
  float td = texture(u_thick, uv - vec2(0.0, te.y)).r;
  float tu = texture(u_thick, uv + vec2(0.0, te.y)).r;
  float thick = 0.25 * (tl + tr + td + tu);
  vec2 gBulk = vec2(tr - tl, tu - td);
  float T = clamp(thick, 0.0, 1.0) * u_depth;

  float invD = 1.0 / max(D, 1e-3);
  float spd = clamp(F.g * invD, 0.0, 1.0);

  // Refraction: crisp lensing at free surface, gentle magnification in deep bulk
  vec2 flowWave = vec2(sin(stageUV.y * 42.0 - u_time * 3.2),
                       cos(stageUV.x * 38.0 + u_time * 2.7)) * (0.0008 * spd);
  vec2 off = (-n.xy * 0.65 + gBulk * 0.45) * u_refract + flowWave;
  vec3 bg;
#ifdef LOW
  bg = texture(u_sheet, uv + off).rgb;                                     // fetch 12 (LOW)
#else
  vec2 cs = -n.xy * (u_refract * 0.08 * edgeSlope);
  bg = vec3(texture(u_sheet, uv + off + cs).r,                             // fetches 12..14
            texture(u_sheet, uv + off).g,
            texture(u_sheet, uv + off - cs).b);
#endif

  // Pure Beer-Lambert absorption: keeps ink crisp and legible through deep water
  float rimPath = pow(edgeSlope, 1.8) * 1.30 * (1.0 - smoothstep(0.70, 0.99, hzC));
  vec3 trans = exp(-u_sigma * (T * 0.95 + 0.09 + rimPath));
  vec3 col = bg * trans;

  // Optical caustics: multiplied by bg so paper brightens without washing out dark ink
  float ca = caustic(stageUV * 9.5 + n.xy * 0.45, u_time * 0.95);
  float caDepth = (1.0 - smoothstep(0.35, 1.10, T)) * smoothstep(0.05, 0.20, thick);
  float caMotion = 0.12 + 0.88 * smoothstep(0.02, 0.35, spd);
  col += bg * vec3(0.84, 0.96, 1.0) * (ca * caDepth * caMotion * u_caustic * 0.72);

  // Restrained studio optics: tight translucent TIR rim + sky-facing Fresnel + pinpoint glint
  float tir = pow(edgeSlope, 2.2) * (1.0 - smoothstep(0.65, 0.98, hzC));
  col *= mix(vec3(1.0), vec3(0.34, 0.58, 0.68), clamp(tir * 1.65, 0.0, 0.58));

  float fres = 0.02 + 0.98 * pow(edgeSlope, 3.2);
  float sky = smoothstep(-0.10, 0.75, n.y);
  col = mix(col, vec3(0.99, 0.995, 1.0), clamp(fres * sky * 0.50, 0.0, 0.45));

  vec3 L = normalize(vec3(-0.42, 0.72, 0.55));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 140.0);
  col += vec3(1.0, 0.995, 0.98) * spec * smoothstep(0.01, 0.08, edgeSlope) * 0.78;

  // Texture-free cellular lacy foam + buoyant micro-bubbles
  float foamRaw = clamp(F.b * invD + F.a * invD * 0.22, 0.0, 1.0);
  float foamAmt = 0.0;
  if (foamRaw > 0.06) {
    vec2 fp = stageUV * 58.0 - vec2(0.0, u_time * 0.55);
    fp += 0.32 * vec2(sin(fp.y * 0.65 + u_time * 0.5), cos(fp.x * 0.65 - u_time * 0.4));
    float d1 = cellDist(fp, u_time * 1.2);
    float web = smoothstep(0.28, 0.48, d1);
#ifdef LOW
    float beads = 1.0 - smoothstep(0.14, 0.27, d1);
    float pattern = mix(beads * 0.75, web, smoothstep(0.22, 0.60, foamRaw));
#else
    const mat2 R2 = mat2(0.80, -0.60, 0.60, 0.80);
    vec2 fp2 = R2 * (stageUV * 128.0) - vec2(0.0, u_time * 0.95);
    float d2 = cellDist(fp2, u_time * 1.6);
    float beads = 1.0 - smoothstep(0.13, 0.26, d2);
    float fineWeb = smoothstep(0.30, 0.48, d2);
    float pattern = mix(beads * 0.85 + fineWeb * 0.30, max(web, fineWeb * 0.62),
                        smoothstep(0.24, 0.62, foamRaw));
#endif
    float mist = smoothstep(0.10, 0.72, foamRaw) * 0.30;
    col = mix(col, vec3(0.86, 0.94, 0.97), mist);
    float lace = smoothstep(0.14, 0.52, foamRaw * (0.50 + 0.90 * pattern));
    float dense = smoothstep(0.60, 0.92, foamRaw);
    foamAmt = clamp(max(lace * 0.84, dense * 0.92), 0.0, 0.94);
    vec3 foamCol = mix(vec3(0.87, 0.93, 0.96), vec3(0.992, 0.994, 0.990),
                       0.65 + 0.35 * clamp(n.y, -0.3, 1.0));
    col = mix(col, foamCol, foamAmt);
  }

  vec3 outc = mix(outside, col, a);
  if (u_debug == 1) outc = vec3(D / (u_thresh * 3.0));
  else if (u_debug == 2) outc = n * 0.5 + 0.5;
  else if (u_debug == 3) outc = vec3(T);
  else if (u_debug == 4) outc = vec3(foamAmt);
  o = vec4(outc, 1.0);
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

export function createRenderer(canvas, { maxParticles = 12000, low = false } = {}) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return { ok: false, reason: 'no-webgl2' };
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return { ok: false, reason: 'no-float-rt' };

  let progs;
  try {
    progs = {
      splat: program(gl, SPLAT_VS, SPLAT_FS),
      blur: program(gl, FULLSCREEN_VS, BLUR_FS),
      down: program(gl, FULLSCREEN_VS, DOWN_FS),
      comp: program(gl, FULLSCREEN_VS, COMPOSITE_FS, low ? '#define LOW 1' : ''),
    };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }

  const emptyVao = gl.createVertexArray();
  // instanced quad
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, maxParticles * 6 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);

  function makeTarget(w, h, internal = gl.RGBA16F) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([251, 248, 243, 255]));

  const P = {
    thresh: 0.42, norm: 0.19, refract: 0.012, slope: 9.0, sigma: [0.58, 0.21, 0.12], depth: 1.0,
    shadow: [3, 4], caustic: 0.55, radiusPx: 9, stretch: 0.0022, maxStretch: 3.0, debug: 0,
    fieldScale: 0.5, thickScale: 0.125, edge: 2.0,
  };
  let W = 1, H = 1, cssW = 1, cssH = 1, dpr = 1;
  let A = null, B = null, S1 = null, S2 = null;

  function resize(wCss, hCss, dprGL) {
    cssW = wCss; cssH = hCss; dpr = dprGL;
    W = Math.max(2, Math.round(wCss * dprGL)); H = Math.max(2, Math.round(hCss * dprGL));
    canvas.width = W; canvas.height = H;
    [A, B, S1, S2].forEach(freeTarget);
    const fw = Math.max(2, Math.round(W * P.fieldScale)), fh = Math.max(2, Math.round(H * P.fieldScale));
    const sw = Math.max(2, Math.round(W * P.thickScale)), shh = Math.max(2, Math.round(H * P.thickScale));
    A = makeTarget(fw, fh); B = makeTarget(fw, fh);
    S1 = makeTarget(sw, shh); S2 = makeTarget(sw, shh);
    return A.ok && B.ok && S1.ok && S2.ok;
  }

  function setSheet(source) {
    gl.bindTexture(gl.TEXTURE_2D, sheetTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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

  // data: Float32Array [x, y, vx, vy, foam, spray] * count in stage CSS px
  function draw(data, count, time) {
    // 1) splat
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
    gl.viewport(0, 0, A.w, A.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 6);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const pr = progs.splat;
      gl.useProgram(pr.p);
      gl.uniform2f(pr.u.u_stage, cssW, cssH);
      gl.uniform1f(pr.u.u_radius, P.radiusPx);
      gl.uniform1f(pr.u.u_stretch, P.stretch);
      gl.uniform1f(pr.u.u_maxStretch, P.maxStretch);
      gl.uniform1f(pr.u.u_norm, P.norm);
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
    // 4) composite
    const pr = progs.comp;
    gl.useProgram(pr.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sheetTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, A.tex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, S1.tex);
    gl.uniform1i(pr.u.u_sheet, 0); gl.uniform1i(pr.u.u_field, 1); gl.uniform1i(pr.u.u_thick, 2);
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
    gl.uniform1i(pr.u.u_debug, P.debug);
    fullscreen(pr, null, W, H);
  }

  return {
    ok: true, gl, P,
    resize, setSheet, draw,
    get size() { return { W, H }; },
    lost: () => gl.isContextLost(),
  };
}
