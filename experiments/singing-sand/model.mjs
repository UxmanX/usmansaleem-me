// Chladni-inspired contour attraction, not validated modal analysis.
function randomSource(seed) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(1664525, s) + 1013904223 >>> 0) / 4294967296);
}
const field = (x, y, m, n) => Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y) - Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y);
const MODES = [[2, 3], [3, 4], [2, 5], [4, 5], [3, 6]];
function contour(mode) {
  const [m, n] = MODES[mode];
  const nodes = [];
  const size = 76;
  for (let iy = 1; iy < size; iy++) {
    for (let ix = 1; ix < size; ix++) {
      const x = ix / size, y = iy / size;
      const f = field(x, y, m, n);
      for (const [dx, dy] of [[1 / size, 0], [0, 1 / size]]) {
        const g = field(x + dx, y + dy, m, n);
        if (f * g <= 0 && Math.abs(f - g) > 0.00001) {
          const t = f / (f - g);
          nodes.push({ x: (x + dx * t) * 2 - 1, y: (y + dy * t) * 2 - 1 });
        }
      }
    }
  }
  return nodes;
}
export class SandModel {
  constructor({ seed = 1, count = 3800 } = {}) {
    this.random = randomSource(seed);
    this.mode = 0;
    this.time = 0;
    this.energy = 1;
    this.nodes = contour(this.mode);
    this.grains = Array.from({ length: count }, () => ({ x: this.random() * 1.94 - 0.97, y: this.random() * 1.94 - 0.97, shade: this.random(), tx: 0, ty: 0 }));
    this.retarget();
  }
  retarget() {
    for (const grain of this.grains) {
      let best = this.nodes[0], distance = Infinity;
      for (const node of this.nodes) {
        const d = (grain.x - node.x) ** 2 + (grain.y - node.y) ** 2;
        if (d < distance) { best = node; distance = d; }
      }
      grain.tx = best.x + (this.random() - 0.5) * 0.015;
      grain.ty = best.y + (this.random() - 0.5) * 0.015;
    }
  }
  scatter(x, y) {
    this.energy = 1;
    for (const g of this.grains) {
      const dx = g.x - x, dy = g.y - y;
      const d = Math.hypot(dx, dy);
      if (d < 0.55) {
        const a = d > 0.001 ? Math.atan2(dy, dx) : this.random() * Math.PI * 2;
        const kick = (0.55 - d) * 0.45;
        g.x = Math.max(-0.98, Math.min(0.98, g.x + Math.cos(a) * kick));
        g.y = Math.max(-0.98, Math.min(0.98, g.y + Math.sin(a) * kick));
      }
    }
  }
  setMode(value) {
    this.mode = Math.min(MODES.length - 1, Math.max(0, Math.round(Number(value) || 0)));
    this.nodes = contour(this.mode);
    this.energy = 1;
    this.retarget();
  }
  meanDistance() {
    return this.grains.reduce((sum, g) => sum + Math.hypot(g.x - g.tx, g.y - g.ty), 0) / this.grains.length;
  }
  step(dt) {
    dt = Math.min(0.05, Math.max(0, dt));
    if (!dt) return;
    this.time += dt;
    const follow = 1 - Math.exp(-dt * 2.5);
    this.energy *= Math.exp(-dt * 1.5);
    for (const g of this.grains) {
      g.x += (g.tx - g.x) * follow;
      g.y += (g.ty - g.y) * follow;
    }
  }
}
