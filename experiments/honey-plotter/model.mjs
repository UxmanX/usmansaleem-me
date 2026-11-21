// An art-directed viscous-thread model, not a CFD solver.
const bounded = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export class HoneyModel {
  constructor({ seed = 1 } = {}) {
    this.seed = seed >>> 0;
    this.speed = 0.32;
    this.nozzle = 0.48;
    this.phase = (this.seed % 628) / 100;
    this.time = 0;
    this.points = [];
  }
  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.speed = 0.32;
    this.nozzle = 0.48;
    this.phase = (this.seed % 628) / 100;
    this.time = 0;
    this.points = [];
  }
  setSpeed(value) { this.speed = bounded(Number(value) || 0, 0, 1); }
  setNozzle(value) { this.nozzle = bounded(Number(value) || 0.5, 0.23, 0.77); }
  step(dt) {
    dt = bounded(dt, 0, 0.05);
    if (!dt) return;
    const steps = Math.max(1, Math.ceil(dt * 120));
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      const travel = (0.035 + this.speed * 0.21) * sub;
      for (const point of this.points) point.x += travel;
      this.time += sub;
      this.phase += sub * (7.6 + this.speed * 2.8);
      const radius = 0.062 * (1 - this.speed * 0.66);
      this.points.push({
        x: 0.18 + Math.sin(this.phase) * radius,
        y: this.nozzle + Math.cos(this.phase) * radius * 1.75,
        born: this.time,
      });
      while (this.points.length && (this.points[0].x > 1.12 || this.points.length > 2600)) this.points.shift();
    }
  }
}
