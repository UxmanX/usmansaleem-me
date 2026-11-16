/* Walk-in edition (test build) — usmansaleem.me/walk-in/
 * Native scroll drives a camera rail through a white scale-model shop.
 * The entrance is a real sliding-door model; it opens on its own timing when the camera enters the
 * (illustrative) sensor zone and holds open while the camera is in or near the threshold.
 * All text lives in the HTML cards; the canvas is decoration (aria-hidden).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const root = document.documentElement;
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const isSmall = () => innerWidth < 900;

const S = {
  motion: !reduceMQ.matches && localStorage.getItem('walkin-motion') !== 'off',
  u: 0, uTarget: 0, door: 0, lastSeen: -1e9, detect: false, gate: false,
  dirty: true, active: -1, ready: false, frames: 0, dpr: 1, dprScale: 1,
};
window.__walk = S; // handy for testing in the console

/* ------------------------------------------------------------------ DOM: stops, cards, controls */
const sections = $$('main > .stop');
const N = sections.length;
const navLinks = $$('.wk-stops a');
const hud = $('#wk-hud');
const hudText = $('#wk-hud-text');
const motionBtn = $('#motion-toggle');
let tops = [];
let maxScroll = 1;
let sizeRenderer = () => {};

function measure() {
  tops = sections.map((s) => s.getBoundingClientRect().top + scrollY);
  maxScroll = Math.max(1, root.scrollHeight - innerHeight);
}

// Scroll position -> rail progress u (0..N-1). Each stop dwells for the first quarter of its
// scroll span (time to read the card), then the camera eases toward the next stop.
function progressFromScroll() {
  const y = clamp(scrollY, 0, maxScroll);
  let i = 0;
  while (i < N - 1 && y >= tops[i + 1] - 1) i++;
  if (i >= N - 1) return N - 1;
  const end = Math.min(tops[i + 1], maxScroll);
  const f = clamp((y - tops[i]) / Math.max(1, end - tops[i]), 0, 1);
  return i + ease((f - 0.25) / 0.75);
}

function setActive(i) {
  if (i === S.active) return;
  S.active = i;
  sections.forEach((s, k) => s.classList.toggle('is-active', k === i));
  navLinks.forEach((a, k) => (k === i ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current')));
}

function onScroll() {
  S.uTarget = progressFromScroll();
  setActive(Math.min(N - 1, Math.round(S.uTarget)));
  root.classList.toggle('at-end', scrollY + innerHeight > tops[N - 1] + innerHeight * 0.1);
  S.dirty = true;
}

function jumpTo(i, focus = true) {
  measure();
  window.scrollTo({ top: Math.min(tops[i], maxScroll), behavior: 'instant' });
  onScroll();
  if (focus) sections[i].querySelector('h1, h2')?.focus({ preventScroll: true });
}

$$('a[data-jump], .wk-stops a').forEach((a) => a.addEventListener('click', (e) => {
  const i = sections.findIndex((s) => '#' + s.id === a.getAttribute('href'));
  if (i < 0) return;
  e.preventDefault();
  jumpTo(i);
}));
// Keyboard users tabbing into a hidden card: bring its stop into view.
sections.forEach((s, i) => s.addEventListener('focusin', () => {
  if (S.active !== i && !s.classList.contains('stop-checkout')) jumpTo(i, false);
}));

function applyMotion() {
  root.classList.toggle('motion-off', !S.motion);
  motionBtn.setAttribute('aria-pressed', String(S.motion));
  motionBtn.querySelector('[data-state]').textContent = S.motion ? 'on' : 'off';
  S.dirty = true;
}
motionBtn.addEventListener('click', () => {
  S.motion = !S.motion;
  localStorage.setItem('walkin-motion', S.motion ? 'on' : 'off');
  applyMotion();
});
reduceMQ.addEventListener?.('change', (e) => { if (e.matches) { S.motion = false; applyMotion(); } });
applyMotion();

let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { measure(); onScroll(); if (S.ready) sizeRenderer(); });
}
addEventListener('resize', onResize);
window.visualViewport?.addEventListener('resize', onResize);
addEventListener('scroll', onScroll, { passive: true });
addEventListener('load', () => { measure(); onScroll(); });
measure();
onScroll();
document.fonts?.ready.then(() => { measure(); onScroll(); });

function fail(msg) {
  root.classList.add('no-3d');
  hudText.textContent = msg;
  hud.classList.add('is-visible');
}
function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}
if (!hasWebGL2()) fail('3D is not available here. The tour still works.');
else init().catch((err) => { console.error(err); fail('The 3D shop could not load. The tour still works.'); });

/* ------------------------------------------------------------------ 3D */
async function init() {
  const canvas = $('#wk-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // Canvas textures need the web fonts first (never wait more than ~2.5 s).
  const fontWait = new Promise((r) => setTimeout(r, 2500));
  await Promise.race([
    Promise.all(['800 64px "Plus Jakarta Sans"', '600 64px "Plus Jakarta Sans"', '700 64px "JetBrains Mono"', '600 64px "JetBrains Mono"']
      .map((f) => document.fonts?.load(f))).catch(() => {}),
    fontWait,
  ]);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 160);

  /* ---------- helpers ---------- */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  }
  const spacing = (g, px) => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };
  const mat = (color, roughness = 0.92, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const basic = (map, extra = {}) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, ...extra });
  const lit = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.85, ...extra });

  const M = {
    wall: mat(0xf4f1eb),
    inWall: mat(0xe2dbcf),
    white: mat(0xf1ede5),
    fixture: mat(0xfcfbf8, 0.8),
    floor: mat(0xd6cec1, 0.95),
    pave: mat(0xe3ded5, 0.97),
    curb: mat(0xeeebe4),
    street: mat(0xbcc1c8, 0.98),
    dark: mat(0x262b31, 0.55),
    accent: mat(0xff541e, 0.6),
    alu: new THREE.MeshStandardMaterial({ color: 0x30353b, metalness: 0.55, roughness: 0.38 }),
    header: new THREE.MeshStandardMaterial({ color: 0x272b30, metalness: 0.5, roughness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd3d7db, metalness: 0.9, roughness: 0.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xa9c3d1, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    doorGlass: new THREE.MeshPhysicalMaterial({ color: 0x92b2c4, roughness: 0.04, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
    vitrine: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    edge: new THREE.LineBasicMaterial({ color: 0xb2a99b, transparent: true, opacity: 0.45 }),
  };

  function add(mesh, parent = scene, cast = true, receive = true) {
    mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
  }
  function block(w, h, d, m, x, y, z, { parent = scene, edges = true, cast = true } = {}) {
    const mesh = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), parent, cast);
    mesh.position.set(x, y, z);
    if (edges) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), M.edge));
    return mesh;
  }
  function rounded(w, h, d, r, m, x, y, z, { parent = scene, cast = true } = {}) {
    const mesh = add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m), parent, cast);
    mesh.position.set(x, y, z);
    return mesh;
  }
  function plane(w, h, m, x, y, z, { parent = scene, rx = 0, ry = 0 } = {}) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    parent.add(mesh);
    return mesh;
  }
  const radial = (c0, c1) => canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const glowTex = radial('rgba(255,204,150,0.9)', 'rgba(255,204,150,0)');
  const shadowTex = radial('rgba(40,34,26,0.5)', 'rgba(40,34,26,0)');
  const glow = (w, d, x, z, opacity = 0.5) => plane(w, d, basic(glowTex, { blending: THREE.AdditiveBlending, opacity }), x, 0.008, z, { rx: -Math.PI / 2 });
  const contact = (w, d, x, z, opacity = 0.32) => plane(w, d, basic(shadowTex, { opacity, toneMapped: true }), x, 0.006, z, { rx: -Math.PI / 2 });
  const aoTex = canvasTex(8, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(40,34,26,0.32)'); gr.addColorStop(1, 'rgba(40,34,26,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  // Soft darkening where a wall meets the floor (cheap baked-AO look). ry rotates the strip.
  // The dark edge points toward the wall: ry = 0 back wall, +PI/2 left wall, -PI/2 right wall.
  function aoStrip(len, x, z, ry) {
    const m = plane(len, 0.7, basic(aoTex, { toneMapped: true }), x, 0.005, z);
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, ry, 0);
    return m;
  }

  /* ---------- sky, fog, light ---------- */
  scene.background = canvasTex(4, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#7b8ea9'); gr.addColorStop(0.42, '#aab8c9'); gr.addColorStop(0.7, '#dcd0c3'); gr.addColorStop(1, '#e8d8c6');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0xd5d0ca, 26, 80);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xcdd6e3, 0xd3d0c9, 0.8));
  const sun = new THREE.DirectionalLight(0xffe0c2, 2.5);
  sun.position.set(-12, 11, 13);
  sun.target.position.set(0, 0, -3);
  sun.castShadow = true;
  const sm = isSmall() ? 1024 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  for (const [x, y, z, i] of [[0, 3.7, -2.6, 16], [0.5, 3.7, -8.4, 14], [-3.0, 3.5, -12.0, 12]]) {
    const l = new THREE.PointLight(0xffdcb8, i, 14, 1.5);
    l.position.set(x, y, z);
    scene.add(l);
  }

  /* ---------- street ---------- */
  block(40, 0.15, 6.4, M.pave, 0, -0.075, 3.2, { edges: false, cast: false });
  block(40, 0.16, 0.28, M.curb, 0, -0.07, 6.5, { cast: false });
  block(40, 0.1, 22, M.street, 0, -0.2, 17.6, { edges: false, cast: false });
  for (let x = -18; x <= 18; x += 4) block(2, 0.012, 0.14, mat(0xf3f0ea), x, -0.144, 13, { edges: false, cast: false });
  {
    const pts = [];
    for (let x = -20; x <= 20; x += 1.2) pts.push(x, 0.003, 0, x, 0.003, 6.35);
    for (let z = 1.2; z < 6.4; z += 1.2) pts.push(-20, 0.003, z, 20, 0.003, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9c2b6, transparent: true, opacity: 0.55 })));
  }
  // neighbouring buildings as plain massing blocks with window reveals
  const reveal = mat(0xe2dcd2, 0.95);
  for (const [cx, w, h, front] of [[-10.9, 8.2, 7.4, -0.7], [10.8, 8.0, 5.8, -0.2]]) {
    block(w, h, 10, M.white, cx, h / 2, front - 5);
    for (let r = 0; r < Math.floor((h - 1.2) / 2.1); r++) {
      for (let c = 0; c < 3; c++) {
        plane(1.3, 1.5, reveal, cx - w / 2 + 1.5 + c * (w - 3) / 2, 1.9 + r * 2.1, front + 0.004);
      }
    }
  }
  function figure(parent, x, z, ry = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
    add(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.95, 6, 16), M.white), g).position.y = 0.66;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14), M.white), g).position.y = 1.49;
    return g;
  }
  function tree(x, z, s = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z); scene.add(g);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 2.1 * s, 10), M.white), g).position.y = 1.05 * s;
    add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.95 * s, 1), mat(0xf4f1ea, 0.9, { flatShading: true })), g).position.y = 2.6 * s;
    contact(2.2 * s, 2.2 * s, x, z, 0.25);
  }
  tree(-8.4, 4.5); tree(8.7, 4.3, 0.9); tree(-15.5, 4.6, 1.1); tree(15.8, 4.4);
  figure(scene, -4.4, 1.25, Math.PI);
  contact(0.9, 0.9, -4.4, 1.25, 0.3);
  // lamp post with a warm pool of light
  {
    const lamp = new THREE.Group();
    lamp.position.set(6.3, 0, 5.8); scene.add(lamp);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4.4, 14), M.white), lamp).position.y = 2.2;
    rounded(0.95, 0.06, 0.08, 0.025, M.white, -0.44, 4.36, 0, { parent: lamp });
    rounded(0.44, 0.1, 0.24, 0.03, new THREE.MeshStandardMaterial({ color: 0xfff3e2, emissive: 0xffd6a0, emissiveIntensity: 1.8 }), -0.86, 4.28, 0, { parent: lamp });
    glow(5, 5, 5.45, 5.6, 0.42);
  }

  /* ---------- storefront (facade plane z = 0, outside is +z) ---------- */
  const H = 4.6, W = 13, T = 0.3;
  block(W, H - 2.74, T, M.wall, 0, 2.74 + (H - 2.74) / 2, -T / 2);
  block(W + 0.3, 0.14, 0.5, M.white, 0, H + 0.07, -0.12);
  for (const sx of [-1, 1]) {
    block(0.5, 2.74, T, M.wall, sx * 6.25, 1.37, -T / 2);
    block(0.56, 2.74, T, M.wall, sx * 2.72, 1.37, -T / 2);
    block(3.0, 0.55, T, M.wall, sx * 4.5, 0.275, -T / 2);
    block(0.06, 2.19, 0.1, M.alu, sx * 4.5, 0.55 + 1.095, -0.15, { edges: false });
    block(3.0, 0.07, 0.1, M.alu, sx * 4.5, 2.705, -0.15, { edges: false });
    block(3.0, 0.07, 0.1, M.alu, sx * 4.5, 0.585, -0.15, { edges: false });
    for (const jx of [-1.465, 1.465]) block(0.07, 2.19, 0.1, M.alu, sx * 4.5 + jx, 0.55 + 1.095, -0.15, { edges: false });
    plane(3.0, 2.19, M.glass, sx * 4.5, 0.55 + 1.095, -0.13);
  }
  block(7.7, 1.16, 0.12, M.white, 0, 3.66, 0.06);
  const signTex = canvasTex(2048, 310, (g, w) => {
    g.textAlign = 'center';
    g.fillStyle = '#14171a'; g.font = '800 150px "Plus Jakarta Sans", sans-serif'; spacing(g, 14);
    g.fillText('USMAN SALEEM', w / 2, 168);
    g.fillStyle = '#ff541e'; g.fillRect(w / 2 - 70, 204, 140, 9);
    g.fillStyle = '#30363c'; g.font = '800 62px "JetBrains Mono", monospace'; spacing(g, 18);
    g.fillText('MECHANICAL ENGINEER', w / 2, 290);
  });
  plane(7.3, 7.3 * 310 / 2048, lit(signTex), 0, 3.66, 0.123);
  const vinylTex = canvasTex(1024, 380, (g) => {
    g.fillStyle = '#ff541e'; g.beginPath(); g.arc(42, 66, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(20,23,26,0.9)'; g.font = '800 88px "JetBrains Mono", monospace'; g.textBaseline = 'middle';
    g.fillText('50+ PROJECTS', 80, 68); g.fillText('IN FLIGHT', 80, 172);
    g.font = '600 36px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(20,23,26,0.72)';
    g.fillText('COMMERCIAL ENTRANCES · CANADA', 82, 278);
  });
  plane(2.3, 2.3 * 380 / 1024, lit(vinylTex), -4.5, 2.1, -0.11);
  const hoursTex = canvasTex(1024, 430, (g) => {
    g.fillStyle = 'rgba(20,23,26,0.9)'; g.font = '800 66px "JetBrains Mono", monospace';
    g.fillText('HOURS', 40, 86);
    g.font = '600 44px "JetBrains Mono", monospace';
    g.fillText('FIELD WORK ....... MON–FRI', 40, 190);
    g.fillText('AUTOMATIONS ......... 24/7', 40, 262);
    g.fillStyle = '#e8471a'; g.font = '700 44px "JetBrains Mono", monospace';
    g.fillText('WALK-INS WELCOME', 40, 360);
  });
  plane(2.3, 2.3 * 430 / 1024, lit(hoursTex), 4.5, 2.0, -0.11);

  // header sensor + illustrative detection zone
  rounded(0.34, 0.07, 0.09, 0.015, M.dark, 0, 2.19, -0.03);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), ledMat);
  led.position.set(0.11, 2.19, 0.018); scene.add(led);
  const zoneMat = new THREE.MeshBasicMaterial({ color: 0xff541e, transparent: true, opacity: 0.14, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff541e, transparent: true, opacity: 0.7, depthWrite: false });
  const pulseMat = new THREE.MeshBasicMaterial({ color: 0xff541e, transparent: true, opacity: 0, depthWrite: false });
  const zoneGroup = new THREE.Group();
  zoneGroup.position.set(0, 0.007, -0.02); zoneGroup.scale.set(1, 1, 0.78); scene.add(zoneGroup);
  for (const [geo, m] of [
    [new THREE.CircleGeometry(2.3, 64, Math.PI, Math.PI), zoneMat],
    [new THREE.RingGeometry(2.19, 2.3, 64, 1, Math.PI, Math.PI), ringMat],
  ]) { const z = new THREE.Mesh(geo, m); z.rotation.x = -Math.PI / 2; zoneGroup.add(z); }
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.0, 64, 1, Math.PI, Math.PI), pulseMat);
  pulse.rotation.x = -Math.PI / 2; zoneGroup.add(pulse);
  glow(5.5, 3.6, 0, 1.9, 0.3);
  plane(2.3, 0.234, basic(canvasTex(1024, 104, (g, w, h) => {
    g.fillStyle = '#d9400e'; g.font = '800 58px "JetBrains Mono", monospace'; g.textAlign = 'center'; spacing(g, 6);
    g.fillText('SENSOR ZONE · ILLUSTRATIVE', w / 2, 72);
  }), { opacity: 0.85 }), 0, 0.01, 1.32, { rx: -Math.PI / 2 });

  /* ---------- interior shell (no ceiling: the roof of the model is lifted off) ---------- */
  block(13, 0.12, 14.6, M.floor, 0, -0.06, -7.3, { edges: false, cast: false });
  block(T, H, 14.3, M.inWall, -6.35, H / 2, -7.45);
  block(T, H, 14.3, M.inWall, 6.35, H / 2, -7.45);
  block(W, H, T, M.inWall, 0, H / 2, -14.45);
  {
    const pts = [];
    for (let x = -6.0; x <= 6.0; x += 1.2) pts.push(x, 0.003, -0.3, x, 0.003, -14.3);
    for (let z = -1.5; z > -14.3; z -= 1.2) pts.push(-6.2, 0.003, z, 6.2, 0.003, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xd3cbbf, transparent: true, opacity: 0.5 })));
  }
  aoStrip(14.1, -5.85, -7.35, Math.PI / 2);
  aoStrip(14.1, 5.85, -7.35, -Math.PI / 2);
  aoStrip(12.4, 0, -13.95, 0);
  glow(7, 7, 0, -2.8, 0.16); glow(7, 7, 0.5, -8.4, 0.15); glow(5.5, 5.5, -3.0, -12.0, 0.14);

  /* ---------- stop 1: featured display (door model on a turntable) ---------- */
  const FEAT_FACE = -0.688; // plinth front faces the featured camera stop
  const feat = new THREE.Group();
  feat.position.set(2.8, 0, -3.8); scene.add(feat);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.16, 0.42, 64), M.fixture), feat).position.y = 0.21;
  const turn = new THREE.Group();
  turn.position.y = 0.42; feat.add(turn);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.035, 64), mat(0xe6e0d5, 0.8)), turn).position.y = 0.0175;
  contact(3.0, 3.0, 2.8, -3.8, 0.34);
  const labelTex = (a, b) => canvasTex(512, 300, (g, w, h) => {
    g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff541e'; g.fillRect(36, 40, 60, 8);
    g.fillStyle = '#5b6168'; g.font = '700 30px "JetBrains Mono", monospace'; spacing(g, 3); g.fillText(a, 36, 100);
    g.fillStyle = '#14171a'; g.font = '800 44px "Plus Jakarta Sans", sans-serif'; spacing(g, 0);
    const words = b.split(' '); let line = '', y = 170;
    for (const word of words) {
      if (g.measureText(line + word).width > w - 72 && line) { g.fillText(line.trim(), 36, y); line = ''; y += 54; }
      line += word + ' ';
    }
    g.fillText(line.trim(), 36, y);
  });
  {
    // label plate on the plinth's front, facing the featured camera stop
    const lbl = new THREE.Group();
    lbl.position.set(Math.sin(FEAT_FACE) * 1.19, 0.21, Math.cos(FEAT_FACE) * 1.19);
    lbl.rotation.y = FEAT_FACE; feat.add(lbl);
    plane(0.52, 0.305, lit(labelTex('FEATURED DISPLAY', 'SL500 3D Component Explorer'), { transparent: false, depthWrite: true }), 0, 0, 0, { parent: lbl });
  }

  /* ---------- stop 2: audit kiosk ---------- */
  const kiosk = new THREE.Group();
  kiosk.position.set(-3.9, 0, -4.6);
  kiosk.rotation.y = Math.atan2(2.5, 2.0);
  scene.add(kiosk);
  rounded(0.72, 1.02, 0.52, 0.05, M.fixture, 0, 0.51, 0, { parent: kiosk });
  rounded(0.16, 0.3, 0.16, 0.03, M.fixture, 0, 1.15, -0.05, { parent: kiosk });
  const kioskTex = canvasTex(1024, 640, (g, w, h) => {
    g.fillStyle = '#15191d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9edf1'; g.font = '800 46px "JetBrains Mono", monospace'; spacing(g, 2);
    g.fillText('STORE AUDIT', 56, 92);
    g.fillStyle = '#9aa3ad'; g.font = '700 32px "JetBrains Mono", monospace';
    g.fillText('15 / 15 DOORS', 56, 146);
    for (let i = 0; i < 15; i++) {
      const x = 56 + (i % 5) * 84, y = 190 + Math.floor(i / 5) * 84;
      g.fillStyle = '#35d07f'; g.fillRect(x, y, 66, 66);
      g.strokeStyle = '#15191d'; g.lineWidth = 9; g.beginPath(); g.moveTo(x + 16, y + 34); g.lineTo(x + 29, y + 48); g.lineTo(x + 51, y + 20); g.stroke();
    }
    g.fillStyle = '#9aa3ad'; g.font = '700 40px "JetBrains Mono", monospace';
    g.fillText('was 3:00:00', 560, 150);
    g.fillRect(556, 136, 268, 5);
    g.fillStyle = '#ff541e'; g.font = '800 190px "JetBrains Mono", monospace';
    g.fillText('0:15', 540, 360);
    g.fillStyle = '#35d07f'; g.fillRect(56, 470, w - 112, 18);
    g.fillStyle = '#e9edf1'; g.font = '700 34px "JetBrains Mono", monospace'; g.fillText('ROI · TAKE-OFF · PROPOSAL READY', 56, 560);
  });
  const screen = new THREE.Group();
  screen.position.set(0, 1.42, 0); screen.rotation.x = -0.26; kiosk.add(screen);
  rounded(1.02, 0.66, 0.07, 0.02, M.dark, 0, 0, 0, { parent: screen });
  plane(0.94, 0.585, basic(kioskTex, { transparent: false, depthWrite: true }), 0, 0, 0.037, { parent: screen });
  const tagTex = canvasTex(512, 300, (g, w, h) => {
    g.fillStyle = '#ff541e';
    g.beginPath(); g.moveTo(70, 0); g.lineTo(w - 16, 0); g.quadraticCurveTo(w, 0, w, 16); g.lineTo(w, h - 16); g.quadraticCurveTo(w, h, w - 16, h); g.lineTo(70, h); g.lineTo(0, h / 2); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(52, h / 2, 14, 0, Math.PI * 2); g.fill();
    g.font = '700 46px "JetBrains Mono", monospace'; g.fillText('WAS 3 HRS', 100, 110);
    g.fillRect(100, 92, 250, 5);
    g.font = '800 64px "JetBrains Mono", monospace'; g.fillText('NOW 15 SEC', 100, 210);
  });
  const tag = plane(0.4, 0.235, basic(tagTex, { side: THREE.DoubleSide }), 0.47, 0.8, 0.275, { parent: kiosk });
  tag.rotation.z = -0.14;
  contact(1.5, 1.3, -3.9, -4.6, 0.32);

  /* ---------- stop 3: key-accounts shelf + QBR screen ---------- */
  const shelf = new THREE.Group();
  shelf.position.set(5.78, 0, -7.6); shelf.rotation.y = -Math.PI / 2; scene.add(shelf);
  rounded(3.2, 0.14, 0.62, 0.02, M.fixture, 0, 0.07, 0, { parent: shelf });
  rounded(3.2, 1.6, 0.06, 0.015, M.fixture, 0, 0.8, -0.28, { parent: shelf });
  for (const y of [0.42, 0.82, 1.22]) rounded(3.2, 0.035, 0.52, 0.01, M.fixture, 0, y, -0.02, { parent: shelf });
  {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const y0 of [0.14, 0.4375, 0.8375, 1.2375]) {
      let x = -1.52;
      for (;;) {
        const w = 0.14 + rnd() * 0.22, h = 0.14 + rnd() * 0.19, d = 0.22 + rnd() * 0.16;
        if (x + w > 1.55) break;
        const r = rnd();
        rounded(w, h, d, 0.012, r < 0.2 ? M.accent : r < 0.34 ? M.dark : M.fixture, x + w / 2, y0 + h / 2, -0.04, { parent: shelf, cast: false });
        x += w + 0.04 + rnd() * 0.05;
      }
    }
  }
  const qbrTex = canvasTex(1024, 576, (g, w, h) => {
    g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#14171a'; g.font = '800 40px "Plus Jakarta Sans", sans-serif'; g.fillText('Quarterly business review', 44, 72);
    g.fillStyle = '#5b6168'; g.font = '600 26px "JetBrains Mono", monospace'; g.fillText('8 SLIDES · BUILT IN ~7 s', 44, 116);
    for (let i = 0; i < 8; i++) {
      const x = 44 + (i % 4) * 238, y = 160 + Math.floor(i / 4) * 196;
      g.fillStyle = '#ffffff'; g.fillRect(x, y, 214, 170);
      g.strokeStyle = 'rgba(20,23,26,0.14)'; g.lineWidth = 2; g.strokeRect(x, y, 214, 170);
      g.fillStyle = '#14171a'; g.fillRect(x + 16, y + 18, 110, 10);
      for (let b = 0; b < 5; b++) {
        const bh = 18 + ((i * 7 + b * 13) % 70);
        g.fillStyle = b === (i % 5) ? '#ff541e' : '#c9ced4';
        g.fillRect(x + 20 + b * 36, y + 150 - bh, 24, bh);
      }
    }
  });
  {
    const q = new THREE.Group();
    q.position.set(6.16, 2.56, -7.6); q.rotation.y = -Math.PI / 2; scene.add(q);
    rounded(2.0, 1.16, 0.06, 0.02, M.dark, 0, 0, 0, { parent: q });
    plane(1.92, 1.08, basic(qbrTex, { transparent: false, depthWrite: true }), 0, 0, 0.032, { parent: q });
  }
  contact(1.6, 3.8, 5.6, -7.6, 0.28);

  /* ---------- stop 4: plant scale model in a vitrine ---------- */
  {
    const mill = new THREE.Group();
    mill.position.set(0.8, 0, -11.0); mill.rotation.y = 0.35; scene.add(mill);
    rounded(2.1, 0.86, 1.25, 0.04, M.fixture, 0, 0.43, 0, { parent: mill });
    rounded(1.9, 0.04, 1.05, 0.01, mat(0xe4ded3), 0, 0.88, 0, { parent: mill });
    const top = 0.9, mm = M.white;
    rounded(0.42, 0.98, 0.36, 0.01, mm, -0.45, top + 0.49, -0.12, { parent: mill });
    for (let i = 0; i < 3; i++) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.78, 28), mm), mill).position.set(0.12 + i * 0.23, top + 0.39, -0.28);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 28), mm), mill).position.set(0.12 + i * 0.23, top + 0.82, -0.28);
    }
    rounded(0.7, 0.32, 0.44, 0.01, mm, 0.38, top + 0.16, 0.24, { parent: mill });
    rounded(0.62, 0.035, 0.07, 0.005, mm, -0.06, top + 0.7, -0.2, { parent: mill }).rotation.z = -0.35;
    add(new THREE.Mesh(new RoundedBoxGeometry(2.0, 1.0, 1.15, 2, 0.01), M.vitrine), mill, false, false).position.set(0, top + 0.5, 0);
    const p = rounded(0.6, 0.12, 0.02, 0.01, M.fixture, 0, 0.62, 0.635, { parent: mill });
    plane(0.56, 0.1, lit(canvasTex(512, 92, (g, w, h) => {
      g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#14171a'; g.font = '700 30px "JetBrains Mono", monospace'; spacing(g, 2);
      g.fillText('PLANT COMMISSIONING · 1:100', 18, 58);
    }), { transparent: false, depthWrite: true }), 0, 0, 0.011, { parent: p });
    contact(2.9, 2.2, 0.8, -11.0, 0.3);
  }

  /* ---------- stop 5: checkout, credentials wall, exit ---------- */
  {
    const co = new THREE.Group();
    co.position.set(-2.9, 0, -11.4); co.rotation.y = 0.2; scene.add(co);
    rounded(2.6, 1.0, 0.75, 0.04, M.fixture, 0, 0.5, 0, { parent: co });
    rounded(2.75, 0.05, 0.85, 0.02, mat(0xe9e3d9), 0, 1.025, 0, { parent: co });
    rounded(0.24, 0.13, 0.26, 0.02, M.dark, 0.85, 1.115, -0.05, { parent: co });
    const paper = plane(0.09, 0.3, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }), 0.85, 1.3, 0.09, { parent: co });
    paper.rotation.x = -0.3;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome), co).position.set(-0.7, 1.05, 0.12);
    figure(co, 0.1, -0.85);
    contact(3.4, 1.8, -2.9, -11.4, 0.3);
  }
  const degreeTex = (a, b, c) => canvasTex(640, 460, (g, w, h) => {
    g.fillStyle = '#fbf7ee'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9b98f'; g.lineWidth = 6; g.strokeRect(22, 22, w - 44, h - 44);
    g.textAlign = 'center';
    g.fillStyle = '#3d434a'; g.font = '800 32px "JetBrains Mono", monospace'; spacing(g, 3); g.fillText(a, w / 2, 120);
    g.fillStyle = '#14171a'; g.font = 'italic 700 45px Georgia, serif'; spacing(g, 0); g.fillText(b, w / 2, 222, w - 90);
    g.font = '700 42px Georgia, serif'; g.fillText(c, w / 2, 298, w - 90);
    g.fillStyle = '#ff541e'; g.beginPath(); g.arc(w / 2, 380, 20, 0, Math.PI * 2); g.fill();
  });
  for (const [x, tex] of [
    [-4.75, degreeTex('MASTER OF ENGINEERING', 'Mechanical Engineering', 'University of Ottawa')],
    [-2.4, degreeTex('BACHELOR OF SCIENCE', 'Mechanical Engineering', 'UET Lahore')],
  ]) {
    rounded(1.26, 0.94, 0.04, 0.008, M.dark, x, 1.9, -14.27);
    plane(1.16, 0.84, lit(tex, { transparent: false, depthWrite: true }), x, 1.9, -14.247);
  }
  plane(3.6, 0.6, lit(canvasTex(1440, 240, (g, w) => {
    g.strokeStyle = '#14171a'; g.lineWidth = 5; g.setLineDash([18, 14]);
    g.beginPath(); g.moveTo(170, 80); g.lineTo(w - 170, 80); g.stroke(); g.setLineDash([]);
    const stops = [[170, 'LHE', 'Lahore'], [w / 2, 'YOW', 'Ottawa'], [w - 170, 'YYZ', 'Mississauga']];
    g.textAlign = 'center';
    for (const [x, code, city] of stops) {
      g.fillStyle = '#ff541e'; g.beginPath(); g.arc(x, 80, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#14171a'; g.font = '800 54px "JetBrains Mono", monospace'; g.fillText(code, x, 168);
      g.fillStyle = '#3d434a'; g.font = '700 38px "Plus Jakarta Sans", sans-serif'; g.fillText(city, x, 218);
    }
  })), -3.6, 2.95, -14.29);
  {
    const ex = new THREE.Group();
    ex.position.set(-6.17, 2.62, -12.9); ex.rotation.y = Math.PI / 2; scene.add(ex);
    rounded(0.66, 0.26, 0.06, 0.02, new THREE.MeshStandardMaterial({ color: 0x0f7a3a, emissive: 0x16a34f, emissiveIntensity: 0.9 }), 0, 0, 0, { parent: ex });
    plane(0.6, 0.22, basic(canvasTex(512, 184, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.font = '800 120px "JetBrains Mono", monospace'; g.textAlign = 'center'; spacing(g, 10);
      g.fillText('EXIT', w / 2 + 5, h / 2 + 42);
    })), 0, 0, 0.032, { parent: ex });
    const sd = new THREE.Group();
    sd.position.set(-6.19, 0, -12.9); sd.rotation.y = Math.PI / 2; scene.add(sd);
    rounded(1.1, 2.2, 0.04, 0.01, mat(0xd9d3c8), 0, 1.1, 0, { parent: sd });
    rounded(0.95, 2.08, 0.05, 0.01, mat(0xcdc6b9), 0, 1.04, 0.01, { parent: sd });
  }

  /* ---------- the entrance: real sliding-door model ---------- */
  const SLIDE_M = 1.13; // each leaf travels ~1.13 m (3.7 ft) behind its sidelight
  let leafL = null, leafR = null, slideLocal = 0, miniL = null, miniR = null, miniSlide = 0;
  const decals = [];
  try {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('assets/door.v1.glb', (e) => {
      if (e.total) hudText.textContent = `Loading the entrance… ${Math.round((e.loaded / e.total) * 100)}%`;
    });
    const door = gltf.scene;
    door.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material?.name || '';
      o.material = n.includes('Glass') ? M.doorGlass : n.includes('Header') ? M.header : M.alu;
      o.castShadow = !n.includes('Glass');
      o.receiveShadow = true;
    });
    scene.add(door);
    door.updateMatrixWorld(true);
    leafL = door.getObjectByName('Door_LeafL');
    leafR = door.getObjectByName('Door_LeafR');
    const bb = new THREE.Box3().setFromObject(door);
    const lb = new THREE.Box3().setFromObject(leafL);
    door.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -0.15 - (lb.min.z + lb.max.z) / 2);
    slideLocal = SLIDE_M / leafL.parent.getWorldScale(new THREE.Vector3()).x;
    leafL.userData.x0 = leafL.position.x;
    leafR.userData.x0 = leafR.position.x;

    // the same door, small, on the featured turntable
    const wrap = new THREE.Group();
    wrap.scale.setScalar(0.4); wrap.position.y = 0.035; turn.add(wrap);
    const mini = door.clone(true);
    mini.position.set(door.position.x, door.position.y, door.position.z + 0.15);
    mini.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    wrap.add(mini);
    miniL = mini.getObjectByName('Door_LeafL');
    miniR = mini.getObjectByName('Door_LeafR');
    miniSlide = slideLocal;
  } catch (err) {
    console.warn('Door model failed to load; using a simple stand-in.', err);
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Group();
      leaf.position.set(sx * 0.63, 0, -0.15); scene.add(leaf);
      block(1.25, 2.14, 0.05, M.alu, 0, 1.07, 0, { parent: leaf, edges: false });
      plane(1.1, 1.98, M.doorGlass, 0, 1.07, 0.03, { parent: leaf });
      leaf.userData.x0 = leaf.position.x;
      if (sx < 0) leafL = leaf; else leafR = leaf;
    }
    slideLocal = SLIDE_M;
    block(4.88, 0.45, 0.25, M.header, 0, 2.3, -0.15, { edges: false });
  }
  // generic "automatic door" decals that ride on the leaves
  const decalTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(w / 2, h / 2, 120, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#14171a'; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, 108, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#14171a'; g.textAlign = 'center'; g.font = '800 34px "JetBrains Mono", monospace';
    g.fillText('AUTOMATIC', w / 2, 118); g.fillText('DOOR', w / 2, 160);
  });
  for (const sx of [-1, 1]) {
    const d = plane(0.22, 0.22, lit(decalTex), sx * 0.62, 1.45, -0.118);
    d.userData.x0 = d.position.x; d.userData.dir = sx;
    decals.push(d);
  }

  /* ---------- camera rail: one keyframe per stop ---------- */
  const KF = [
    { p: [0, 1.62, 9.6], t: [0, 2.05, 0] },          // street
    { p: [0, 1.62, 2.4], t: [0, 1.5, -6] },          // entrance
    { p: [0.5, 1.62, -1.0], t: [2.8, 0.85, -3.8] },  // featured display
    { p: [-1.4, 1.62, -2.6], t: [-3.9, 1.15, -4.6] }, // kiosk
    { p: [1.9, 1.62, -6.4], t: [5.8, 1.75, -7.7] },  // shelf
    { p: [-0.6, 1.62, -7.7], t: [0.8, 1.0, -11.0] }, // plant model
    { p: [-1.9, 1.62, -9.6], t: [-3.4, 1.55, -13.0] }, // checkout
  ].slice(0, N);
  const v3 = (a) => new THREE.Vector3(...a);
  const posCurve = new THREE.CatmullRomCurve3(KF.map((k) => v3(k.p)), false, 'centripetal');
  const tgtCurve = new THREE.CatmullRomCurve3(KF.map((k) => v3(k.t)), false, 'centripetal');
  const zAt = (u) => posCurve.getPoint(clamp(u, 0, N - 1) / (N - 1)).z;
  const uForZ = (zT, u0, u1) => {
    let best = u0, bestD = Infinity;
    for (let i = 0; i <= 400; i++) {
      const u = u0 + ((u1 - u0) * i) / 400, d = Math.abs(zAt(u) - zT);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  };
  const ZONE_OUT = 3.6, ZONE_IN = -1.75;            // sensor sees you between these z values
  const U_GATE_OUT = uForZ(0.8, 1, 2), U_GATE_IN = uForZ(-0.95, 1, 2); // wait here until the door is open
  const inZone = (z) => z < ZONE_OUT && z > ZONE_IN;
  const lookAt = new THREE.Vector3();

  function updateCamera(dt) {
    const target = S.uTarget;
    S.gate = false;
    if (!S.motion) {
      S.u = Math.min(N - 1, Math.round(target));
    } else if (Math.abs(target - S.u) > 2.2) {
      S.u = target; // long jump (stop index / skip): cut, don't fly
      S.door = inZone(zAt(target)) ? 1 : 0;
    } else {
      let u = S.u + (target - S.u) * (1 - Math.exp(-4.5 * dt));
      if (Math.abs(target - u) < 1e-4) u = target;
      if (S.door < 0.9) {
        if (S.u <= U_GATE_OUT + 1e-6 && u > U_GATE_OUT) { u = U_GATE_OUT; S.gate = true; }
        else if (S.u >= U_GATE_IN - 1e-6 && u < U_GATE_IN) { u = U_GATE_IN; S.gate = true; }
      }
      S.u = u;
    }
    S.u = clamp(S.u, 0, N - 1);
    const t = S.u / (N - 1);
    posCurve.getPoint(t, camera.position);
    tgtCurve.getPoint(t, lookAt);
    camera.lookAt(lookAt);
  }

  function updateDoor(dt, now) {
    const wanted = inZone(camera.position.z) || S.gate;
    if (wanted) S.lastSeen = now;
    S.detect = wanted;
    const open = wanted || now - S.lastSeen < 800;
    if (!S.motion) S.door = open ? 1 : 0;
    else S.door = clamp(S.door + (open ? 1 / 1.1 : -1 / 1.7) * dt, 0, 1);
    const e = ease(S.door);
    if (leafL) {
      leafL.position.x = leafL.userData.x0 - e * slideLocal;
      leafR.position.x = leafR.userData.x0 + e * slideLocal;
    }
    for (const d of decals) d.position.x = d.userData.x0 + d.userData.dir * e * SLIDE_M;
    ledMat.color.setHex(wanted ? 0x35d07f : 0xffb020);
    zoneMat.opacity = wanted ? 0.26 : 0.14;
    ringMat.opacity = wanted ? 0.95 : 0.7;
  }

  function updateHud() {
    const show = S.ready && S.u < 2.6;
    hud.classList.toggle('is-visible', show);
    if (!show) return;
    const inDoorway = Math.abs(camera.position.z + 0.15) < 1.0;
    let txt, st;
    if (S.door <= 0 && !S.detect) { txt = 'Door closed · sensor watching'; st = 'idle'; }
    else if (S.detect && S.door < 1) { txt = 'Motion detected · opening'; st = 'opening'; }
    else if (S.detect && inDoorway) { txt = 'Someone in the doorway · holding open'; st = 'hold'; }
    else if (S.detect) { txt = 'Presence detected · holding open'; st = 'hold'; }
    else { txt = 'All clear · closing'; st = 'closing'; }
    if (hudText.textContent !== txt) hudText.textContent = txt;
    hud.dataset.state = st;
  }

  sizeRenderer = () => {
    const w = innerWidth, h = innerHeight;
    const cap = (isSmall() ? 1.25 : 1.5) * S.dprScale;
    S.dpr = Math.max(0.6, Math.min(devicePixelRatio || 1, cap, Math.sqrt(2.4e6 / (w * h))));
    renderer.setPixelRatio(S.dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const hfov = THREE.MathUtils.degToRad(isSmall() ? 64 : 72);
    camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect)), 42, 78);
    // keep the subject clear of the cards: shift right on desktop, up on phones
    if (w >= 900) camera.setViewOffset(w, h, -w * 0.17, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.16, w, h);
    camera.updateProjectionMatrix();
    S.dirty = true;
  };
  sizeRenderer();

  /* ---------- loop: render only when something changes ---------- */
  let last = performance.now(), animT = 0, slow = 1 / 60;
  function frame(now) {
    requestAnimationFrame(frame);
    // rAF timestamps can precede the performance.now() taken at setup: never let time run backwards
    const raw = Math.max(0, (now - last) / 1000);
    const dt = Math.min(raw, 0.05);
    last = now;
    if (document.hidden) return;
    const prevU = S.u, prevDoor = S.door;
    updateCamera(dt);
    updateDoor(dt, now);
    const turning = S.motion && S.u > 1.5 && S.u < 3.5;
    const pulsing = S.motion && S.detect && S.u < 2.6;
    const moving = Math.abs(S.u - prevU) > 1e-6 || S.door !== prevDoor;
    if (!(moving || turning || pulsing || S.dirty)) { animT = 0; return; }
    S.dirty = false;
    if (turning) {
      turn.rotation.y = FEAT_FACE + Math.sin(now / 2000) * 0.6; // sway, so the door never ends up edge-on
      if (miniL) {
        const c = (now / 1000) % 6;
        const o = ease(c < 1.2 ? c / 1.2 : c < 3.2 ? 1 : c < 4.8 ? 1 - (c - 3.2) / 1.6 : 0);
        miniL.position.x = leafL.userData.x0 - o * miniSlide;
        miniR.position.x = leafR.userData.x0 + o * miniSlide;
      }
    }
    if (pulsing) {
      const k = ((now / 1000) % 1.3) / 1.3;
      pulse.scale.setScalar(0.25 + k * 2.05);
      pulseMat.opacity = 0.55 * (1 - k);
    } else pulseMat.opacity = 0;
    updateHud();
    if (S.door !== prevDoor || S.frames === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    S.frames++;
    if (!S.ready) {
      S.ready = true;
      root.classList.add('is-3d');
      S.dirty = true;
    }
    // adaptive resolution: if continuous animation runs below ~30 fps, render fewer pixels
    if (moving || turning) {
      animT += raw;
      slow = slow * 0.9 + raw * 0.1;
      if (animT > 1.5 && slow > 0.034 && S.dprScale > 0.6) { S.dprScale -= 0.2; animT = 0; sizeRenderer(); }
    } else animT = 0;
  }
  requestAnimationFrame(frame);
}
