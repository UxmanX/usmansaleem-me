/* Walk-in edition — usmansaleem.me/walk-in/
 * Native scroll drives a camera rail through a small shop at blue hour.
 * Photoreal pass: CC0 PBR textures and sky from Poly Haven (polyhaven.com), physically based materials,
 * warm interior light against a cool dusk sky. The entrance is Usman's own SL500 sliding-door model;
 * it opens when the camera enters the (illustrative) sensor zone and holds open in the threshold.
 * Hands-on exhibits: at the entrance the header turns X-ray and shows a generic drive (illustrative)
 * that moves with the door.
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
  viewY: 0, viewYCur: 0, announce: false,
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

// Phones: the intro card is compact ("More" opens the rest) and later cards open as a sheet from the dock.
// Desktop always shows everything.
function setOpen(card, open) {
  card.classList.toggle('is-open', open);
  const b = card.querySelector('.card-toggle');
  if (b) {
    b.setAttribute('aria-expanded', String(open));
    b.querySelector('[data-label]').textContent = open ? 'Close' : 'More';
  }
  // closing a phone sheet: move focus out, or :focus-within would keep the closed card on screen
  if (!open && isSmall() && card !== sections[0].querySelector('.card') && card.contains(document.activeElement)) {
    infoBtn.focus({ preventScroll: true });
  }
  syncInfo();
  updateFraming();
  requestAnimationFrame(() => syncMore(card));
}
$$('.card-toggle').forEach((b) => b.addEventListener('click', () => {
  const card = b.closest('.card');
  setOpen(card, !card.classList.contains('is-open'));
}));

/* ---------- walk controls: Back / Next, progress, first-visit hint ---------- */
const dock = $('.wk-dock');
const prevBtn = $('.dock-prev');
const nextBtn = $('.dock-next');
const infoBtn = $('.dock-info');
const live = $('#wk-live');
const NAMES = navLinks.map((a) => a.textContent.trim());
const TITLES = sections.map((s) => s.querySelector('h1, h2')?.textContent.trim() || '');
const coarse = matchMedia('(pointer: coarse)');
let walked = localStorage.getItem('walkin-walked') === '1';
let goal = -1; // stop we are smooth-scrolling to, so repeated taps on Next keep counting
root.classList.toggle('walked', walked);

function hintCopy() {
  const touch = coarse.matches;
  $('[data-hint]').textContent = touch ? 'Swipe up to walk in' : 'Scroll to walk in';
  $('.dock-hint-ico').classList.toggle('is-down', !touch);
}
hintCopy();
coarse.addEventListener?.('change', hintCopy);

function syncInfo() {
  const i = Math.max(0, S.active);
  const open = !!sections[i]?.querySelector('.card')?.classList.contains('is-open');
  infoBtn.setAttribute('aria-expanded', String(open));
  infoBtn.querySelector('[data-title]').textContent = open ? 'Hide details' : TITLES[i];
  infoBtn.querySelector('[data-sr]').textContent = open ? '' : `${/[.!?]$/.test(TITLES[i]) ? ' ' : '. '}Stop ${i + 1} of ${N}. Show details`;
}

// an open sheet with more text below fades at the bottom edge until it is scrolled to the end
function syncMore(card) {
  card.classList.toggle('has-more', card.classList.contains('is-open') && card.scrollHeight - card.scrollTop - card.clientHeight > 4);
}
$$('main .card').forEach((c) => c.addEventListener('scroll', () => syncMore(c), { passive: true }));

// Phones: centre the 3D subject in the clear area between the top bar and whatever covers the bottom.
function updateFraming() {
  let y = 0;
  if (isSmall() && !root.classList.contains('at-end')) {
    const card = sections[S.active]?.querySelector('.card');
    let top = dock.getBoundingClientRect().top;
    if (card && (S.active === 0 || card.classList.contains('is-open'))) top = Math.min(top, card.getBoundingClientRect().top);
    // a slight lift trades ceiling for floor (a little more inside the shop, where the ceiling is dark)
    y = Math.max(innerHeight * (S.active > 0 ? 0.085 : 0.06), (innerHeight - top - 64) / 2);
  }
  if (Math.abs(y - S.viewY) > 0.5) { S.viewY = y; S.dirty = true; }
}

function updateDock(i) {
  const intro = i === 0;
  root.classList.toggle('dock-intro', intro);
  prevBtn.disabled = intro;
  const label = intro ? 'Walk in' : i === N - 2 ? 'Checkout' : 'Next';
  nextBtn.querySelector('[data-label]').textContent = label;
  nextBtn.querySelector('.dock-next-name').textContent = intro || i >= N - 2 ? '' : ': ' + NAMES[i + 1];
  nextBtn.disabled = i >= N - 1;
  nextBtn.classList.toggle('is-icon', !intro && i < N - 2); // phones show a round arrow after the intro
  $('.dock-step').textContent = `Stop ${i + 1} of ${N}`;
  infoBtn.querySelector('[data-step]').textContent = `${i + 1}/${N}`;
  const body = sections[i].querySelector('.card-body');
  if (body) infoBtn.setAttribute('aria-controls', body.id); else infoBtn.removeAttribute('aria-controls');
  dock.style.setProperty('--p', String(i / (N - 1)));
  syncInfo();
  if (i > 0 && !walked) { walked = true; localStorage.setItem('walkin-walked', '1'); root.classList.add('walked'); }
  if (S.announce) live.textContent = `${NAMES[i]}, stop ${i + 1} of ${N}`;
  S.announce = true;
}

function go(i) {
  i = clamp(i, 0, N - 1);
  if (i === S.active && goal < 0) return;
  goal = i;
  measure();
  window.scrollTo({ top: Math.min(tops[i], maxScroll), behavior: S.motion ? 'smooth' : 'instant' });
}
const step = (d) => go((goal >= 0 ? goal : S.active) + d);
prevBtn.addEventListener('click', () => step(-1));
nextBtn.addEventListener('click', () => step(1));
infoBtn.addEventListener('click', () => {
  const card = sections[S.active]?.querySelector('.card');
  if (!card) return;
  const open = !card.classList.contains('is-open');
  setOpen(card, open);
  if (open) card.querySelector('h1, h2')?.focus({ preventScroll: true });
});
// Phones: tapping the shop (outside the sheet) closes the sheet.
$('main').addEventListener('click', (e) => {
  if (!isSmall() || e.target.closest('.card')) return;
  const open = $('.card.is-open');
  if (open) setOpen(open, false);
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = $('.card.is-open');
    if (open) { setOpen(open, false); if (isSmall()) infoBtn.focus(); }
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
});
addEventListener('scrollend', () => { goal = -1; });
addEventListener('touchstart', (e) => { if (!e.target.closest?.('.wk-dock')) goal = -1; }, { passive: true });
addEventListener('wheel', () => { goal = -1; }, { passive: true });

function setActive(i) {
  if (i === S.active) return;
  S.active = i;
  sections.forEach((s, k) => {
    s.classList.toggle('is-active', k === i);
    const open = k !== i && s.querySelector('.card.is-open');
    if (open) setOpen(open, false);
  });
  navLinks.forEach((a, k) => (k === i ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current')));
  if (i === goal) goal = -1;
  updateDock(i);
  updateFraming();
}

function onScroll() {
  S.uTarget = progressFromScroll();
  setActive(Math.min(N - 1, Math.round(S.uTarget)));
  const end = scrollY + innerHeight * 0.5 > tops[N - 1];
  if (end !== root.classList.contains('at-end')) { root.classList.toggle('at-end', end); updateFraming(); }
  S.dirty = true;
}

function jumpTo(i, focus = true) {
  measure();
  window.scrollTo({ top: Math.min(tops[i], maxScroll), behavior: 'instant' });
  onScroll();
  if (!focus) return;
  // phones keep the middle cards closed, so focus the dock's stop title instead of a hidden heading
  const target = isSmall() && i > 0 && i < N - 1 ? infoBtn : sections[i].querySelector('h1, h2');
  target?.focus({ preventScroll: true });
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
  resizeRaf = requestAnimationFrame(() => { measure(); onScroll(); updateFraming(); if (S.ready) sizeRenderer(); });
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
  const lite = isSmall() || (navigator.deviceMemory || 8) <= 4;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.localClippingEnabled = true; // the entrance header cutaway
  const aniso = Math.min(lite ? 4 : 8, renderer.capabilities.getMaxAnisotropy());

  /* ---------- load fonts, textures, sky and the door in parallel ---------- */
  let want = 0, got = 0;
  hud.classList.add('is-visible');
  const tick = () => { got++; hudText.textContent = `Loading the shop… ${Math.round((100 * got) / Math.max(1, want))}%`; };
  const texLoader = new THREE.TextureLoader();
  const loadTex = (url, srgb = false, wrap = true) => {
    want++;
    return new Promise((res) => texLoader.load(url, (t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      tick(); res(t);
    }, undefined, () => { tick(); res(null); }));
  };
  const RES = lite ? '512' : '1k';
  const NAMES = ['pave', 'asphalt', 'brick', 'tiles', 'plaster', 'wood'];
  const texJob = Promise.all(NAMES.map((n) => Promise.all([
    loadTex(`assets/tex/${n}_diff_${RES}.webp`, true),
    loadTex(`assets/tex/${n}_nor_512.webp`),
    loadTex(`assets/tex/${n}_arm_512.webp`),
  ])));
  const skyJob = loadTex('assets/sky.v2.jpg', true, false);
  want++;
  const doorJob = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('assets/door.v1.glb')
    .then((g) => { tick(); return g; }, (err) => { tick(); console.warn('Door model failed to load; using a simple stand-in.', err); return null; });
  // canvas textures need the web fonts first (never wait more than ~2.5 s)
  const fontJob = Promise.race([
    Promise.all(['800 64px "Plus Jakarta Sans"', '600 64px "Plus Jakarta Sans"', '700 64px "JetBrains Mono"', '600 64px "JetBrains Mono"']
      .map((f) => document.fonts?.load(f))).catch(() => {}),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  const [sets, skyTex, gltf] = await Promise.all([texJob, skyJob, doorJob, fontJob]);
  const TX = Object.fromEntries(NAMES.map((n, i) => [n, { map: sets[i][0], normalMap: sets[i][1], arm: sets[i][2] }]));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 220);

  /* ---------- sky and image-based light: dusk sky outside, a soft studio room inside ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  let skyEnv = roomEnv;
  if (skyTex) {
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = skyTex;
    scene.backgroundIntensity = 0.85; // the sky file is graded to blue hour; keep it below the lit shop
    skyEnv = pmrem.fromEquirectangular(skyTex).texture;
  } else scene.background = new THREE.Color(0x4f5670);
  pmrem.dispose();
  scene.environment = skyEnv;
  scene.fog = new THREE.Fog(0x6f6577, 36, 120); // matches the dusk horizon at this background intensity

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
  const basic = (map, extra = {}) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, ...extra });
  const lit = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.7, envMap: roomEnv, envMapIntensity: 0.35, ...extra });
  const std = (o, env = roomEnv, envI = 0.5) => new THREE.MeshStandardMaterial({ envMap: env, envMapIntensity: envI, ...o });
  const phys = (o, env = roomEnv, envI = 0.6) => new THREE.MeshPhysicalMaterial({ envMap: env, envMapIntensity: envI, ...o });

  // real-world texture sizes (metres) from Poly Haven's metadata
  const TILE = { pave: 1.8, asphalt: 2.08, brick: 2.01, tiles: 1.9, plaster: 2.0, wood: 1.7 };
  function pbr(name, { color = 0xffffff, fallback = 0xbbbbbb, rough = 1, normal = 1, ao = 1, env = skyEnv, envI = 0.5, physical = null } = {}) {
    const t = TX[name] || {};
    const o = { color: t.map ? color : fallback, roughness: rough, metalness: 0, envMap: env, envMapIntensity: envI };
    if (t.map) o.map = t.map;
    if (t.normalMap) { o.normalMap = t.normalMap; o.normalScale = new THREE.Vector2(normal, normal); }
    if (t.arm) { o.roughnessMap = t.arm; o.aoMap = t.arm; o.aoMapIntensity = ao; }
    const m = physical ? new THREE.MeshPhysicalMaterial({ ...o, ...physical }) : new THREE.MeshStandardMaterial(o);
    m.userData.tile = TILE[name];
    return m;
  }
  // world-scale box projection, so texel density matches across pieces and joints line up
  function boxUV(geo, tile, ox = 0, oy = 0, oz = 0) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + ox, y = p.getY(i) + oy, z = p.getZ(i) + oz;
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
      uv[2 * i] = u / tile; uv[2 * i + 1] = v / tile;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // faint diagonal streaks: the cue that makes clear glass read as glass in architectural renders
  const sheenTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2); g.rotate(-0.35); g.translate(-w / 2, -h / 2);
    for (const [x, bw, a] of [[60, 46, 0.5], [128, 14, 0.4], [196, 30, 0.35]]) {
      const gr = g.createLinearGradient(x - bw, 0, x + bw, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - bw, -h, bw * 2, h * 3);
    }
  });
  const M = {
    pave: pbr('pave', { color: 0xe4e0da, fallback: 0xb9b5ae, envI: 0.16 }),
    asphalt: pbr('asphalt', { color: 0x9a9a9a, fallback: 0x4a4c50, envI: 0.16 }),
    brick: pbr('brick', { fallback: 0x8a5a48, normal: 1.3, envI: 0.12 }),
    brickN: pbr('brick', { color: 0xb3a59b, fallback: 0x7d6a60, envI: 0.12 }),
    renderN: pbr('plaster', { color: 0xdccfbd, fallback: 0xcfc3b1, normal: 0.8, envI: 0.14 }),
    concrete: pbr('plaster', { color: 0xaaa69f, fallback: 0x9e9a93, normal: 0.6, envI: 0.14 }),
    tiles: pbr('tiles', { color: 0xf0ebe3, fallback: 0xd9d4cc, normal: 0.6, ao: 0.45, env: roomEnv, envI: 0.35 }),
    wallIn: pbr('plaster', { color: 0xf1ece4, fallback: 0xeae4da, normal: 0.45, env: roomEnv, envI: 0.12 }),
    wood: pbr('wood', { color: 0xf4e8da, fallback: 0xb08a63, env: roomEnv, envI: 0.25 }),
    ceiling: std({ color: 0xf0eee9, roughness: 0.92 }, roomEnv, 0.1),
    solid: std({ color: 0xe6e2db, roughness: 0.36 }, roomEnv, 0.32),
    quartz: std({ color: 0xe8e4dd, roughness: 0.2 }, roomEnv, 0.45),
    black: std({ color: 0x1b1d20, roughness: 0.42, metalness: 0.25 }, roomEnv, 0.4),
    model: std({ color: 0xdcd7ce, roughness: 0.8 }, roomEnv, 0.2),
    model2: std({ color: 0xa9a49b, roughness: 0.55, metalness: 0.2 }, roomEnv, 0.3),
    accent: std({ color: 0xff541e, roughness: 0.5 }, roomEnv, 0.4),
    steel: std({ color: 0x2b2e33, metalness: 0.8, roughness: 0.42 }, skyEnv, 0.6),
    alu: std({ color: 0x2d3035, metalness: 0.85, roughness: 0.34 }, skyEnv, 0.7),
    header: std({ color: 0x26292d, metalness: 0.8, roughness: 0.38 }, skyEnv, 0.6),
    chrome: std({ color: 0xdfe3e6, metalness: 1, roughness: 0.14 }, roomEnv, 1.0),
    paint: std({ color: 0xe7e4dc, roughness: 0.6 }, skyEnv, 0.15),
    panel: std({ color: 0x1c1f23, metalness: 0.55, roughness: 0.32 }, skyEnv, 0.55),
    winGlass: std({ color: 0x10161d, roughness: 0.05, metalness: 0.1 }, skyEnv, 0.9),
    winLit: std({ color: 0x1a140e, emissive: 0xffbf85, emissiveIntensity: 0.42, roughness: 0.15 }, skyEnv, 0.6),
    shopLit: std({ color: 0x17120d, emissive: 0xffb877, emissiveIntensity: 0.3, roughness: 0.1 }, skyEnv, 0.7),
    glass: std({ color: 0xc6d3da, map: sheenTex, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }, skyEnv, 1.2),
    doorGlass: std({ color: 0xbccbd4, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }, skyEnv, 1.1),
    vitrine: std({ color: 0xffffff, map: sheenTex, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }, roomEnv, 1.6),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff3e0, toneMapped: false }),
  };

  function add(mesh, parent = scene, cast = true, receive = true) {
    mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
  }
  function block(w, h, d, m, x, y, z, { parent = scene, cast = true, receive = true } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (m.userData?.tile) boxUV(geo, m.userData.tile, x, y, z);
    const mesh = add(new THREE.Mesh(geo, m), parent, cast, receive);
    mesh.position.set(x, y, z);
    return mesh;
  }
  function rounded(w, h, d, r, m, x, y, z, { parent = scene, cast = true } = {}) {
    const geo = new RoundedBoxGeometry(w, h, d, 3, r);
    if (m.userData?.tile) boxUV(geo, m.userData.tile, x, y, z);
    const mesh = add(new THREE.Mesh(geo, m), parent, cast);
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
  const glowTex = radial('rgba(255,200,140,0.9)', 'rgba(255,200,140,0)');
  const shadowTex = radial('rgba(20,16,12,0.6)', 'rgba(20,16,12,0)');
  const glow = (w, d, x, z, opacity = 0.5, y = 0.008) => plane(w, d, basic(glowTex, { blending: THREE.AdditiveBlending, opacity }), x, y, z, { rx: -Math.PI / 2 });
  const contact = (w, d, x, z, opacity = 0.32) => plane(w, d, basic(shadowTex, { opacity, toneMapped: true }), x, 0.006, z, { rx: -Math.PI / 2 });
  const aoTex = canvasTex(8, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(30,24,18,0.34)'); gr.addColorStop(1, 'rgba(30,24,18,0)');
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
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  /* ---------- light: cool dusk sky, warm 3000 K shop ---------- */
  const WARM = 0xffb873; // ~2600-2700 K practicals
  scene.add(new THREE.HemisphereLight(0x8fa0d0, 0x2e2b28, 0.2));
  const key = new THREE.DirectionalLight(0x8ea2d8, 0.45); // cool skylight, no sun at blue hour
  key.position.set(-11, 14, 12);
  key.target.position.set(0, 0, -3);
  key.castShadow = true;
  const sm = lite ? 1024 : 2048;
  key.shadow.mapSize.set(sm, sm);
  Object.assign(key.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  for (const [x, y, z, i] of [[0, 3.6, -3.0, 15], [-0.6, 3.6, -10.2, 12]]) { // soft general fill
    const l = new THREE.PointLight(WARM, i, 12, 1.8);
    l.position.set(x, y, z);
    scene.add(l);
  }
  // accent spots: each exhibit gets its own pool of light (no shadows, except the featured one)
  for (const [px, pz, tx, ty, tz, i, a] of [
    [-2.6, -3.6, -3.9, 1.0, -4.6, 42, 0.45],   // kiosk
    [4.0, -7.6, 5.9, 1.0, -7.6, 48, 0.62],     // shelf wall
    [0.2, -9.6, 0.8, 0.9, -11.0, 46, 0.45],    // plant model
    [-3.4, -11.4, -3.6, 1.6, -14.3, 40, 0.62], // credentials wall + checkout
  ]) {
    const l = new THREE.SpotLight(0xffc88f, i * 1.35, 9, a, 0.85, 1.6);
    l.position.set(px, 3.85, pz);
    l.target.position.set(tx, ty, tz);
    scene.add(l, l.target);
  }
  const spot = new THREE.SpotLight(0xffd6ad, 78, 9, 0.42, 0.7, 1.4); // gallery spot on the featured display
  spot.position.set(1.6, 3.85, -2.2);
  spot.target.position.set(2.8, 0.5, -3.8);
  spot.castShadow = !lite;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0005;
  spot.shadow.radius = 3;
  scene.add(spot, spot.target);
  const canopyLight = new THREE.PointLight(WARM, 14, 5.5, 1.6);
  canopyLight.position.set(0, 2.72, 0.8);
  scene.add(canopyLight);

  /* ---------- street ---------- */
  block(40, 0.15, 6.4, M.pave, 0, -0.075, 3.2, { cast: false });
  block(40, 0.16, 0.3, M.concrete, 0, -0.07, 6.55, { cast: false });
  block(40, 0.1, 22, M.asphalt, 0, -0.2, 17.7, { cast: false });
  for (let x = -18; x <= 18; x += 4.5) block(2.2, 0.01, 0.13, M.paint, x, -0.146, 13.4, { cast: false });
  block(40, 0.01, 0.1, M.paint, 0, -0.146, 7.5, { cast: false });

  // neighbouring buildings: brick on the left, painted render on the right, real windows
  function neighbour(cx, w, h, front, wallMat, sign) {
    block(w, h, 10, wallMat, cx, h / 2, front - 5);
    block(w + 0.2, 0.14, 0.4, M.concrete, cx, h + 0.07, front - 0.1);
    block(w - 1.3, 2.62, 0.04, M.steel, cx, 1.4, front + 0.005, { cast: false });
    block(w - 1.4, 2.5, 0.05, sign ? M.shopLit : M.winGlass, cx, 1.4, front + 0.015, { cast: false });
    if (sign) {
      block(w - 1.2, 0.5, 0.1, M.panel, cx, 2.95, front + 0.05);
      plane(Math.min(3.4, w - 2), 0.3, new THREE.MeshStandardMaterial({
        map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.8, transparent: true, depthWrite: false,
      }), cx, 2.95, front + 0.104);
    }
    const rows = Math.floor((h - 3.6) / 2.1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        const x = cx - w / 2 + 1.5 + (c * (w - 3)) / 2, y = 4.35 + r * 2.1;
        block(1.4, 1.6, 0.03, M.steel, x, y, front + 0.005, { cast: false });
        block(1.25, 1.45, 0.03, rnd() < 0.35 ? M.winLit : M.winGlass, x, y, front + 0.02, { cast: false });
        block(1.5, 0.07, 0.18, M.concrete, x, y - 0.83, front + 0.07);
      }
    }
  }
  const cafeSign = canvasTex(1024, 90, (g, w) => {
    g.textAlign = 'center'; g.fillStyle = '#ffe7c7'; g.shadowColor = 'rgba(255,200,140,0.8)'; g.shadowBlur = 10;
    g.font = '700 58px Georgia, serif'; spacing(g, 16); g.fillText('CAFÉ · BAKERY', w / 2, 66);
  });
  neighbour(-10.9, 8.2, 7.4, -0.7, M.brickN, cafeSign);
  neighbour(10.8, 8.0, 5.8, -0.2, M.renderN, null);

  // street lamp with a warm pool of light
  {
    const lamp = new THREE.Group();
    lamp.position.set(6.3, 0, 5.8); scene.add(lamp);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 4.4, 16), M.steel), lamp).position.y = 2.2;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.42, 16), M.steel), lamp).position.y = 0.21;
    rounded(0.95, 0.06, 0.08, 0.025, M.steel, -0.44, 4.36, 0, { parent: lamp });
    rounded(0.48, 0.1, 0.26, 0.03, M.steel, -0.86, 4.3, 0, { parent: lamp });
    plane(0.4, 0.2, M.lamp, -0.86, 4.248, 0, { parent: lamp, rx: Math.PI / 2 });
    const l = new THREE.PointLight(0xe4ebff, 60, 14, 1.5); // cool LED street lamp
    l.position.set(-0.86, 4.1, 0); lamp.add(l);
    glow(5, 5, 5.45, 5.6, 0.32);
  }

  /* ---------- storefront (facade plane z = 0, outside is +z) ---------- */
  const H = 4.6, W = 13, T = 0.3;
  block(W, H - 2.74, T, M.brick, 0, 2.74 + (H - 2.74) / 2, -T / 2);
  block(W + 0.3, 0.12, 0.44, M.concrete, 0, H + 0.06, -0.1);
  for (const sx of [-1, 1]) {
    block(0.5, 2.74, T, M.brick, sx * 6.25, 1.37, -T / 2);
    block(0.56, 2.74, T, M.brick, sx * 2.72, 1.37, -T / 2);
    block(3.0, 0.55, T, M.brick, sx * 4.5, 0.275, -T / 2);
    block(3.06, 0.06, 0.36, M.concrete, sx * 4.5, 0.565, -0.12);
    block(0.06, 2.12, 0.12, M.alu, sx * 4.5, 0.6 + 1.06, -0.15);
    block(3.0, 0.07, 0.12, M.alu, sx * 4.5, 2.705, -0.15);
    block(3.0, 0.07, 0.12, M.alu, sx * 4.5, 0.63, -0.15);
    for (const jx of [-1.465, 1.465]) block(0.07, 2.14, 0.12, M.alu, sx * 4.5 + jx, 0.6 + 1.07, -0.15);
    plane(3.0, 2.19, M.glass, sx * 4.5, 0.55 + 1.095, -0.13);
  }
  // sign band: dark composite panel with halo-lit letters
  block(7.7, 1.16, 0.12, M.panel, 0, 3.72, 0.06);
  const signTex = canvasTex(2048, 310, (g, w) => {
    g.textAlign = 'center';
    g.shadowColor = 'rgba(255,214,170,0.75)'; g.shadowBlur = 18;
    g.fillStyle = '#fffaf2'; g.font = '800 150px "Plus Jakarta Sans", sans-serif'; spacing(g, 14);
    g.fillText('USMAN SALEEM', w / 2, 160);
    g.shadowBlur = 16;
    g.fillStyle = '#ff6a35'; g.fillRect(w / 2 - 70, 194, 140, 9);
    g.fillStyle = 'rgba(255,240,225,0.86)'; g.font = '800 62px "JetBrains Mono", monospace'; spacing(g, 18);
    g.fillText('MECHANICAL ENGINEER', w / 2, 276);
  });
  plane(7.3, (7.3 * 310) / 2048, new THREE.MeshStandardMaterial({
    map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.8,
    transparent: true, depthWrite: false, roughness: 0.5,
  }), 0, 3.72, 0.123);
  // cantilevered steel canopy over the entrance, with downlights
  block(4.9, 0.12, 1.25, M.steel, 0, 2.93, 0.62);
  block(4.9, 0.2, 0.05, M.steel, 0, 2.92, 1.245);
  for (const x of [-1.6, 0, 1.6]) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), M.lamp);
    d.rotation.x = Math.PI / 2; d.position.set(x, 2.868, 0.75); scene.add(d);
    const trim = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 32), M.black); // recessed-fixture trim
    trim.rotation.x = Math.PI / 2; trim.position.set(x, 2.867, 0.75); scene.add(trim);
  }
  // window vinyl: white lettering on the glass
  const vinylTex = canvasTex(1024, 380, (g) => {
    g.fillStyle = '#ff6a35'; g.beginPath(); g.arc(42, 66, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.93)'; g.font = '800 88px "JetBrains Mono", monospace'; g.textBaseline = 'middle';
    g.fillText('50+ PROJECTS', 80, 68); g.fillText('IN FLIGHT', 80, 172);
    g.font = '600 36px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(255,255,255,0.78)';
    g.fillText('COMMERCIAL ENTRANCES · CANADA', 82, 278);
  });
  plane(2.3, (2.3 * 380) / 1024, lit(vinylTex, { envMap: skyEnv }), -4.5, 2.1, -0.11);
  const hoursTex = canvasTex(1024, 430, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.93)'; g.font = '800 66px "JetBrains Mono", monospace';
    g.fillText('HOURS', 40, 86);
    g.font = '600 44px "JetBrains Mono", monospace';
    g.fillText('FIELD WORK ....... MON–FRI', 40, 190);
    g.fillText('AUTOMATIONS ......... 24/7', 40, 262);
    g.fillStyle = '#ff8a5c'; g.font = '700 44px "JetBrains Mono", monospace';
    g.fillText('WALK-INS WELCOME', 40, 360);
  });
  plane(2.3, (2.3 * 430) / 1024, lit(hoursTex, { envMap: skyEnv }), 4.5, 2.0, -0.11);
  // concrete planters with clipped boxwood
  {
    const leafNor = TX.asphalt.normalMap ? TX.asphalt.normalMap.clone() : null;
    if (leafNor) { leafNor.repeat.set(1.2, 0.6); leafNor.needsUpdate = true; }
    const boxwood = std({ color: 0x40592c, roughness: 0.88, normalMap: leafNor, normalScale: new THREE.Vector2(2.4, 2.4) }, skyEnv, 0.35);
    const soil = std({ color: 0x2a2119, roughness: 1 }, skyEnv, 0.2);
    for (const sx of [-1, 1]) {
      const x = sx * 3.55;
      block(0.95, 0.55, 0.6, M.concrete, x, 0.275, 0.62);
      block(0.85, 0.02, 0.5, soil, x, 0.545, 0.62, { cast: false });
      const geo = new THREE.IcosahedronGeometry(0.34, 5);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + (Math.sin(p.getX(i) * 23 + p.getY(i) * 17) * Math.cos(p.getZ(i) * 19)) * 0.04;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const b = add(new THREE.Mesh(geo, boxwood));
      b.position.set(x, 0.82, 0.62); b.scale.set(1.25, 0.82, 0.78);
      contact(1.5, 1.0, x, 0.62, 0.3);
    }
  }
  // facade uplights wash the outer brick piers (desktop only; phones skip the extra lights)
  if (!lite) {
    for (const sx of [-1, 1]) {
      const u = new THREE.SpotLight(0xffe0c0, 28, 6.5, 0.3, 0.9, 1.4);
      u.position.set(sx * 6.25, 0.08, 0.5);
      u.target.position.set(sx * 6.25, 4.6, 0.0);
      scene.add(u, u.target);
      block(0.18, 0.06, 0.12, M.steel, sx * 6.25, 0.03, 0.5, { cast: false });
    }
  }

  // header sensor + illustrative detection zone
  rounded(0.34, 0.07, 0.09, 0.015, M.black, 0, 2.19, -0.03);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), ledMat);
  led.position.set(0.11, 2.19, 0.018); scene.add(led);
  const zoneMat = new THREE.MeshBasicMaterial({ color: 0xff541e, transparent: true, opacity: 0.1, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff541e, transparent: true, opacity: 0.5, depthWrite: false });
  const CLEAN = new URLSearchParams(location.search).has('clean'); // share-image captures: no sensor-zone graphics
  const pulseMat = new THREE.MeshBasicMaterial({ color: 0xff541e, transparent: true, opacity: 0, depthWrite: false });
  const zoneGroup = new THREE.Group();
  zoneGroup.position.set(0, 0.007, -0.02); zoneGroup.scale.set(1, 1, 1.45); scene.add(zoneGroup); zoneGroup.visible = !CLEAN;
  for (const [geo, m] of [
    [new THREE.CircleGeometry(2.3, 64, Math.PI, Math.PI), zoneMat],
    [new THREE.RingGeometry(2.19, 2.3, 64, 1, Math.PI, Math.PI), ringMat],
  ]) { const z = new THREE.Mesh(geo, m); z.rotation.x = -Math.PI / 2; zoneGroup.add(z); }
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.0, 64, 1, Math.PI, Math.PI), pulseMat);
  pulse.rotation.x = -Math.PI / 2; zoneGroup.add(pulse);
  // the sensor's field as a faint light cone (illustrative), from the sensor down to the floor zone
  const coneAlpha = canvasTex(4, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#5a5a5a'); gr.addColorStop(1, '#0d0d0d');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  coneAlpha.colorSpace = THREE.NoColorSpace;
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xff7a3d, alphaMap: coneAlpha, transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  {
    const n = 40, R = 2.3, SZ = 1.45, top = 2.16, pos = [0, 0, 0], uv = [0.5, 1], idx = [];
    for (let i = 0; i <= n; i++) {
      const a = (Math.PI * i) / n;
      pos.push(Math.cos(a) * R, -top, Math.sin(a) * R * SZ);
      uv.push(i / n, 0);
      if (i) idx.push(0, i, i + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const cone = new THREE.Mesh(geo, coneMat);
    cone.position.set(0, top, 0); cone.renderOrder = 2; cone.visible = !CLEAN; scene.add(cone);
  }
  glow(5.5, 3.6, 0, 1.9, 0.28);
  for (const sx of [-1, 1]) glow(4.2, 2.6, sx * 4.5, 1.3, 0.16); // warm spill from the side windows
  plane(2.3, 0.234, basic(canvasTex(1024, 104, (g, w) => {
    g.fillStyle = '#ff6a35'; g.font = '800 58px "JetBrains Mono", monospace'; g.textAlign = 'center'; spacing(g, 6);
    g.fillText('SENSOR ZONE · ILLUSTRATIVE', w / 2, 72);
  }), { opacity: 0.85 }), 0, 0.01, 1.32, { rx: -Math.PI / 2 }).visible = !CLEAN;

  /* ---------- interior shell: tiled floor, plaster walls, ceiling with downlights ---------- */
  const CEIL = 3.9;
  block(13, 0.12, 14.6, M.tiles, 0, -0.06, -7.3, { cast: false });
  block(T, H, 14.3, M.wallIn, -6.35, H / 2, -7.45);
  block(T, H, 14.3, M.wallIn, 6.35, H / 2, -7.45);
  block(W, H, T, M.wallIn, 0, H / 2, -14.45);
  block(12.4, 0.12, 14.3, M.ceiling, 0, CEIL + 0.06, -7.45);
  block(12.4, 0.09, 0.02, M.black, 0, 0.045, -14.29, { cast: false });
  for (const sx of [-1, 1]) block(0.02, 0.09, 14.0, M.black, sx * 6.19, 0.045, -7.3, { cast: false });
  {
    const spots = [];
    for (const x of [-4.2, -1.4, 1.4, 4.2]) for (const z of [-1.5, -4.3, -7.1, -9.9, -12.7]) spots.push([x, z]);
    const disc = new THREE.CircleGeometry(0.075, 20); disc.rotateX(Math.PI / 2);
    const ring = new THREE.RingGeometry(0.075, 0.1, 24); ring.rotateX(Math.PI / 2);
    const discs = new THREE.InstancedMesh(disc, M.lamp, spots.length);
    const rings = new THREE.InstancedMesh(ring, std({ color: 0xcfd2d5, metalness: 0.6, roughness: 0.3 }), spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      discs.setMatrixAt(i, m4.makeTranslation(x, CEIL - 0.002, z));
      rings.setMatrixAt(i, m4.makeTranslation(x, CEIL - 0.001, z));
    });
    scene.add(discs, rings);
  }
  aoStrip(14.1, -5.85, -7.35, Math.PI / 2);
  aoStrip(14.1, 5.85, -7.35, -Math.PI / 2);
  aoStrip(12.4, 0, -13.95, 0);
  glow(6, 6, 0, -2.6, 0.1); glow(6, 6, 0.5, -8.0, 0.09); glow(5, 5, -3.0, -12.0, 0.09);

  /* ---------- stop 1: featured display (door model on a turntable) ---------- */
  const FEAT_FACE = -0.688; // plinth front faces the featured camera stop
  const feat = new THREE.Group();
  feat.position.set(2.8, 0, -3.8); scene.add(feat);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.16, 0.42, 64), M.solid), feat).position.y = 0.21;
  const turn = new THREE.Group();
  turn.position.y = 0.42; feat.add(turn);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.035, 64), M.wood), turn).position.y = 0.0175;
  plane(2.3, 0.55, basic(shadowTex, { opacity: 0.55, toneMapped: true }), 0, 0.037, 0, { parent: turn, rx: -Math.PI / 2 });
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
  rounded(0.72, 1.02, 0.52, 0.05, M.solid, 0, 0.51, 0, { parent: kiosk });
  rounded(0.16, 0.3, 0.16, 0.03, M.black, 0, 1.15, -0.05, { parent: kiosk });
  // The kiosk runs the audit race: Insight Collector clears a 15-door store while the manual
  // portal crawl is still on door 1. A simulation at 3x speed using the case-study times (~3 h vs 15 s).
  const RACE = { APP_S: 15, MANUAL_S: 3 * 3600, SPEED: 3 };
  const still = !S.motion || CLEAN;
  const KS = { phase: still ? 'done' : 'idle', t: still ? RACE.APP_S : 0, auto: false, delay: 0, acc: 0 };
  S.kiosk = KS; // test hook
  const hms = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const MONO = '"JetBrains Mono", monospace';
  const STEPS = ['INVOICES', 'SERVICE CALLS', 'DOOR CONDITIONS', 'TAKE-OFF'];
  const pillPath = (g, x, y, w, h) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, h / 2); else g.rect(x, y, w, h); };
  function doorRow(g, y, done, partial, col) {
    for (let i = 0; i < 15; i++) {
      const x = 48 + i * 62;
      if (i < done) {
        g.fillStyle = col; g.fillRect(x, y, 50, 50);
        g.strokeStyle = '#15191d'; g.lineWidth = 7;
        g.beginPath(); g.moveTo(x + 12, y + 26); g.lineTo(x + 22, y + 36); g.lineTo(x + 39, y + 15); g.stroke();
      } else {
        g.strokeStyle = '#3a424b'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, 47, 47);
        if (i === done && partial > 0) {
          const f = Math.max(3, 47 * Math.min(1, partial));
          g.globalAlpha = 0.6; g.fillStyle = col; g.fillRect(x + 1.5, y + 48.5 - f, 47, f); g.globalAlpha = 1;
        }
      }
    }
  }
  function drawKiosk(g, w, h) {
    const t = KS.t, appDone = t >= RACE.APP_S, n = Math.min(15, Math.floor(t));
    g.textAlign = 'left';
    g.fillStyle = '#15191d'; g.fillRect(0, 0, w, h);
    spacing(g, 2); g.fillStyle = '#e9edf1'; g.font = `800 38px ${MONO}`;
    g.fillText('STORE AUDIT · 15 DOORS', 48, 76);
    spacing(g, 1); g.font = `800 26px ${MONO}`;
    const pw = g.measureText('SIMULATION').width + 40;
    g.fillStyle = '#ff541e'; pillPath(g, w - 48 - pw, 42, pw, 46); g.fill();
    g.fillStyle = '#15191d'; g.fillText('SIMULATION', w - 48 - pw + 20, 74);
    // lane A: Insight Collector
    g.fillStyle = '#35d07f'; g.font = `800 46px ${MONO}`; g.fillText('INSIGHT COLLECTOR', 48, 172);
    g.textAlign = 'right'; g.fillStyle = '#ff541e'; g.font = `800 96px ${MONO}`;
    g.fillText(`0:${String(n).padStart(2, '0')}`, w - 48, 196); g.textAlign = 'left';
    doorRow(g, 214, n, appDone ? 0 : t % 1, '#35d07f');
    g.font = `700 34px ${MONO}`;
    if (appDone) { g.fillStyle = '#35d07f'; g.fillText('ROI · TAKE-OFF · PROPOSAL READY ✓', 48, 310); }
    else if (t > 0) { g.fillStyle = '#c3cad2'; g.fillText(`DOOR ${n + 1} OF 15 · ${STEPS[Math.floor((t % 1) * 4)]}`, 48, 310); }
    else { g.fillStyle = '#8a939c'; g.fillText('READY TO RUN', 48, 310); }
    g.fillStyle = '#262c33'; g.fillRect(48, 344, w - 96, 3);
    // lane B: the manual portal crawl, ~12 min per door
    g.fillStyle = '#c3cad2'; g.font = `800 46px ${MONO}`; g.fillText('MANUAL PORTAL CRAWL', 48, 412);
    g.textAlign = 'right'; g.fillStyle = '#e9edf1'; g.font = `800 60px ${MONO}`; g.fillText(hms(t), w - 48, 414); g.textAlign = 'left';
    doorRow(g, 444, 0, t / (RACE.MANUAL_S / 15), '#9aa3ad');
    g.font = `700 34px ${MONO}`; g.fillStyle = '#c3cad2';
    g.fillText(`DOOR 1 OF 15 · ${((100 * t) / RACE.MANUAL_S).toFixed(1)}%`, 48, 540);
    if (t > 0) { g.textAlign = 'right'; g.fillStyle = '#ff8a5c'; g.fillText(`${hms(RACE.MANUAL_S - t)} TO GO`, w - 48, 540); g.textAlign = 'left'; }
    spacing(g, 0); g.fillStyle = '#6f7983'; g.font = `600 22px ${MONO}`;
    g.fillText('Case-study times: ~3 h by hand vs 15 s · shown at 3× speed', 48, 606);
  }
  const kioskTex = canvasTex(1024, 640, drawKiosk);
  const redrawKiosk = () => { drawKiosk(kioskTex.image.getContext('2d'), 1024, 640); kioskTex.needsUpdate = true; };
  function startRace() {
    KS.delay = 0;
    if (S.motion && !CLEAN) { KS.phase = 'run'; KS.t = 0; KS.acc = 0; } else { KS.phase = 'done'; KS.t = RACE.APP_S; }
    redrawKiosk(); S.dirty = true;
  }
  function updateKiosk(dt) {
    if (S.active === 3 && Math.abs(S.u - 3) < 0.03 && !KS.auto && KS.phase === 'idle') { KS.auto = true; KS.delay = 0.45; } // first visit runs by itself
    if (KS.delay > 0) { KS.delay -= dt; if (KS.delay <= 0) startRace(); return true; }
    if (KS.phase !== 'run') return false;
    if (!S.motion) { KS.t = RACE.APP_S; KS.phase = 'done'; redrawKiosk(); return true; }
    KS.t = Math.min(RACE.APP_S, KS.t + dt * RACE.SPEED);
    KS.acc += dt;
    if (KS.t >= RACE.APP_S) { KS.phase = 'done'; redrawKiosk(); }
    else if (KS.acc >= 1 / 30) { KS.acc = 0; redrawKiosk(); }
    return true;
  }
  const screen = new THREE.Group();
  screen.position.set(0, 1.42, 0); screen.rotation.x = -0.26; kiosk.add(screen);
  rounded(1.02, 0.66, 0.07, 0.02, M.black, 0, 0, 0, { parent: screen });
  plane(0.94, 0.585, basic(kioskTex, { transparent: false, depthWrite: true, toneMapped: true, color: 0xd8d8d8 }), 0, 0, 0.037, { parent: screen });
  const tagTex = canvasTex(512, 300, (g, w, h) => {
    g.fillStyle = '#ff541e';
    g.beginPath(); g.moveTo(70, 0); g.lineTo(w - 16, 0); g.quadraticCurveTo(w, 0, w, 16); g.lineTo(w, h - 16); g.quadraticCurveTo(w, h, w - 16, h); g.lineTo(70, h); g.lineTo(0, h / 2); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(52, h / 2, 14, 0, Math.PI * 2); g.fill();
    g.font = '700 46px "JetBrains Mono", monospace'; g.fillText('WAS 3 HRS', 100, 110);
    g.fillRect(100, 92, 250, 5);
    g.font = '800 64px "JetBrains Mono", monospace'; g.fillText('NOW 15 SEC', 100, 210);
  });
  const tag = plane(0.34, 0.2, lit(tagTex), 0.1, 0.74, 0.262, { parent: kiosk }); // promo sticker on the kiosk front
  tag.rotation.z = -0.06;
  contact(1.5, 1.3, -3.9, -4.6, 0.32);
  // one button for every hands-on exhibit, placed under the exhibit's screen from the scene
  const exhibits = {}; // stop index -> { st, start, idle, anchor(v) }
  exhibits[3] = { st: KS, start: () => startRace(), idle: 'Run the audit', anchor: (v) => screen.localToWorld(v.set(0, -0.42, 0.04)) };
  const runBtn = $('.wk-run'), runAt = new THREE.Vector3();
  let runShown = false;
  runBtn?.addEventListener('click', () => exhibits[S.active]?.start());
  function updateRunBtn() {
    if (!runBtn) return;
    const ex = exhibits[S.active];
    const sheetOpen = isSmall() && !!document.querySelector('main .card.is-open'); // the phone sheet owns that space
    const want = !!ex && !CLEAN && S.ready && S.motion && !sheetOpen && Math.abs(S.u - S.active) < 0.05;
    if (want !== runShown) { runShown = want; runBtn.hidden = !want; }
    if (!want) return;
    ex.anchor(runAt).project(camera);
    runBtn.style.transform = `translate3d(${(((runAt.x + 1) / 2) * innerWidth).toFixed(1)}px, ${(((1 - runAt.y) / 2) * innerHeight).toFixed(1)}px, 0) translateX(-50%)`;
    const st = ex.st.phase === 'run' || ex.st.delay > 0 ? 'run' : ex.st.phase;
    const key = `${S.active}:${st}`;
    if (runBtn.dataset.key !== key) {
      runBtn.dataset.key = key; runBtn.dataset.state = st;
      runBtn.innerHTML = st === 'run' ? `<span aria-hidden="true">●</span> ${ex.running || 'Running · 3× speed'}`
        : st === 'done' ? '<span aria-hidden="true">↻</span> Run it again' : `<span aria-hidden="true">▶</span> ${ex.idle}`;
      runBtn.disabled = st === 'run';
    }
  }
  // framed print on the wall beside the kiosk, so the corner isn't a blank plane
  {
    const printTex = canvasTex(600, 800, (g) => {
      g.fillStyle = '#f6f2ea'; g.fillRect(0, 0, 600, 800);
      g.fillStyle = '#ff541e'; g.fillRect(56, 64, 72, 9);
      g.fillStyle = '#14171a'; g.font = '800 66px "Plus Jakarta Sans", sans-serif';
      g.fillText('One pass.', 56, 160); g.fillText('Every door.', 56, 236);
      g.fillStyle = '#3d434a'; g.font = '700 25px "JetBrains Mono", monospace'; spacing(g, 2);
      ['01  WALK THE STORE', '02  SCAN · MEASURE · PHOTO', '03  TAKE-OFF + PROPOSAL'].forEach((t, i) => g.fillText(t, 56, 318 + i * 50));
      spacing(g, 0);
      g.strokeStyle = '#14171a'; g.lineWidth = 5;
      g.strokeRect(80, 500, 440, 230); g.strokeRect(80, 500, 440, 42);
      g.lineWidth = 3; g.strokeStyle = 'rgba(20,23,26,0.45)';
      g.strokeRect(110, 560, 180, 160); g.strokeRect(310, 560, 180, 160);
      g.fillStyle = '#ff541e';
      for (const [x, d] of [[250, -1], [350, 1]]) { g.beginPath(); g.moveTo(x + 26 * d, 640); g.lineTo(x, 622); g.lineTo(x, 658); g.closePath(); g.fill(); }
    });
    const fr = new THREE.Group();
    fr.position.set(-6.18, 1.68, -8.6); fr.rotation.y = Math.PI / 2; scene.add(fr);
    rounded(0.98, 1.28, 0.035, 0.006, M.black, 0, 0, 0, { parent: fr, cast: false });
    plane(0.9, 1.2, lit(printTex, { transparent: false, depthWrite: true }), 0, 0, 0.019, { parent: fr });
  }

  /* ---------- stop 3: key-accounts shelf + QBR screen ---------- */
  const shelf = new THREE.Group();
  shelf.position.set(5.78, 0, -7.6); shelf.rotation.y = -Math.PI / 2; scene.add(shelf);
  rounded(3.2, 0.12, 0.58, 0.01, M.black, 0, 0.06, 0, { parent: shelf });
  rounded(3.2, 1.62, 0.04, 0.01, M.wood, 0, 0.81, -0.28, { parent: shelf });
  for (const y of [0.42, 0.82, 1.22]) rounded(3.2, 0.035, 0.52, 0.008, M.wood, 0, y, -0.02, { parent: shelf });
  for (const x of [-1.62, 1.62]) block(0.035, 1.66, 0.56, M.black, x, 0.83, -0.02, { parent: shelf });
  {
    const looks = [
      ['#f4f1ea', '#ff541e', '#14171a', 'SL500', 'RETROFIT KIT', 0xf4f1ea],
      ['#1d2024', '#35d07f', '#f4f1ea', 'SENSOR', 'PRESENCE · 24 V', 0x1d2024],
      ['#c7a57b', '#14171a', '#14171a', 'TAKE-OFF', 'FIELD PACK', 0xc7a57b],
      ['#ffffff', '#2f6fde', '#14171a', 'QBR', '8 SLIDES · 7 s', 0xffffff],
      ['#e9e2d4', '#14171a', '#14171a', 'ROLLERS', '4 × TRACK SET', 0xe9e2d4],
      ['#2f3a45', '#ff8a5c', '#f4f1ea', 'PULLEY', 'DRIVE · SPARE', 0x2f3a45],
    ].map(([bg, band, ink, a, b, side]) => {
      const t = canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        g.fillStyle = band; g.fillRect(0, h * 0.6, w, h * 0.12);
        g.fillStyle = ink; g.textAlign = 'center';
        g.font = '800 50px "Plus Jakarta Sans", sans-serif'; g.fillText(a, w / 2, h * 0.43);
        g.font = '700 21px "JetBrains Mono", monospace'; g.fillText(b, w / 2, h * 0.88);
      });
      const s = std({ color: side, roughness: 0.75 }, roomEnv, 0.2);
      const f = std({ map: t, roughness: 0.6 }, roomEnv, 0.2);
      return [s, s, s, s, f, s];
    });
    for (const y0 of [0.12, 0.4375, 0.8375, 1.2375]) {
      let x = -1.52;
      for (;;) {
        const w = 0.16 + rnd() * 0.2, h = 0.15 + rnd() * 0.17, d = 0.22 + rnd() * 0.14;
        if (x + w > 1.55) break;
        const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.006), looks[Math.floor(rnd() * looks.length)]);
        m.position.set(x + w / 2, y0 + h / 2, -0.04 + (rnd() - 0.5) * 0.05);
        m.rotation.y = (rnd() - 0.5) * 0.09;
        add(m, shelf, false, true);
        x += w + 0.035 + rnd() * 0.05;
      }
    }
  }
  // The QBR screen runs the pipeline: field photos -> take-off -> lead package (~24 s), then an
  // 8-slide QBR deck (~7 s). A simulation at 3x speed using the tool's typical times.
  const PIPE = { SPEED: 3, END: 31, marks: [0, 6, 14, 24, 31] };
  const PIPE_STEPS = ['PHOTOS', 'TAKE-OFF', 'LEAD', 'QBR DECK']; // short, so the chips can use big type
  const PIPE_SAY = ['field photos', 'take-off', 'lead package', 'QBR deck'];
  const QS = { phase: still ? 'done' : 'idle', t: still ? PIPE.END : 0, auto: false, delay: 0, acc: 0 };
  S.qbr = QS; // test hook
  const pipeStep = (t) => (t >= PIPE.END ? 4 : t >= 24 ? 3 : t >= 14 ? 2 : t >= 6 ? 1 : 0);
  function drawQbr(g, w, h) {
    const t = QS.t, step = pipeStep(t), INK = '#14171a', MUTED = '#5b6168', OR = '#ff541e', GR = '#1f9d5b';
    g.textAlign = 'left'; spacing(g, 0);
    g.fillStyle = '#f7f4ee'; g.fillRect(0, 0, w, h);
    spacing(g, 1); g.fillStyle = INK; g.font = `800 32px ${MONO}`; g.fillText('REPLACEMENT LEAD → QBR', 40, 62);
    g.font = `800 22px ${MONO}`;
    const pw = g.measureText('SIMULATION').width + 34;
    g.fillStyle = OR; pillPath(g, w - 40 - pw, 34, pw, 40); g.fill();
    g.fillStyle = '#ffffff'; g.fillText('SIMULATION', w - 40 - pw + 17, 62);
    // pipeline chips
    for (let i = 0; i < 4; i++) {
      const x = 40 + i * 246, y = 92, cw = 206, ch = 54, done = step > i, active = step === i && t > 0;
      g.fillStyle = done ? GR : active ? INK : '#ffffff'; pillPath(g, x, y, cw, ch); g.fill();
      if (!done && !active) { g.strokeStyle = '#9aa2ab'; g.lineWidth = 3; pillPath(g, x + 1.5, y + 1.5, cw - 3, ch - 3); g.stroke(); }
      g.font = `800 28px ${MONO}`; g.textAlign = 'center';
      g.fillStyle = done || active ? '#ffffff' : '#4a525b'; g.fillText((done ? '✓ ' : '') + PIPE_STEPS[i], x + cw / 2, y + 37);
      if (active) { const k = (t - PIPE.marks[i]) / (PIPE.marks[i + 1] - PIPE.marks[i]); g.fillStyle = OR; g.fillRect(x + 24, y + ch - 10, (cw - 48) * k, 4); }
      if (i < 3) { g.fillStyle = step > i ? GR : '#b8bec6'; g.font = `800 26px ${MONO}`; g.fillText('→', x + cw + 20, y + 37); }
      g.textAlign = 'left';
    }
    // artifact panel
    const P = { x: 40, y: 172, w: 560, h: 348 };
    g.fillStyle = '#ffffff'; g.fillRect(P.x, P.y, P.w, P.h);
    g.strokeStyle = 'rgba(20,23,26,0.12)'; g.lineWidth = 2; g.strokeRect(P.x, P.y, P.w, P.h);
    g.font = `700 20px ${MONO}`;
    if (t <= 0) {
      g.fillStyle = '#8a9098'; g.textAlign = 'center'; g.font = `800 26px ${MONO}`; g.fillText('READY TO RUN', P.x + P.w / 2, P.y + P.h / 2 + 9); g.textAlign = 'left';
    } else if (step === 0) {
      for (let k = 0; k < 3; k++) {
        if (t < 1 + 2 * k) break;
        const x = P.x + 34 + k * 172, y = P.y + 34 + (k % 2) * 16;
        g.fillStyle = '#ffffff'; g.fillRect(x, y, 150, 196); g.strokeStyle = '#d4d9de'; g.lineWidth = 3; g.strokeRect(x, y, 150, 196);
        g.fillStyle = '#c9d3dc'; g.fillRect(x + 10, y + 10, 130, 140);
        g.strokeStyle = '#4a525b'; g.lineWidth = 4; g.strokeRect(x + 28, y + 36, 94, 114);
        g.lineWidth = 2; g.strokeRect(x + 33, y + 41, 41, 109); g.strokeRect(x + 76, y + 41, 41, 109);
        g.fillStyle = MUTED; g.font = `700 16px ${MONO}`; g.fillText(`SITE PHOTO ${k + 1}`, x + 14, y + 178);
      }
      g.fillStyle = MUTED; g.font = `700 24px ${MONO}`; g.fillText('PHOTOS · REPORTS · SURVEYS IN', P.x + 34, P.y + P.h - 22);
    } else if (step === 1) {
      const ex = P.x + 50, ey = P.y + 36;
      g.strokeStyle = INK; g.lineWidth = 5; g.strokeRect(ex, ey, 230, 232);
      g.strokeStyle = MUTED; g.lineWidth = 2; g.strokeRect(ex + 8, ey + 30, 105, 200); g.strokeRect(ex + 117, ey + 30, 105, 200);
      g.fillStyle = '#d9dde2'; g.fillRect(ex + 2, ey + 2, 226, 26);
      g.strokeStyle = OR; g.fillStyle = OR; g.lineWidth = 3;
      if (t >= 8) { g.beginPath(); g.moveTo(ex, ey + 262); g.lineTo(ex + 230, ey + 262); g.moveTo(ex, ey + 252); g.lineTo(ex, ey + 272); g.moveTo(ex + 230, ey + 252); g.lineTo(ex + 230, ey + 272); g.stroke(); }
      if (t >= 11) { g.beginPath(); g.moveTo(ex + 256, ey); g.lineTo(ex + 256, ey + 232); g.moveTo(ex + 246, ey); g.lineTo(ex + 266, ey); g.moveTo(ex + 246, ey + 232); g.lineTo(ex + 266, ey + 232); g.stroke(); }
      g.font = `800 22px ${MONO}`; g.fillStyle = INK;
      const rows = [[8, 'W 1830 mm'], [11, 'H 2134 mm'], [13, 'QTY 2 LEAVES']];
      rows.forEach(([at, s], i) => { if (t >= at) g.fillText(s, P.x + 360, P.y + 80 + i * 56); });
    } else if (step === 2) {
      const fx = P.x + 40, fy = P.y + 70;
      g.fillStyle = OR; g.fillRect(fx, fy, 92, 26);
      g.fillStyle = '#ffd9c7'; g.fillRect(fx, fy + 22, 210, 156); g.strokeStyle = OR; g.lineWidth = 3; g.strokeRect(fx, fy + 22, 210, 156);
      g.fillStyle = INK; g.font = `800 34px ${MONO}`; g.fillText('LEAD', fx + 62, fy + 112);
      g.font = `700 21px ${MONO}`;
      ['FIELD PHOTOS', 'TAKE-OFF', 'SERVICE REPORT', 'SURVEY NOTES'].forEach((s, i) => {
        const y = P.y + 64 + i * 52, ok = t >= 15 + 2 * i;
        g.strokeStyle = ok ? GR : '#c9ced4'; g.lineWidth = 3; g.strokeRect(P.x + 290, y - 20, 26, 26);
        if (ok) { g.strokeStyle = GR; g.lineWidth = 4; g.beginPath(); g.moveTo(P.x + 295, y - 7); g.lineTo(P.x + 302, y); g.lineTo(P.x + 312, y - 15); g.stroke(); }
        g.fillStyle = ok ? INK : '#8a9098'; g.fillText(s, P.x + 328, y);
      });
      if (t >= 23) { g.fillStyle = GR; g.font = `800 24px ${MONO}`; g.fillText('PACKAGE READY ✓', P.x + 290, P.y + 300); }
    } else {
      const shown = step >= 4 ? 8 : Math.min(8, Math.floor((t - 24) / (7 / 8)));
      for (let i = 0; i < 8; i++) {
        const x = P.x + 22 + (i % 4) * 134, y = P.y + 22 + Math.floor(i / 4) * 128;
        if (i >= shown) { g.strokeStyle = '#e3e6ea'; g.lineWidth = 2; g.setLineDash([6, 6]); g.strokeRect(x, y, 120, 110); g.setLineDash([]); continue; }
        g.fillStyle = '#ffffff'; g.fillRect(x, y, 120, 110); g.strokeStyle = 'rgba(20,23,26,0.22)'; g.lineWidth = 2; g.strokeRect(x, y, 120, 110);
        g.fillStyle = INK; g.fillRect(x + 10, y + 12, 62, 8);
        for (let k = 0; k < 4; k++) {
          const bh = 14 + ((i * 7 + k * 13) % 50);
          g.fillStyle = k === i % 4 ? OR : '#c9ced4'; g.fillRect(x + 12 + k * 26, y + 98 - bh, 18, bh);
        }
      }
      g.font = `800 26px ${MONO}`;
      if (step >= 4) { g.fillStyle = GR; g.fillText('8-SLIDE DECK READY ✓', P.x + 22, P.y + P.h - 22); }
      else { g.fillStyle = MUTED; g.fillText(`BUILDING SLIDE ${Math.min(8, shown + 1)} / 8`, P.x + 22, P.y + P.h - 22); }
    }
    // timers
    const tl = Math.min(24, t), td = Math.max(0, Math.min(7, t - 24));
    g.fillStyle = MUTED; g.font = `700 22px ${MONO}`; g.fillText('LEAD PACKAGE', 650, 206);
    g.fillStyle = OR; g.font = `800 92px ${MONO}`; g.fillText(`0:${String(Math.floor(tl)).padStart(2, '0')}`, 646, 294);
    g.fillStyle = MUTED; g.font = `600 18px ${MONO}`; g.fillText('TYPICAL 20–30 s', 650, 326);
    g.fillStyle = MUTED; g.font = `700 22px ${MONO}`; g.fillText('QBR DECK · 8 SLIDES', 650, 386);
    g.fillStyle = GR; g.font = `800 92px ${MONO}`; g.fillText(`0:${String(Math.floor(td)).padStart(2, '0')}`, 646, 474);
    g.fillStyle = MUTED; g.font = `600 18px ${MONO}`; g.fillText('ABOUT 7 s', 650, 506);
    g.fillStyle = MUTED; g.font = `600 18px ${MONO}`; g.fillText('Typical times from the tool · shown at 3× speed', 40, 556);
  }
  const qbrTex = canvasTex(1024, 576, drawQbr);
  const redrawQbr = () => { drawQbr(qbrTex.image.getContext('2d'), 1024, 576); qbrTex.needsUpdate = true; };
  function startPipeline() {
    QS.delay = 0;
    if (S.motion && !CLEAN) { QS.phase = 'run'; QS.t = 0; QS.acc = 0; } else { QS.phase = 'done'; QS.t = PIPE.END; }
    redrawQbr(); S.dirty = true;
  }
  function updatePipeline(dt) {
    if (S.active === 4 && Math.abs(S.u - 4) < 0.03 && !QS.auto && QS.phase === 'idle') { QS.auto = true; QS.delay = 0.45; } // first visit runs by itself
    if (QS.delay > 0) { QS.delay -= dt; if (QS.delay <= 0) startPipeline(); return true; }
    if (QS.phase !== 'run') return false;
    if (!S.motion) { QS.t = PIPE.END; QS.phase = 'done'; redrawQbr(); return true; }
    QS.t = Math.min(PIPE.END, QS.t + dt * PIPE.SPEED);
    QS.acc += dt;
    if (QS.t >= PIPE.END) { QS.phase = 'done'; redrawQbr(); }
    else if (QS.acc >= 1 / 30) { QS.acc = 0; redrawQbr(); }
    return true;
  }
  const qbrScreen = new THREE.Group();
  qbrScreen.position.set(6.16, 2.56, -7.6); qbrScreen.rotation.y = -Math.PI / 2; scene.add(qbrScreen);
  rounded(2.0, 1.16, 0.06, 0.02, M.black, 0, 0, 0, { parent: qbrScreen });
  plane(1.92, 1.08, basic(qbrTex, { transparent: false, depthWrite: true, toneMapped: true, color: 0xcfcfcf }), 0, 0, 0.032, { parent: qbrScreen });
  exhibits[4] = { st: QS, start: startPipeline, idle: 'Run the pipeline', anchor: (v) => qbrScreen.localToWorld(v.set(0, -0.66, 0.05)) };
  contact(1.6, 3.8, 5.6, -7.6, 0.28);

  /* ---------- stop 4: plant scale model in a vitrine ---------- */
  // Hands-on: "Start the line" commissions the model section by section (intake, milling, conveying,
  // pasta line): lamps go amber then green, the rollers turn and flour flows. Illustrative, not the PFD.
  const PLANT = { END: 12, STEP: 3 };
  const PLANT_SAY = ['intake', 'milling', 'conveying', 'pasta line'];
  const PS = { phase: still ? 'done' : 'idle', t: still ? PLANT.END : 0, auto: false, delay: 0, flow: 0 };
  S.plant = PS; // test hook
  let updatePlant = () => false;
  {
    const mill = new THREE.Group();
    mill.position.set(0.8, 0, -11.0); mill.rotation.y = 0.35; scene.add(mill);
    rounded(2.1, 0.86, 1.25, 0.04, M.solid, 0, 0.43, 0, { parent: mill });
    rounded(1.9, 0.04, 1.05, 0.01, M.wood, 0, 0.88, 0, { parent: mill });
    const top = 0.9, mm = M.model;
    rounded(0.42, 0.98, 0.36, 0.01, mm, -0.45, top + 0.49, -0.12, { parent: mill });
    for (let i = 0; i < 3; i++) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.78, 28), mm), mill).position.set(0.12 + i * 0.23, top + 0.39, -0.28);
      add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 28), M.model2), mill).position.set(0.12 + i * 0.23, top + 0.82, -0.28);
    }
    rounded(0.7, 0.32, 0.44, 0.01, mm, 0.38, top + 0.16, 0.24, { parent: mill });
    const conv = rounded(0.66, 0.05, 0.1, 0.008, M.model2, -0.04, top + 0.62, -0.2, { parent: mill });
    conv.rotation.z = -0.38;
    for (const lx of [-0.24, 0.12]) rounded(0.03, 0.62 - (lx + 0.04) * 0.4, 0.03, 0.005, mm, lx, top + (0.62 - (lx + 0.04) * 0.4) / 2, -0.2, { parent: mill });
    for (let i = 0; i < 2; i++) {
      const pipe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 12), M.model2), mill);
      pipe.rotation.z = Math.PI / 2; pipe.position.set(-0.02 + i * 0.03, top + 0.74 - i * 0.12, -0.28);
    }
    add(new THREE.Mesh(new RoundedBoxGeometry(2.0, 1.0, 1.15, 2, 0.01), M.vitrine), mill, false, false).position.set(0, top + 0.5, 0);
    for (const [w, h, d, x, y, z] of [ // slim black frame so the case reads as glass
      [2.0, 0.018, 0.018, 0, 1.0, 0.575], [2.0, 0.018, 0.018, 0, 1.0, -0.575], [0.018, 0.018, 1.15, 1.0, 1.0, 0], [0.018, 0.018, 1.15, -1.0, 1.0, 0],
      [0.018, 1.0, 0.018, 1.0, 0.5, 0.575], [0.018, 1.0, 0.018, -1.0, 0.5, 0.575], [0.018, 1.0, 0.018, 1.0, 0.5, -0.575], [0.018, 1.0, 0.018, -1.0, 0.5, -0.575],
    ]) block(w, h, d, M.black, x, top + y, z, { parent: mill, cast: false });
    const p = rounded(0.6, 0.12, 0.02, 0.01, M.black, 0, 0.62, 0.635, { parent: mill });
    plane(0.56, 0.1, lit(canvasTex(512, 92, (g, w, h) => {
      g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#14171a'; g.font = '700 30px "JetBrains Mono", monospace'; spacing(g, 2);
      g.fillText('PLANT COMMISSIONING · 1:100', 18, 58);
    }), { transparent: false, depthWrite: true }), 0, 0, 0.011, { parent: p });
    // --- the working line: flour path (silo -> pipe -> mill -> conveyor -> pasta line), rollers, lamps
    const flowPath = new THREE.CatmullRomCurve3([
      [0.58, 0.8, -0.28], [0.5, 0.75, -0.28], [0.21, 0.745, -0.28], [-0.1, 0.745, -0.28], [-0.3, 0.745, -0.26],
      [-0.4, 0.74, -0.2], [-0.24, 0.735, -0.2], [0.0, 0.644, -0.2], [0.26, 0.54, -0.2], [0.33, 0.46, -0.12],
      [0.38, 0.37, 0.02], [0.5, 0.345, 0.16], [0.66, 0.345, 0.32],
    ].map(([x, y, z]) => new THREE.Vector3(x, top + y, z)), false, 'centripetal');
    const NP = 72;
    const flour = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 10, 8), // wheat gold: reads against the white model
      std({ color: 0xf0b43c, roughness: 0.5, emissive: 0x9a5c0c, emissiveIntensity: 0.9 }, roomEnv, 0.2), NP);
    flour.frustumCulled = false; mill.add(flour);
    const fm = new THREE.Matrix4(), fv = new THREE.Vector3(), hideM = new THREE.Matrix4().makeScale(0, 0, 0);
    const placeFlour = (front, phase) => {
      for (let i = 0; i < NP; i++) {
        const s = (i / NP + phase) % 1;
        if (s > front) { flour.setMatrixAt(i, hideM); continue; }
        flowPath.getPointAt(s, fv);
        flour.setMatrixAt(i, fm.makeTranslation(fv.x, fv.y, fv.z));
      }
      flour.instanceMatrix.needsUpdate = true;
    };
    const fluted = canvasTex(64, 16, (g, w, h) => { g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, w, h); g.fillStyle = '#5d636a'; for (let i = 0; i < 8; i++) g.fillRect(i * 8, 0, 3, h); });
    const rollMat = std({ map: fluted, roughness: 0.35, metalness: 0.7 }, roomEnv, 0.6);
    rounded(0.26, 0.1, 0.17, 0.008, M.model2, -0.45, top + 0.05, 0.2, { parent: mill });
    const rolls = [-1, 1].map((d) => {
      const holder = new THREE.Group(); holder.position.set(-0.45, top + 0.135, 0.2 + d * 0.031); holder.rotation.z = Math.PI / 2; mill.add(holder);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 20), rollMat); holder.add(r);
      r.userData.dir = d; return r;
    });
    const lampAt = [[0.35, 0.875, -0.28], [-0.45, 0.88, 0.075], [0.12, 0.44, -0.16], [0.68, 0.338, 0.42]]; // intake, milling, conveying (front of the right post), pasta
    const lampMats = lampAt.map(() => new THREE.MeshBasicMaterial({ color: 0x3a3f45 }));
    lampAt.forEach(([x, y, z], i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), lampMats[i]); m.position.set(x, top + y, z); mill.add(m); });
    let rollA = 0;
    const paint = (now) => {
      const k = Math.min(4, Math.floor(PS.t / PLANT.STEP)); // sections fully commissioned
      lampMats.forEach((m, i) => m.color.setHex(i < k ? 0x35d07f : i === k && PS.phase === 'run' ? ((now / 260) % 2 < 1 ? 0xffb020 : 0x6b4a0e) : 0x3a3f45));
      placeFlour(PS.phase === 'done' ? 1 : Math.min(1, PS.t / PLANT.END), PS.flow);
    };
    const startPlant = () => {
      PS.delay = 0;
      if (S.motion && !CLEAN) { PS.phase = 'run'; PS.t = 0; } else { PS.phase = 'done'; PS.t = PLANT.END; }
      paint(performance.now()); S.dirty = true;
    };
    updatePlant = (dt, now) => {
      const here = Math.abs(S.u - 5) < 0.6;
      if (S.active === 5 && Math.abs(S.u - 5) < 0.03 && !PS.auto && PS.phase === 'idle') { PS.auto = true; PS.delay = 0.45; } // first visit runs by itself
      if (PS.delay > 0) { PS.delay -= dt; if (PS.delay <= 0) startPlant(); return true; }
      if (PS.phase === 'run') {
        if (!S.motion) { PS.phase = 'done'; PS.t = PLANT.END; paint(now); return true; }
        PS.t = Math.min(PLANT.END, PS.t + dt);
        if (PS.t >= PLANT.END) PS.phase = 'done';
      } else if (!(PS.phase === 'done' && here && S.motion)) return false; // the line keeps running only while you watch
      const spin = PS.phase === 'done' ? 1 : clamp((PS.t - PLANT.STEP) / 1.5, 0, 1);
      rollA += dt * 9 * spin;
      for (const r of rolls) r.rotation.y = rollA * r.userData.dir;
      PS.flow = (PS.flow + dt * 0.045) % 1;
      paint(now);
      return true;
    };
    paint(0);
    exhibits[5] = { st: PS, start: startPlant, idle: 'Start the line', running: 'Commissioning…', anchor: (v) => mill.localToWorld(v.set(0, 0.0, 1.05)) }; // on the floor in front, clear of the exhibit
    contact(2.9, 2.2, 0.8, -11.0, 0.3);
  }

  /* ---------- stop 5: checkout, credentials wall, exit ---------- */
  {
    const co = new THREE.Group();
    co.position.set(-2.9, 0, -11.4); co.rotation.y = 0.2; scene.add(co);
    rounded(2.6, 1.0, 0.75, 0.02, M.wood, 0, 0.5, 0, { parent: co });
    rounded(2.75, 0.05, 0.85, 0.02, M.quartz, 0, 1.025, 0, { parent: co });
    block(2.5, 0.08, 0.7, M.black, 0, 0.04, 0, { parent: co, cast: false });
    rounded(0.24, 0.13, 0.26, 0.02, M.black, 0.85, 1.115, -0.05, { parent: co });
    const paper = plane(0.09, 0.3, std({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }), 0.85, 1.3, 0.09, { parent: co });
    paper.rotation.x = -0.3;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome), co).position.set(-0.7, 1.05, 0.12);
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
    rounded(1.26, 0.94, 0.04, 0.008, M.black, x, 1.9, -14.27);
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
    rounded(0.66, 0.26, 0.06, 0.02, std({ color: 0x0f7a3a, emissive: 0x16a34f, emissiveIntensity: 0.9 }), 0, 0, 0, { parent: ex });
    plane(0.6, 0.22, basic(canvasTex(512, 184, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.font = '800 120px "JetBrains Mono", monospace'; g.textAlign = 'center'; spacing(g, 10);
      g.fillText('EXIT', w / 2 + 5, h / 2 + 42);
    })), 0, 0, 0.032, { parent: ex });
    const sd = new THREE.Group();
    sd.position.set(-6.19, 0, -12.9); sd.rotation.y = Math.PI / 2; scene.add(sd);
    rounded(1.1, 2.2, 0.04, 0.01, M.steel, 0, 1.1, 0, { parent: sd });
    rounded(0.95, 2.08, 0.05, 0.01, std({ color: 0x8d9196, metalness: 0.3, roughness: 0.5 }), 0, 1.04, 0.01, { parent: sd });
    rounded(0.3, 0.035, 0.05, 0.01, M.chrome, 0.25, 1.05, 0.05, { parent: sd });
  }

  /* ---------- the entrance: Usman's SL500 sliding-door model ---------- */
  const SLIDE_M = 1.13; // each leaf travels ~1.13 m (3.7 ft) behind its sidelight
  let leafL = null, leafR = null, slideLocal = 0, miniL = null, miniR = null, miniSlide = 0;
  const decals = [];
  const headerMeshes = [];
  if (gltf) {
    const door = gltf.scene;
    door.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.material?.name || '';
      o.material = n.includes('Glass') ? M.doorGlass : n.includes('Header') ? M.header : M.alu;
      if (o.material === M.header) headerMeshes.push(o);
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
  } else {
    for (const sx of [-1, 1]) {
      const leaf = new THREE.Group();
      leaf.position.set(sx * 0.63, 0, -0.15); scene.add(leaf);
      block(1.25, 2.14, 0.05, M.alu, 0, 1.07, 0, { parent: leaf });
      plane(1.1, 1.98, M.doorGlass, 0, 1.07, 0.03, { parent: leaf });
      leaf.userData.x0 = leaf.position.x;
      if (sx < 0) leafL = leaf; else leafR = leaf;
    }
    slideLocal = SLIDE_M;
    headerMeshes.push(block(4.88, 0.45, 0.25, M.header, 0, 2.3, -0.15));
  }
  // generic "automatic door" decals that ride on the leaves
  const decalTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(w / 2, h / 2, 120, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#14171a'; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, 108, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#14171a'; g.textAlign = 'center'; g.font = '800 34px "JetBrains Mono", monospace';
    g.fillText('AUTOMATIC', w / 2, 118); g.fillText('DOOR', w / 2, 160);
  });
  for (const sx of [-1, 1]) {
    const d = plane(0.22, 0.22, lit(decalTex, { envMap: skyEnv }), sx * 0.62, 1.45, -0.118);
    d.userData.x0 = d.position.x; d.userData.dir = sx;
    decals.push(d);
  }
  /* ---------- entrance cutaway: the header turns X-ray to show a generic drive (illustrative) ---------- */
  // A textbook bi-parting operator, not the SL500's real internals: motor + gearbox and one toothed-belt
  // loop. The right leaf grips the upper run and the left leaf the lower run, so one motor parts both.
  // Every part moves from the same door state as the leaves.
  scene.updateMatrixWorld(true);
  const XR = { on: 0, tags: [] };
  S.xr = XR;
  const hb = new THREE.Box3();
  for (const h of headerMeshes) hb.expandByObject(h);
  if (hb.isEmpty() || hb.max.y - hb.min.y > 1 || hb.max.x - hb.min.x < 2) {
    hb.set(new THREE.Vector3(-2.44, 2.08, -0.275), new THREE.Vector3(2.44, 2.52, -0.025));
  }
  const hx0 = hb.min.x, hx1 = hb.max.x, hy0 = hb.min.y, hy1 = hb.max.y;
  const HW = hx1 - hx0, HX = (hx0 + hx1) / 2, zf = hb.max.z;
  // The model's header is a thin cover (~3 cm). The drive lives in a generic operator housing behind it.
  const DEPTH = 0.18, zFront = hb.min.z, zBack = zFront - DEPTH, zc = zFront - 0.07;
  const sweepPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e3);   // solid header: clipped where x < sweep
  const ghostPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), -1e3); // X-ray shell: kept where x < sweep
  const headerMat = M.header.clone(); // the mini door on the turntable keeps the plain material
  headerMat.clippingPlanes = [sweepPlane];
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x8fd0ff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.AdditiveBlending, toneMapped: false, clippingPlanes: [ghostPlane],
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 1, toneMapped: false, clippingPlanes: [ghostPlane] });
  const shellFor = (h) => {
    const gh = new THREE.Mesh(h.geometry, ghostMat);
    const ed = new THREE.LineSegments(new THREE.EdgesGeometry(h.geometry, 25), edgeMat);
    gh.renderOrder = 3; ed.renderOrder = 3;
    h.geometry.computeBoundingBox();
    // nudged out in x/z (no flicker against the cover) but kept under the brick soffit in y
    const c = h.geometry.boundingBox.getCenter(new THREE.Vector3()), k = 1.004, ky = 0.985;
    for (const o of [gh, ed]) { o.scale.set(k, ky, k); o.position.set(c.x * (1 - k), c.y * (1 - ky), c.z * (1 - k)); }
    h.add(gh, ed);
  };
  for (const h of headerMeshes) { h.material = headerMat; shellFor(h); }
  const housing = new THREE.Mesh(new THREE.BoxGeometry(HW, hy1 - hy0 - 0.008, DEPTH), headerMat); // top kept off the soffit
  housing.position.set(HX, (hy0 + hy1) / 2 - 0.004, zFront - DEPTH / 2);
  housing.castShadow = housing.receiveShadow = true;
  scene.add(housing);
  shellFor(housing);
  // closure strip between the cover's top and the brick soffit (wall opening top is 2.74; the model stops ~4 cm short)
  const SOFFIT = 2.74;
  // ...run forward to the wall face (z = 0) so it also trims the brick reveal above the recessed header
  if (SOFFIT - hy1 > 0.002 && SOFFIT - hy1 < 0.2) block(HW + 0.06, SOFFIT - hy1, -zBack, M.header, HX, (hy1 + SOFFIT) / 2, zBack / 2);
  const mech = new THREE.Group();
  scene.add(mech);
  const part = (geo, mat, x, y, z, parent = mech) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  // blueprint-grid backdrop inside the header (2.5 cm grid, 10 cm majors), so the parts read against it
  const blueprint = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#0d2236'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,180,240,0.1)';
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
    g.fillStyle = 'rgba(150,205,255,0.22)';
    for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 2, h);
    g.fillRect(0, 0, w, 2);
  });
  blueprint.wrapS = blueprint.wrapT = THREE.RepeatWrapping;
  blueprint.repeat.set(HW / 0.4, (hy1 - hy0) / 0.1);
  const MM = {
    move: std({ color: 0xe8541f, roughness: 0.6 }, roomEnv, 0.2), // the parts that travel
    rail: std({ color: 0x8f98a1, metalness: 0.8, roughness: 0.4 }, roomEnv, 0.45),
    dark: std({ color: 0x2b2e33, metalness: 0.45, roughness: 0.5 }, roomEnv, 0.5),
    back: new THREE.MeshBasicMaterial({ map: blueprint, toneMapped: false, transparent: true, opacity: 0.82 }),
    tyre: std({ color: 0x121417, roughness: 0.62 }, roomEnv, 0.3),
    hub: std({ color: 0xb9c0c7, metalness: 0.85, roughness: 0.3 }, roomEnv, 0.5),
  };
  part(new THREE.PlaneGeometry(HW - 0.04, hy1 - hy0 - 0.03), MM.back, HX, (hy0 + hy1) / 2, zBack + 0.012); // mounting plate
  const yTrack = hy0 + 0.085, R_WHEEL = 0.026;
  part(new THREE.BoxGeometry(HW - 0.14, 0.022, 0.04), MM.rail, HX, yTrack, zc); // track
  const rP = 0.042, yBelt = hy1 - 0.16, xIdle = hx0 + 0.22, xDrive = hx1 - 0.85, BL = xDrive - xIdle;
  // toothed belt: two straight runs whose teeth scroll with the leaves, wrapped round two pulleys
  const teeth = canvasTex(64, 8, (g, w, h) => {
    g.fillStyle = '#23282e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6d7884'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 6, h);
  });
  const run = (y) => {
    const t = teeth.clone();
    t.wrapS = THREE.RepeatWrapping; t.repeat.set(BL / 0.08, 1); t.needsUpdate = true;
    part(new THREE.BoxGeometry(BL, 0.018, 0.024), std({ map: t, roughness: 0.7 }, roomEnv, 0.3), xIdle + BL / 2, y, zc); // drawn thicker than life so it reads
    return t;
  };
  const beltTop = run(yBelt + rP), beltBot = run(yBelt - rP);
  const beltArc = std({ color: 0x17191c, roughness: 0.7 }, roomEnv, 0.3);
  const pulley = (x, rz) => {
    const arc = part(new THREE.TorusGeometry(rP, 0.009, 6, 20, Math.PI), beltArc, x, yBelt, zc);
    arc.rotation.z = rz; arc.scale.z = 1.3;
    const g = new THREE.Group();
    g.position.set(x, yBelt, zc); mech.add(g);
    part(new THREE.CylinderGeometry(rP - 0.004, rP - 0.004, 0.03, 28), MM.hub, 0, 0, 0, g).rotation.x = Math.PI / 2;
    const spoke = new THREE.BoxGeometry(rP * 1.6, 0.008, 0.034);
    part(spoke, MM.dark, 0, 0, 0, g);
    part(spoke, MM.dark, 0, 0, 0, g).rotation.z = Math.PI / 2;
    return g;
  };
  const pIdle = pulley(xIdle, Math.PI / 2), pDrive = pulley(xDrive, -Math.PI / 2);
  // motor + gearbox on the drive pulley; the motor's stripes show it spinning faster than the pulley
  const zb = zBack + 0.045; // components mounted on the back plate
  part(new RoundedBoxGeometry(0.13, 0.13, 0.07, 2, 0.012), std({ color: 0x5c6670, metalness: 0.55, roughness: 0.45 }, roomEnv, 0.45), xDrive + 0.03, yBelt, zc - 0.05);
  const motorTex = canvasTex(128, 16, (g, w, h) => {
    g.fillStyle = '#7b8792'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#46505a'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 5, h);
  });
  const motorG = new THREE.Group();
  motorG.position.set(xDrive + 0.215, yBelt, zc - 0.05); motorG.rotation.z = Math.PI / 2; mech.add(motorG);
  const motorSpin = part(new THREE.CylinderGeometry(0.052, 0.052, 0.24, 28), std({ map: motorTex, metalness: 0.5, roughness: 0.5 }, roomEnv, 0.4), 0, 0, 0, motorG);
  part(new THREE.CylinderGeometry(0.044, 0.044, 0.02, 24), MM.hub, 0, -0.13, 0, motorG);
  // control unit, wired to the sensor and the motor (the wiring glows when the sensor fires)
  const cuX = xDrive - 0.32, cuY = hy1 - 0.058;
  const pcb = canvasTex(256, 56, (g, w, h) => {
    g.fillStyle = '#1d5236'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(214,190,120,0.6)'; g.lineWidth = 2;
    for (let i = 0; i < 10; i++) { const x = 8 + i * 25; g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 22); g.lineTo(x + 10, 32); g.lineTo(x + 10, h - 4); g.stroke(); }
    g.fillStyle = '#111317'; g.fillRect(44, 12, 50, 30); g.fillRect(120, 16, 30, 22); g.fillRect(176, 10, 56, 34);
  });
  const cuBox = part(new THREE.BoxGeometry(0.34, 0.07, 0.06), std({ map: pcb, roughness: 0.7 }, roomEnv, 0.2), cuX, cuY, zb);
  const cuLedMat = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false });
  part(new THREE.SphereGeometry(0.009, 10, 8), cuLedMat, cuX + 0.14, cuY + 0.012, zb + 0.032);
  const cableMat = std({ color: 0xff6a35, emissive: 0xff541e, emissiveIntensity: 0.15, roughness: 0.55 }, roomEnv, 0.3);
  const cable = (pts) => mech.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 40, 0.0055, 6), cableMat));
  cable([[0.1, hy0 + 0.012, zFront - 0.01], [0.2, hy0 + 0.04, zc + 0.03], [0.42, cuY - 0.025, zc + 0.02], [cuX - 0.3, cuY, zc], [cuX - 0.17, cuY, zb]]);
  cable([[cuX + 0.17, cuY, zb], [cuX + 0.3, cuY - 0.004, zc - 0.02], [xDrive + 0.215, yBelt + 0.075, zc - 0.03], [xDrive + 0.215, yBelt + 0.05, zc - 0.05]]);
  // carriages: rollers on the track, a hanger plate down to the leaf, a clamp up to the belt
  const leafX = (leaf, fb) => (leaf ? new THREE.Box3().setFromObject(leaf).getCenter(new THREE.Vector3()).x : fb);
  const carriage = (x0, dir) => {
    const g = new THREE.Group();
    g.position.set(x0, 0, zc); mech.add(g);
    const top = yTrack + 0.06, bot = hy0 + 0.005;
    part(new RoundedBoxGeometry(0.46, top - bot, 0.012, 2, 0.004), MM.move, 0, (top + bot) / 2, -0.03, g);
    const wheels = [];
    for (const wx of [-0.16, 0.16]) {
      const w = new THREE.Group();
      w.position.set(wx, yTrack + 0.011 + R_WHEEL, 0.004); g.add(w);
      part(new THREE.CylinderGeometry(R_WHEEL, R_WHEEL, 0.018, 22), MM.tyre, 0, 0, 0, w).rotation.x = Math.PI / 2;
      part(new THREE.BoxGeometry(R_WHEEL * 1.5, 0.006, 0.02), MM.hub, 0, 0, 0, w);
      wheels.push(w);
    }
    const yb = dir < 0 ? yBelt - rP : yBelt + rP;
    part(new THREE.BoxGeometry(0.03, yb - top + 0.012, 0.012), MM.move, -0.12 * dir, (yb + top) / 2, 0.02, g);
    g.userData = { x0, wheels };
    return g;
  };
  const carL = carriage(leafX(leafL, -0.63), -1), carR = carriage(leafX(leafR, 0.63), 1);
  // the scan line that sweeps across as the header turns X-ray
  const scan = new THREE.Group();
  scan.visible = false; scene.add(scan);
  plane(0.012, hy1 - hy0 + 0.12, new THREE.MeshBasicMaterial({ color: 0xe2f4ff, toneMapped: false, transparent: true, depthWrite: false }), 0, (hy0 + hy1) / 2, zf + 0.014, { parent: scan });
  plane(0.6, hy1 - hy0 + 0.6, basic(radial('rgba(150,215,255,0.9)', 'rgba(150,215,255,0)'), { blending: THREE.AdditiveBlending, opacity: 0.6 }), 0, (hy0 + hy1) / 2, zf + 0.016, { parent: scan });
  // "Detail A": a magnified inset of the drive end, like a callout on a drawing. The main view keeps the
  // whole entrance; the inset camera renders the drive end into a framed box (scissored second pass).
  const detailEl = $('.wk-detail'), markEl = $('.wk-detail-mark');
  const detailCam = new THREE.PerspectiveCamera(30, 2, 0.05, 30);
  const DR = { x0: 0.3, x1: hx1 + 0.03, y0: hy0 - 0.04, y1: hy1 + 0.04 }; // right carriage's whole travel + drive
  let detailRect = null, detailShown = false;
  function placeDetailCam() {
    if (!detailEl || CLEAN) return;
    const partsEl = detailEl.querySelector('.detail-parts'); // the inset sits on its parts list, however many rows that wraps to
    if (partsEl) document.documentElement.style.setProperty('--parts-h', `${Math.ceil(partsEl.getBoundingClientRect().height)}px`);
    const r = detailEl.getBoundingClientRect();
    detailRect = { x: r.left + 2, y: r.top + 2, w: Math.max(1, r.width - 4), h: Math.max(1, r.height - 4) };
    const aspect = detailRect.w / detailRect.h, D = 1.35;
    const halfV = Math.max((DR.y1 - DR.y0) / 2, (DR.x1 - DR.x0) / 2 / aspect) * 1.04;
    const cx = (DR.x0 + DR.x1) / 2, cy = (DR.y0 + DR.y1) / 2;
    detailCam.aspect = aspect;
    detailCam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfV / D));
    detailCam.position.set(cx, cy - 0.04, zf + D);
    detailCam.lookAt(cx, cy, zc);
    detailCam.updateProjectionMatrix();
  }
  const cutawayShown = () => !CLEAN && XR.on >= 1 && S.u > 0.7 && S.u < 1.45;
  function renderDetail() {
    const want = !!detailEl && !!detailRect && cutawayShown();
    if (want !== detailShown) {
      detailShown = want;
      detailEl.classList.toggle('is-on', want);
      markEl?.classList.toggle('is-on', want);
    }
    if (!want) return;
    const r = detailRect, y = innerHeight - r.y - r.h;
    renderer.setScissorTest(true);
    renderer.setScissor(r.x, y, r.w, r.h);
    renderer.setViewport(r.x, y, r.w, r.h);
    renderer.render(scene, detailCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
  // call-outs (HTML, positioned from the scene; decorative, the card carries the text)
  const tagLayer = $('.wk-tags');
  if (tagLayer && !CLEAN) {
    for (const [text, dir, x, y, z, view, follow] of [
      ['Motion sensor', 'down', 0, 2.14, 0.02, 'main'],
      ['1', 'up', cuX - 0.1, cuY + 0.012, zb + 0.032, 'detail'],
      ['2', 'up', xDrive + 0.25, yBelt + 0.02, zc + 0.001, 'detail'],
      ['3', 'up', xDrive - 0.75, yBelt + rP, zc + 0.013, 'detail'],
      ['4', 'down', 0, yTrack + 0.038, zc - 0.022, 'detail', carR], // on the carriage plate, between its rollers
    ]) {
      const el = document.createElement('span');
      el.className = view === 'detail' ? 'wk-tag is-balloon' : 'wk-tag'; el.dataset.dir = dir;
      el.innerHTML = '<span class="tag-dot"></span><span class="tag-line"></span><span class="tag-pill"></span>';
      el.lastChild.textContent = text;
      tagLayer.append(el);
      XR.tags.push({ el, pill: el.lastChild, at: new THREE.Vector3(x, y, z), fx: x, follow, view, on: false, hw: 0 });
    }
  }
  XR.debug = { cam: detailCam, rect: () => detailRect, parts: { cu: cuBox, motor: motorSpin, carriage: carR, hb } }; // test hook
  function updateXray(dt) {
    const want = S.u > 0.45 && S.u < 1.7 ? 1 : 0;
    XR.on = S.motion ? clamp(XR.on + Math.sign(want - XR.on) * (dt / 1.2), 0, 1) : want;
    const sweep = XR.on <= 0 ? -1e3 : XR.on >= 1 ? 1e3 : hx0 - 0.08 + (HW + 0.16) * ease(XR.on);
    sweepPlane.constant = -sweep;
    ghostPlane.constant = sweep;
    scan.visible = XR.on > 0 && XR.on < 1;
    scan.position.x = sweep;
  }
  const tagV = new THREE.Vector3();
  function updateTags() {
    const show = cutawayShown();
    const W = innerWidth, H = innerHeight;
    if (markEl && show) { // dashed box on the header around the region the inset magnifies
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of [[DR.x0, DR.y0], [DR.x1, DR.y0], [DR.x0, DR.y1], [DR.x1, DR.y1]]) {
        tagV.set(x, y, zf).project(camera);
        const sx = ((tagV.x + 1) / 2) * W, sy = ((1 - tagV.y) / 2) * H;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      x0 = Math.max(x0, 8); y0 = Math.max(y0, 8); x1 = Math.min(x1, W - 18); y1 = Math.min(y1, H - 8); // badge stays on screen
      markEl.style.transform = `translate3d(${x0.toFixed(1)}px, ${y0.toFixed(1)}px, 0)`;
      markEl.style.width = `${(x1 - x0).toFixed(1)}px`;
      markEl.style.height = `${(y1 - y0).toFixed(1)}px`;
    }
    for (const t of XR.tags) {
      const inset = t.view === 'detail';
      let on = show && (!inset || !!detailRect);
      if (on) {
        tagV.copy(t.at);
        if (t.follow) tagV.x = t.follow.position.x + t.fx;
        tagV.project(inset ? detailCam : camera);
        const B = inset ? detailRect : { x: 0, y: 0, w: W, h: H };
        const x = B.x + ((tagV.x + 1) / 2) * B.w, y = B.y + ((1 - tagV.y) / 2) * B.h;
        const m = 64;
        on = tagV.z < 1 && x > B.x + 10 && x < B.x + B.w - 10 && y > B.y + (inset ? 10 : m) && y < B.y + B.h - (inset ? 10 : m);
        if (on) {
          if (!t.hw) t.hw = t.pill.offsetWidth / 2 + 8;
          t.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          if (!inset) t.pill.style.setProperty('--dx', `${(clamp(x, B.x + t.hw, B.x + B.w - t.hw) - x).toFixed(1)}px`);
        }
      }
      if (on !== t.on) { t.on = on; t.el.classList.toggle('is-on', on); }
    }
  }

  /* ---------- camera rail: one keyframe per stop ---------- */
  const KF = [
    { p: [0, 1.62, 9.6], t: [0, 2.05, 0] },          // street
    { p: [1.3, 1.62, 3.75], t: [0.95, 1.8, -6] },    // entrance: just outside the sensor zone, door closed
    { p: [0.5, 1.62, -1.0], t: [2.8, 0.85, -3.8] },  // featured display
    { p: [-1.87, 1.62, -2.98], t: [-3.9, 1.12, -4.6] }, // kiosk: close enough to read the race, base still in frame
    { p: [1.33, 1.62, -6.21], t: [5.8, 1.6, -7.7] }, // shelf: screen and the whole shelf in frame
    { p: [-0.6, 1.62, -7.7], t: [0.8, 1.0, -11.0] }, // plant model
    { p: [-1.9, 1.62, -9.6], t: [-3.4, 1.55, -13.0] }, // checkout
  ].slice(0, N);
  if (isSmall()) { KF[1].p = [0, 1.62, 5.6]; KF[1].t = [0, 1.85, -6]; } // portrait: the whole header fits only from further back
  if (isSmall()) { KF[3].p = [-2.35, 1.62, -3.35]; KF[3].t = [-3.9, 1.32, -4.6]; } // portrait: step up to the kiosk screen
  if (isSmall()) { KF[4].p = [3.0, 1.62, -7.25]; KF[4].t = [6.1, 2.15, -7.6]; }     // portrait: close enough to read the QBR screen
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
  const ZONE_OUT = 3.45, ZONE_IN = -1.75;            // sensor sees you between these z values
  const U_GATE_OUT = uForZ(3.25, 1, 2), U_GATE_IN = uForZ(-0.95, 1, 2); // wait here until the door is open
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
    // the drive follows the leaves: carriages ride with them, the belt and pulleys turn, the motor spins
    const d = e * SLIDE_M;
    carL.position.x = carL.userData.x0 - d;
    carR.position.x = carR.userData.x0 + d;
    for (const w of carL.userData.wheels) w.rotation.z = d / R_WHEEL;
    for (const w of carR.userData.wheels) w.rotation.z = -d / R_WHEEL;
    beltTop.offset.x = -d / 0.08;
    beltBot.offset.x = d / 0.08;
    pIdle.rotation.z = pDrive.rotation.z = -d / rP;
    motorSpin.rotation.y = (-d / rP) * 6;
    cableMat.emissiveIntensity = wanted ? 1.6 : 0.15;
    cuLedMat.color.setHex(wanted ? 0x35d07f : 0xffb020);
    const near = ease((S.u - 0.35) / 0.45) * (1 - ease((S.u - 1.55) / 0.4));
    coneMat.opacity = CLEAN ? 0 : near * (wanted ? 0.12 : 0.06);
  }

  function updateHud() {
    const atKiosk = !CLEAN && Math.abs(S.u - 3) < 0.45, atShelf = !CLEAN && Math.abs(S.u - 4) < 0.45, atPlant = !CLEAN && Math.abs(S.u - 5) < 0.45;
    const show = S.ready && (S.u < 2.6 || atKiosk || atShelf || atPlant);
    hud.classList.toggle('is-visible', show);
    if (!show) return;
    const inDoorway = Math.abs(camera.position.z + 0.15) < 1.0;
    let txt, st;
    if (atKiosk) {
      if (KS.phase === 'run') { txt = `Simulating · ${Math.floor(KS.t)} s of 15 · 3× speed`; st = 'opening'; }
      else if (KS.phase === 'done') { txt = '15 s vs ~3 h · manual still on door 1'; st = 'hold'; }
      else { txt = 'Audit race · simulation'; st = 'idle'; }
    }
    else if (atShelf) {
      if (QS.phase === 'run') { txt = `Simulating · ${PIPE_SAY[Math.min(3, pipeStep(QS.t))]} · 3× speed`; st = 'opening'; }
      else if (QS.phase === 'done') { txt = 'Lead package ~24 s · QBR deck ~7 s'; st = 'hold'; }
      else { txt = 'Lead → QBR pipeline · simulation'; st = 'idle'; }
    }
    else if (atPlant) {
      const k = Math.min(3, Math.floor(PS.t / PLANT.STEP));
      if (PS.phase === 'run') { txt = `Commissioning · ${PLANT_SAY[k]} · ${k + 1} of 4`; st = 'opening'; }
      else if (PS.phase === 'done') { txt = 'Line running · 4 of 4 sections green'; st = 'hold'; }
      else { txt = 'Plant model · ready to commission'; st = 'idle'; }
    }
    else if (S.door <= 0 && !S.detect) { txt = 'Door closed · sensor watching'; st = 'idle'; }
    else if (S.detect && S.door < 1) { txt = 'Motion detected · opening'; st = 'opening'; }
    else if (S.detect && inDoorway) { txt = 'Someone in the doorway · holding open'; st = 'hold'; }
    else if (S.detect) { txt = 'Presence detected · holding open'; st = 'hold'; }
    else { txt = 'All clear · closing'; st = 'closing'; }
    if (hudText.textContent !== txt) hudText.textContent = txt;
    hud.dataset.state = st;
  }

  // keep the subject clear of the cards: shift right on desktop; on phones centre it above the dock or sheet
  const applyView = () => {
    const w = innerWidth, h = innerHeight;
    if (w >= 900) camera.setViewOffset(w, h, -w * 0.17, 0, w, h);
    else camera.setViewOffset(w, h, 0, S.viewYCur, w, h);
    camera.updateProjectionMatrix();
  };
  sizeRenderer = () => {
    const w = innerWidth, h = innerHeight;
    const cap = (isSmall() ? 1.25 : 1.5) * S.dprScale;
    S.dpr = Math.max(0.6, Math.min(devicePixelRatio || 1, cap, Math.sqrt(2.4e6 / (w * h))));
    renderer.setPixelRatio(S.dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const hfov = THREE.MathUtils.degToRad(isSmall() ? 64 : 72);
    camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect)), 42, 78);
    applyView();
    placeDetailCam();
    S.dirty = true;
  };
  S.viewYCur = S.viewY;
  sizeRenderer();
  document.fonts?.ready?.then(() => { placeDetailCam(); S.dirty = true; }); // web fonts change the parts list's wrap

  // compile every shader off the main thread before the first frame, so scrolling never freezes
  hudText.textContent = 'Preparing materials…';
  try { await renderer.compileAsync(scene, camera); } catch { /* older browsers compile on the first render */ }

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
    const framing = Math.abs(S.viewY - S.viewYCur) > 0.5;
    if (framing) {
      S.viewYCur = S.motion ? S.viewYCur + (S.viewY - S.viewYCur) * (1 - Math.exp(-7 * dt)) : S.viewY;
      if (Math.abs(S.viewY - S.viewYCur) <= 0.5) S.viewYCur = S.viewY;
      applyView();
    }
    updateCamera(dt);
    updateDoor(dt, now);
    const prevXr = XR.on;
    updateXray(dt);
    const racing = updateKiosk(dt) + updatePipeline(dt) + updatePlant(dt, now) > 0; // all always tick
    const turning = S.motion && S.u > 1.5 && S.u < 3.5;
    const pulsing = S.motion && S.detect && S.u < 2.6;
    const moving = Math.abs(S.u - prevU) > 1e-6 || S.door !== prevDoor || framing || XR.on !== prevXr;
    if (!(moving || turning || pulsing || racing || S.dirty)) { animT = 0; return; }
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
    updateTags();
    updateRunBtn();
    if (S.door !== prevDoor || S.frames === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    renderDetail();
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
