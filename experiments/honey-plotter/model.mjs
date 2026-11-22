// An art-directed viscous-thread model, not a CFD solver.
const bounded = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finiteOr = (n, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
};

const REST_X = 0.18;
const MIN_X = 0.08;
const MAX_X = 0.62;
const MIN_Y = 0.23;
const MAX_Y = 0.77;
const MAX_POINTS = 2600;
const TAU = Math.PI * 2;

function loopHash(seed, index, channel) {
  let h = (seed ^ Math.imul((index | 0) + 1, 0x9e3779b1) ^ Math.imul((channel | 0) + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2147483647.5 - 1;
}

function smoothLoopNoise(seed, cycle, channel) {
  const idx = Math.floor(cycle);
  const f = cycle - idx;
  const t = f * f * (3 - 2 * f);
  const a = loopHash(seed, idx, channel);
  const b = loopHash(seed, idx + 1, channel);
  return a + (b - a) * t;
}

export class HoneyModel {
  constructor({ seed = 1 } = {}) {
    this.reset(seed);
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.speed = 0.32;
    this.nozzle = 0.48;
    this.phase = (this.seed % 628) / 100;
    this.wobblePhase = ((this.seed * 7 + 13) % 628) / 100;
    this.coilCycles = 0;
    this.time = 0;
    this.beltOffset = 0;
    this.points = [];

    this.restX = REST_X;
    this.nozzleX = REST_X;
    this.nozzleY = this.nozzle;
    this.velX = 0;
    this.velY = 0;
    this.targetX = REST_X;
    this.targetY = this.nozzle;
    this.grabbed = false;
    this.tilt = 0;

    this.footX = REST_X;
    this.footY = this.nozzle;
    this.footVelX = 0;
    this.footVelY = 0;

    this.dragSpeed = 0;
    this.tension = 0;
    this.dwell = 0;
    this.rebound = 0;
    this.whipPhase = 0;
    this.whipAmp = 0;
    this.whipDir = 1;
    this.bead = 0;
    this.beadTravel = 1.4;
    this.puddle = 0.34;
  }

  setSpeed(value) {
    this.speed = bounded(finiteOr(value, 0), 0, 1);
  }

  setNozzle(value) {
    const y = bounded(finiteOr(value, 0.5), MIN_Y, MAX_Y);
    this.nozzle = y;
    this.targetY = y;
    if (this.points.length === 0) {
      this.nozzleY = y;
      this.footY = y;
    }
  }

  grab(x, y) {
    this.grabbed = true;
    this.targetX = bounded(finiteOr(x, this.nozzleX), MIN_X, MAX_X);
    this.targetY = bounded(finiteOr(y, this.nozzleY), MIN_Y, MAX_Y);
    this.rebound *= 0.25;
    this.whipAmp *= 0.3;
  }

  drag(x, y) {
    if (!this.grabbed) {
      this.grab(x, y);
      return;
    }
    this.targetX = bounded(finiteOr(x, this.targetX), MIN_X, MAX_X);
    this.targetY = bounded(finiteOr(y, this.targetY), MIN_Y, MAX_Y);
  }

  release() {
    if (!this.grabbed) return;
    this.grabbed = false;
    const dx = this.nozzleX - this.restX;
    const dyLag = this.footY - this.nozzleY;
    const lag = Math.hypot(this.nozzleX - this.footX, dyLag);
    const energy = bounded(Math.abs(dx) * 2.25 + this.tension * 0.92 + lag * 3.0, 0, 1);
    this.targetX = this.restX;
    this.targetY = bounded(this.nozzleY, MIN_Y, MAX_Y);
    this.nozzle = this.targetY;
    if (energy > 0.06) {
      this.rebound = Math.max(this.rebound, energy);
      this.whipAmp = Math.max(this.whipAmp, energy);
      this.whipDir = Math.abs(dx) > 0.02 ? (dx > 0 ? -1 : 1) : (dyLag >= 0 ? -1 : 1);
      this.bead = Math.max(this.bead, bounded(energy * 0.96, 0, 1));
      this.beadTravel = 0.08;
      // Soft capillary recoil kick along the suspended filament.
      this.footVelX += (this.restX - this.footX) * (2.6 + energy * 2.4);
      this.footVelY += (this.nozzleY - this.footY) * (2.4 + energy * 1.9);
    }
  }

  get gestureState() {
    if (!this.grabbed && this.rebound > 0.14) return 'rebound';
    if (this.grabbed && this.tension > 0.36) return 'stretch';
    if (this.grabbed && this.dwell > 0.34) return 'coil';
    if (this.grabbed) return 'guide';
    return 'steady';
  }

  pointAge(point) {
    return Math.max(0, this.time - finiteOr(point?.born, this.time));
  }

  settleOf(point) {
    const age = this.pointAge(point);
    return bounded(age / (age + 3.4), 0, 1);
  }

  filamentProfile() {
    const dx = this.footX - this.nozzleX;
    const dy = this.footY - this.nozzleY;
    const stretch = Math.hypot(dx, dy);
    const waist = bounded(
      0.84 - this.tension * 0.48 + this.bead * 0.22 + this.dwell * 0.14,
      0.30,
      1.28
    );
    const whip = Math.sin(this.whipPhase) * this.whipAmp * this.whipDir;
    return {
      stretch,
      waist,
      whip,
      tension: this.tension,
      dwell: this.dwell,
      rebound: this.rebound,
      bead: this.bead,
      beadPos: bounded(this.beadTravel, 0, 1),
      puddle: this.puddle,
    };
  }

  step(dt) {
    dt = bounded(finiteOr(dt, 0), 0, 0.05);
    if (!dt) return;
    const steps = Math.max(1, Math.ceil(dt * 120));
    const sub = dt / steps;

    for (let i = 0; i < steps; i++) {
      const beltVel = 0.035 + this.speed * 0.21;
      const travel = beltVel * sub;
      this.beltOffset += travel;
      for (const point of this.points) point.x += travel;
      this.time += sub;

      // 1. Damped viscous nozzle carriage dynamics.
      if (this.grabbed) {
        const pullOffset = this.targetX - this.restX;
        const resist = 0.88 - 0.18 * Math.min(1, Math.abs(pullOffset) / (MAX_X - this.restX));
        const aimX = bounded(this.restX + pullOffset * resist, MIN_X, MAX_X);
        const ax = (aimX - this.nozzleX) * 44 - this.velX * 14.8;
        const ay = (this.targetY - this.nozzleY) * 54 - this.velY * 15.6;
        this.velX = bounded(this.velX + ax * sub, -3.5, 3.5);
        this.velY = bounded(this.velY + ay * sub, -3.5, 3.5);
        this.nozzleX = bounded(this.nozzleX + this.velX * sub, MIN_X, MAX_X);
        this.nozzleY = bounded(this.nozzleY + this.velY * sub, MIN_Y, MAX_Y);
        this.nozzle = this.nozzleY;
      } else {
        const ax = (this.restX - this.nozzleX) * 34 - this.velX * 6.0;
        const ay = (this.targetY - this.nozzleY) * 86 - this.velY * 17.5;
        this.velX = bounded(this.velX + ax * sub, -3.5, 3.5);
        this.velY = bounded(this.velY + ay * sub, -3.5, 3.5);
        this.nozzleX = bounded(this.nozzleX + this.velX * sub, MIN_X, MAX_X);
        this.nozzleY = bounded(this.nozzleY + this.velY * sub, MIN_Y, MAX_Y);
      }

      // Shear tilt: positive angle tilts nozzle tip left in Canvas2D, trailing viscous drag.
      const aimTilt = bounded(this.velX * 0.26 + (this.nozzleX - this.footX) * 1.45, -0.34, 0.34);
      this.tilt += (aimTilt - this.tilt) * Math.min(1, sub * 14);

      // 2. Suspended filament touchdown foot (lags under fast drag, snaps back on release).
      const beltTrail = beltVel * 0.10;
      const aimFootX = this.nozzleX + beltTrail;
      const aimFootY = this.nozzleY;
      const kF = this.grabbed ? 22 : 62 - 8 * this.rebound;
      const cF = this.grabbed ? 10.2 : 14.2 - 7.6 * this.rebound;
      const fax = (aimFootX - this.footX) * kF - this.footVelX * cF;
      const fay = (aimFootY - this.footY) * kF - this.footVelY * cF;
      this.footVelX = bounded(this.footVelX + fax * sub, -4.5, 4.5);
      this.footVelY = bounded(this.footVelY + fay * sub, -4.5, 4.5);
      this.footX = bounded(this.footX + this.footVelX * sub, 0.04, 0.78);
      this.footY = bounded(this.footY + this.footVelY * sub, 0.14, 0.86);

      // 3. Viscous regime variables: drag speed, tension, dwell, capillary snap-back.
      const instSpeed = Math.hypot(this.velX, this.velY);
      this.dragSpeed += (instSpeed - this.dragSpeed) * Math.min(1, sub * 10);
      const lagDist = Math.hypot(this.nozzleX - this.footX, this.nozzleY - this.footY);

      const excessLag = Math.max(0, lagDist - beltTrail * 1.25);
      const reboundRelax = this.grabbed ? 1 : 1 - this.rebound * 0.55;
      const rawTension = bounded(
        (excessLag * 8.6 + this.dragSpeed * (this.grabbed ? 1.08 : 0.48)) * reboundRelax + this.speed * 0.10,
        0,
        1
      );
      const tRate = rawTension > this.tension ? 14.5 : 7.6;
      this.tension += (rawTension - this.tension) * Math.min(1, sub * tRate);

      let targetDwell = 0;
      if (this.grabbed) {
        targetDwell = bounded(1 - this.dragSpeed * 5.2 - Math.max(0, this.tension - 0.08) * 1.3, 0, 1);
      } else {
        targetDwell = bounded((0.26 - this.speed) * 1.35, 0, 0.34);
      }
      const dRate = targetDwell > this.dwell ? 3.2 : 6.0;
      this.dwell += (targetDwell - this.dwell) * Math.min(1, sub * dRate);

      this.whipPhase += sub * (19 + this.rebound * 8);
      this.rebound *= Math.exp(-sub * 2.3);
      if (this.rebound < 0.002) this.rebound = 0;
      this.whipAmp *= Math.exp(-sub * 2.85);
      if (this.whipAmp < 0.002) this.whipAmp = 0;

      let landingBead = 0;
      if (this.bead > 0.002) {
        this.beadTravel = Math.min(1.4, this.beadTravel + sub * 3.4);
        const distToFoot = (this.beadTravel - 0.92) / 0.28;
        landingBead = this.bead * Math.exp(-distToFoot * distToFoot);
        this.bead *= Math.exp(-sub * 1.65);
        if (this.bead < 0.002) {
          this.bead = 0;
          this.beadTravel = 1.4;
        }
      }

      const targetPuddle = bounded(
        0.24 + (1 - this.speed) * 0.24 + this.dwell * 0.50 + landingBead * 0.44 - this.tension * 0.42,
        0.06,
        1
      );
      this.puddle += (targetPuddle - this.puddle) * Math.min(1, sub * 5.5);

      // 4. Liquid-rope coiling with bounded deterministic per-loop variation.
      const cycle = this.coilCycles;
      const radiusVar = smoothLoopNoise(this.seed, cycle * 0.96, 1);
      const pitchVar = smoothLoopNoise(this.seed, cycle * 1.12 + 0.31, 2);
      const wanderYVar = smoothLoopNoise(this.seed, cycle * 0.68 + 0.57, 3);
      const aspectVar = smoothLoopNoise(this.seed, cycle * 0.89 + 0.19, 4);
      const gaugeVar = smoothLoopNoise(this.seed, cycle * 1.24 + 0.73, 5);
      const wanderXVar = smoothLoopNoise(this.seed, cycle * 0.77 + 0.41, 6);

      const calm = (1 - this.tension * 0.88) * (1 - this.speed * 0.68);
      const baseFreq = 7.4 + this.speed * 2.6 + this.dwell * 3.4 - this.tension * 2.4;
      const coilFreq = baseFreq * (1 + 0.22 * pitchVar * (1 - this.tension * 0.65));
      const dPhase = sub * coilFreq;
      this.phase += dPhase;
      this.coilCycles += dPhase / TAU;
      this.wobblePhase += sub * 1.15;

      const baseRadius = 0.064 * (1 - this.speed * 0.78) + (this.grabbed ? this.dwell * 0.015 : 0);
      const organic = (1 + 0.04 * Math.sin(this.wobblePhase)) * (1 + 0.23 * radiusVar * (1 - this.tension * 0.6));
      const radius = baseRadius * organic * (1 - this.tension * 0.88) * (1 - this.dwell * 0.10);
      const loopXFactor = bounded(
        (1.16 - this.speed * 1.02 + (this.grabbed ? this.dwell * 0.40 : 0)) * (1 + 0.15 * aspectVar),
        0.14,
        1.08
      ) * (1 - this.tension * 0.75);

      // Gentle phase skew and lean make individual loops organic rather than circular springs.
      const phaseMod = this.phase + 0.18 * pitchVar * Math.sin(this.phase + 0.85) * (1 - this.tension * 0.7);
      const leanX = aspectVar * 0.15 * Math.cos(phaseMod) * radius * loopXFactor;
      const wanderX = wanderXVar * 0.013 * calm;
      const wanderY = wanderYVar * 0.036 * calm;
      const whipOffset = Math.sin(this.whipPhase) * this.whipAmp * this.whipDir * 0.026;

      const depX = this.footX + Math.sin(phaseMod) * radius * loopXFactor + leanX + wanderX;
      const depY = bounded(this.footY + Math.cos(phaseMod) * radius * 1.75 + wanderY + whipOffset, 0.06, 0.94);

      const speedThickness = 1.14 - this.speed * 0.34;
      const flowMod = (1 - this.tension * 0.75) * (1 - this.dwell * 0.6);
      const loopGauge = (0.042 * gaugeVar + 0.036 * Math.cos(phaseMod) * (1 - this.speed * 0.6)) * flowMod;
      const r = bounded(
        speedThickness * (1 - this.tension * 0.58) + this.dwell * 0.35 + landingBead * 0.56 + loopGauge,
        0.36,
        1.54
      );
      const pile = bounded(
        this.dwell * 0.86 + (1 - this.speed) * 0.24 + landingBead * 0.42 - this.tension * 0.48 + 0.08 * Math.max(0, Math.cos(phaseMod)),
        0,
        1
      );
      const gloss = bounded(0.86 + this.tension * 0.14 + landingBead * 0.14 - 0.04 * Math.max(0, -gaugeVar), 0.7, 1);

      this.points.push({ x: depX, y: depY, born: this.time, r, pile, gloss });
      while (this.points.length && (this.points[0].x > 1.12 || this.points.length > MAX_POINTS)) {
        this.points.shift();
      }
    }

    // 5. Age-based viscous slumping, widening, and highlight softening using point.born.
    const nPts = this.points.length;
    if (nPts > 0) {
      const now = this.time;
      for (let j = 0; j < nPts; j++) {
        const pt = this.points[j];
        const age = Math.max(0, now - pt.born);
        if (age <= 0) continue;
        const inv = 1 / (1 + age * 0.44);
        const relax = inv * inv;
        // Gradual gravitational widening onto the warm belt (strictly bounded inside [0.34, 1.56]).
        pt.r = bounded(pt.r + dt * 0.128 * relax * pt.r, 0.34, 1.56);
        // Pooling cushion deepens gently as honey settles into the belt surface.
        pt.pile = bounded(pt.pile + dt * 0.22 * relax * (0.86 - pt.pile), 0, 1);
        // Fresh glassy specular softens as curvature flattens over time.
        pt.gloss = bounded(pt.gloss - dt * 0.48 * relax * Math.max(0, pt.gloss - 0.44), 0.44, 1);
        // Subtle oblique-view gravity slump downward onto the conveyor surface (< 0.014 total).
        pt.y = bounded(pt.y + dt * 0.0052 * relax, 0.06, 0.94);
      }
      // Mild viscous curvature relaxation slumps older tight loop crests onto the belt.
      const stride = 5;
      if (nPts > stride * 2 + 1) {
        for (let j = stride; j < nPts - stride; j++) {
          const pt = this.points[j];
          const age = Math.max(0, now - pt.born);
          if (age > 0.35) {
            const inv = 1 / (1 + (age - 0.35) * 0.34);
            const k = Math.min(0.06, dt * 1.45 * inv * inv);
            const avgY = 0.5 * (this.points[j - stride].y + this.points[j + stride].y);
            pt.y = bounded(pt.y + (avgY - pt.y) * k, 0.06, 0.94);
          }
        }
      }
    }
  }
}
