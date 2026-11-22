// Liquid Identity — WebGL2 renderer.
// Pass 1 splats every particle as a smooth compact kernel into a half-float
// density + strain/energy field. Pass 2 shapes that field into a pooled liquid
// meniscus (steep rim, sleek glassy crown, plump beads) and lights it as deep
// obsidian ink resting on warm cream paper.

const FIELD_VS = `#version 300 es
in vec4 a_particle; // x, y, strain, energy
uniform vec2 u_offset;
uniform float u_scale;
uniform vec2 u_res;
uniform float u_size;
out vec2 v_meta;
void main() {
  vec2 p = u_offset + a_particle.xy * u_scale;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = u_size;
  v_meta = a_particle.zw;
}`;

const FIELD_FS = `#version 300 es
precision highp float;
in vec2 v_meta;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 >= 1.0) discard;
  float w = 1.0 - r2;
  float k = w * w * w;
  o = vec4(k, k * v_meta.x, k * v_meta.y, 0.0);
}`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const SHADE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform vec2 u_res;        // canvas pixels
uniform vec2 u_gradStep;   // scale-invariant Sobel step in uv
uniform float u_gradGain;  // normal slope gain scaled to kernel units
uniform float u_T;         // surface threshold
uniform float u_dpr;
uniform vec2 u_contact;    // tight contact-shadow offset in uv
uniform vec2 u_shadow;     // soft cast-shadow offset in uv
uniform vec3 u_ink;
uniform vec3 u_paper;
uniform vec3 u_orange;
uniform vec4 u_magnet;     // x, y (canvas px, GL origin), radius px, strength
uniform vec2 u_magnetMeta; // tension (0..1), pinch-off pulse (0..1)
out vec4 o;

float F(vec2 uv) { return texture(u_field, uv).r; }

// Saturating sessile-liquid meniscus: steep curved rim near u_T that levels
// into a calm glossy obsidian crown across strokes while staying domed on beads.
float Hh(vec2 uv) {
  float s = max(F(uv) - u_T * 0.85, 0.0);
  return s / (s + 0.72);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 data = texture(u_field, uv).rgb;
  float f = data.r;
  float aa = max(fwidth(f) * 0.85, 1e-3);
  float alpha = smoothstep(u_T - aa, u_T + aa, f);

  // Scale-invariant 8-tap Sobel gradient over the smoothed meniscus height.
  vec2 e = u_gradStep;
  float h00 = Hh(uv + vec2(-e.x, -e.y));
  float h10 = Hh(uv + vec2( 0.0, -e.y));
  float h20 = Hh(uv + vec2( e.x, -e.y));
  float h01 = Hh(uv + vec2(-e.x,  0.0));
  float h21 = Hh(uv + vec2( e.x,  0.0));
  float h02 = Hh(uv + vec2(-e.x,  e.y));
  float h12 = Hh(uv + vec2( 0.0,  e.y));
  float h22 = Hh(uv + vec2( e.x,  e.y));
  float hx = ((h20 + 2.0 * h21 + h22) - (h00 + 2.0 * h01 + h02)) * 0.25;
  float hy = ((h02 + 2.0 * h12 + h22) - (h00 + 2.0 * h10 + h20)) * 0.25;

  vec3 N = normalize(vec3(-hx * u_gradGain, -hy * u_gradGain, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.46, 0.62, 0.64));   // key light, upper left
  vec3 Hv = normalize(L + V);
  float ndh = max(dot(N, Hv), 0.0);
  float diff = max(dot(N, L), 0.0);
  float fres = pow(1.0 - clamp(N.z, 0.0, 1.0), 2.6);
  vec3 R = reflect(-V, N);

  // Studio softbox ribbon reflections along the smooth liquid meniscus.
  float win1 = smoothstep(0.78, 0.91, dot(R, normalize(vec3(-0.45, 0.54, 0.71))));
  float win2 = smoothstep(0.80, 0.93, dot(R, normalize(vec3(0.56, -0.48, 0.67)))) * 0.28;
  float sky = smoothstep(-0.25, 0.80, R.y - R.x * 0.35);
  float spec = pow(ndh, 160.0) * 1.05 + pow(ndh, 26.0) * 0.11;
  float bounce = pow(max(dot(N, normalize(vec3(0.62, -0.55, 0.35))), 0.0), 3.2);

  // Density-weighted local neck strain and surface ripple energy.
  float invF = 1.0 / max(f, 1e-4);
  float localStrain = clamp(data.g * invF, 0.0, 1.0);
  float localEnergy = clamp(data.b * invF, 0.0, 1.0);

  vec3 col = u_ink * (0.42 + 0.34 * diff);
  vec3 env = u_paper * (0.34 + 0.44 * sky);
  col = mix(col, env, fres * 0.52);
  col += u_orange * bounce * 0.14;
  col += u_paper * (0.96 * win2);
  col += vec3(1.0, 0.988, 0.968) * (spec + win1 * 0.58);

  // Subtle responsive material personality: thinned necks pick up a restrained
  // warm copper-orange meniscus sheen; impacts and hover ripples flash wet gloss.
  float rimMask = 0.28 + 0.72 * pow(1.0 - clamp(N.z, 0.0, 1.0), 1.3);
  vec3 copper = mix(u_orange, vec3(1.0, 0.66, 0.36), 0.28);
  col += copper * (localStrain * rimMask * 0.38);
  col += vec3(1.0, 0.97, 0.93) * (localEnergy * (0.16 * pow(ndh, 22.0) + 0.28 * fres));
  col = min(col, vec3(1.0));

  // Tight contact meniscus darkening + restrained directional cast shadow.
  float fc = F(uv - u_contact);
  float fs = F(uv - u_shadow);
  float contactA = smoothstep(u_T * 0.30, u_T * 1.15, fc) * 0.24;
  float castA = smoothstep(u_T * 0.14, u_T * 1.85, fs) * 0.11;
  float shadowA = clamp(contactA + castA * (1.0 - contactA), 0.0, 0.34);
  vec3 shadowCol = vec3(0.24, 0.19, 0.15);

  vec4 outc = vec4(col * alpha, alpha);
  outc += vec4(shadowCol * shadowA, shadowA) * (1.0 - alpha);

  // Responsive magnet ring that tightens subtly under filament tension and
  // sends a clean expanding pulse when a bead pinches off.
  if (u_magnet.w > 0.0 || u_magnetMeta.y > 0.01) {
    float d = length(gl_FragCoord.xy - u_magnet.xy);
    float ringAlpha = 0.0;
    if (u_magnet.w > 0.0) {
      float rad = u_magnet.z * (1.0 - 0.16 * u_magnetMeta.x);
      float strength = u_magnet.w * (0.85 + 0.35 * u_magnetMeta.x);
      ringAlpha += (1.0 - smoothstep(0.6 * u_dpr, 1.55 * u_dpr, abs(d - rad))) * strength;
    }
    if (u_magnetMeta.y > 0.01) {
      float p = u_magnetMeta.y;
      float pr = u_magnet.z * (0.95 + 0.55 * (1.0 - p));
      ringAlpha += (1.0 - smoothstep(0.5 * u_dpr, 1.8 * u_dpr, abs(d - pr))) * p * 0.55;
    }
    ringAlpha = clamp(ringAlpha, 0.0, 0.9);
    outc = vec4(u_orange * ringAlpha, ringAlpha) + outc * (1.0 - ringAlpha);
  }
  o = outc;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader: ${log}`);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i += 1) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export function createWebGLRenderer(canvas, { preserve = false, colors } = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: preserve, powerPreference: 'high-performance',
  });
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;

  const fieldProg = program(gl, FIELD_VS, FIELD_FS);
  const shadeProg = program(gl, QUAD_VS, SHADE_FS);
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const loc = gl.getAttribLocation(fieldProg.p, 'a_particle');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const quadVao = gl.createVertexArray();

  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  let fw = 0;
  let fh = 0;
  let packed = new Float32Array(0);
  const maxPoint = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];

  const ink = hex(colors?.ink || '#181c1c');
  const paper = hex(colors?.paper || '#fbf8f3');
  const orange = hex(colors?.orange || '#ff541e');

  function ensureField(w, h) {
    if (w === fw && h === fh) return;
    fw = w; fh = h;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('half-float framebuffer incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // view: { pixelWidth, pixelHeight, dpr, scale (css px / model unit), ox, oy (css px) }
  function render(model, view, magnet) {
    const fieldScale = 0.5;
    const W = Math.max(1, Math.round(view.pixelWidth * fieldScale));
    const H = Math.max(1, Math.round(view.pixelHeight * fieldScale));
    ensureField(W, H);
    const n = model.count;
    if (packed.length !== n * 4) packed = new Float32Array(n * 4);
    const strainArr = model.strain;
    const energyArr = model.energy;
    for (let i = 0; i < n; i += 1) {
      const o4 = i * 4;
      packed[o4] = model.x[i];
      packed[o4 + 1] = model.y[i];
      packed[o4 + 2] = strainArr ? strainArr[i] : 0;
      packed[o4 + 3] = energyArr ? energyArr[i] : 0;
    }

    const k = view.dpr * fieldScale; // css px -> field px
    const kernelFieldPx = Math.max(2, model.kernel * view.scale * k);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(fieldProg.p);
    gl.uniform2f(fieldProg.u.u_offset, view.ox * k, view.oy * k);
    gl.uniform1f(fieldProg.u.u_scale, view.scale * k);
    gl.uniform2f(fieldProg.u.u_res, W, H);
    gl.uniform1f(fieldProg.u.u_size, Math.min(maxPoint, 2 * kernelFieldPx));
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.pixelWidth, view.pixelHeight);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(shadeProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const u = shadeProg.u;
    gl.uniform1i(u.u_field, 0);
    gl.uniform2f(u.u_res, view.pixelWidth, view.pixelHeight);
    const stepFieldPx = Math.max(1.35, kernelFieldPx * 0.16);
    const stepKernelUnits = stepFieldPx / kernelFieldPx;
    gl.uniform2f(u.u_gradStep, stepFieldPx / W, stepFieldPx / H);
    gl.uniform1f(u.u_gradGain, 1.48 / (2 * stepKernelUnits));
    gl.uniform1f(u.u_T, model.threshold);
    gl.uniform1f(u.u_dpr, view.dpr);
    // Shadows fall subtly down-right; uv origin is bottom-left.
    const cOff = model.kernel * view.scale * 0.075;
    const sOff = model.kernel * view.scale * 0.22;
    gl.uniform2f(u.u_contact, (cOff * view.dpr) / view.pixelWidth, (-cOff * 1.25 * view.dpr) / view.pixelHeight);
    gl.uniform2f(u.u_shadow, (sOff * view.dpr) / view.pixelWidth, (-sOff * 1.35 * view.dpr) / view.pixelHeight);
    gl.uniform3fv(u.u_ink, ink);
    gl.uniform3fv(u.u_paper, paper);
    gl.uniform3fv(u.u_orange, orange);
    if (magnet && (magnet.strength > 0 || (magnet.pulse ?? 0) > 0.01)) {
      gl.uniform4f(u.u_magnet, magnet.x * view.dpr, view.pixelHeight - magnet.y * view.dpr, magnet.r * view.dpr, magnet.strength || 0);
      gl.uniform2f(u.u_magnetMeta, magnet.tension || 0, magnet.pulse || 0);
    } else {
      gl.uniform4f(u.u_magnet, 0, 0, 0, 0);
      gl.uniform2f(u.u_magnetMeta, 0, 0);
    }
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  // Debug only: ink coverage and a coarse occupancy grid from the real pixels.
  function readInk(cols = 40, rows = 25) {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return summarize(px, w, h, cols, rows, true);
  }

  return { kind: 'webgl2', render, readInk, gl };
}

export function summarize(px, w, h, cols, rows, flipY) {
  let ink = 0;
  const grid = new Array(cols * rows).fill(0);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      // opaque and dark = liquid (shadow is translucent)
      if (px[i + 3] > 200 && px[i] < 150) {
        ink += 1;
        const gy = flipY ? h - 1 - y : y;
        grid[Math.floor((gy / h) * rows) * cols + Math.floor((x / w) * cols)] += 1;
      }
    }
  }
  const total = Math.ceil(w / 2) * Math.ceil(h / 2);
  return {
    coverage: ink / total,
    grid: grid.map((v) => (v > 0 ? 1 : 0)).join(''),
  };
}
