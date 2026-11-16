/**
 * Sentient 3D / 2.5D Avatar Head Controller
 * 
 * Implements:
 * 1. Real-time cursor tracking and viewport orientation angle mapping.
 * 2. 2nd-order damped harmonic spring physics (k=0.08, c=0.72) for natural head lag and recovery.
 * 3. Dynamic trigonometric pupil eye-tracking (Math.atan2) with clamped elliptical bounds.
 * 4. Natural idle micro-saccades (subtle random eye jumps) and spontaneous periodic blinking.
 * 5. Expression state machine:
 *    - Neutral: Relaxed gaze, calm expression.
 *    - Hover: Warm smile, raised eyebrows, forward head lean.
 *    - Click: Spring recoil (backward impulse), playful wink, cheerful grin, audio pop trigger.
 * 6. Responsive touch and reduced-motion compliance.
 */

class SentientAvatar {
  constructor(containerId = 'avatar-stage') {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`[SentientAvatar] Container #${containerId} not found.`);
      return;
    }

    // DOM Elements
    this.headRig = this.container.querySelector('.avatar-head-rig');
    this.torso = this.container.querySelector('.avatar-layer-torso');
    this.leftPupil = this.container.querySelector('.pupil-left');
    this.rightPupil = this.container.querySelector('.pupil-right');
    this.leftEyelid = this.container.querySelector('.eyelid-left');
    this.rightEyelid = this.container.querySelector('.eyelid-right');
    this.mouthPath = this.container.querySelector('.avatar-mouth-path');
    this.leftEyebrow = this.container.querySelector('.eyebrow-left');
    this.rightEyebrow = this.container.querySelector('.eyebrow-right');
    this.depthText = document.getElementById('hero-3d-text');

    // Spring Physics Parameters
    this.k = 0.08;  // Spring stiffness
    this.c = 0.72;  // Damping coefficient

    // Physical State (Euler angles in degrees, translations in px)
    this.current = {
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      translateZ: 0,
      pupilX: 0,
      pupilY: 0
    };

    this.target = {
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      translateZ: 0,
      pupilX: 0,
      pupilY: 0
    };

    this.velocity = {
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      translateZ: 0,
      pupilX: 0,
      pupilY: 0
    };

    // Eye Tracking & Bounds
    this.maxPupilRadius = 7.5; // px max displacement within sclera
    this.maxHeadRotY = 24;     // degrees yaw (left/right)
    this.maxHeadRotX = 18;     // degrees pitch (up/down)
    this.maxHeadRotZ = 6;      // degrees roll / subtle tilt

    // Expression States
    this.isHovered = false;
    this.isWinking = false;
    this.isBlinking = false;
    this.winkTimer = null;
    this.blinkTimer = null;
    this.saccadeTimer = null;

    // Saccade offset
    this.saccadeX = 0;
    this.saccadeY = 0;

    // Reduced motion preference
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Last timestamp for deltaTime calculation
    this.lastTime = performance.now();

    // Initialize
    this._bindEvents();
    this._startBlinkLoop();
    this._startSaccadeLoop();
    this._startRenderLoop();
  }

  _bindEvents() {
    // Window cursor tracking
    window.addEventListener('mousemove', (e) => this._onPointerMove(e.clientX, e.clientY), { passive: true });

    // Touch support
    window.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) {
        this._onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    // When cursor leaves viewport, return smoothly to neutral center
    document.addEventListener('mouseleave', () => this._returnToCenter());
    window.addEventListener('blur', () => this._returnToCenter());

    // Avatar hover interactions
    this.container.addEventListener('pointerenter', () => this._onHoverEnter());
    this.container.addEventListener('pointerleave', () => this._onHoverLeave());

    // Avatar click / tap interaction (Spring Recoil + Playful Wink)
    this.container.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._onClickTrigger();
    });

    // Keyboard interaction (Space / Enter when avatar has focus)
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._onClickTrigger();
      }
    });

    // Device orientation support (optional mobile gyroscope tilt)
    if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
      window.addEventListener('deviceorientation', (e) => this._onDeviceOrientation(e), { passive: true });
    }
  }

  _onPointerMove(clientX, clientY) {
    if (typeof clientX !== 'number' || typeof clientY !== 'number' || isNaN(clientX) || isNaN(clientY)) return;
    if (this.prefersReducedMotion) return;

    // Compute normalized viewport coordinates [-1.0 .. 1.0]
    const ww = window.innerWidth || 1920;
    const wh = window.innerHeight || 1080;
    const nx = Math.max(-1, Math.min(1, (clientX / ww) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, (clientY / wh) * 2 - 1));

    // Target head angles based on normalized cursor position
    this.target.rotY = nx * this.maxHeadRotY;
    this.target.rotX = -ny * this.maxHeadRotX; // Looking up is negative pitch
    this.target.rotZ = nx * this.maxHeadRotZ;

    // Relative angle and distance for pupil eye-tracking
    if (this.container) {
      const rect = this.container.getBoundingClientRect();
      const avatarCenterX = rect.left + rect.width / 2;
      const avatarCenterY = rect.top + rect.height / 2 - 30; // Eyeline offset

      const dx = clientX - avatarCenterX;
      const dy = clientY - avatarCenterY;
      const angle = Math.atan2(dy, dx);
      const dist = Math.hypot(dx, dy);

      // Clamp pupil travel within ocular sclera ellipse
      const clampedDist = Math.min(dist / 38, this.maxPupilRadius);
      this.target.pupilX = Math.cos(angle) * clampedDist;
      this.target.pupilY = Math.sin(angle) * clampedDist * 0.85; // Slight vertical ocular compression
    }

    // Counter-parallax on 3D background typography
    if (this.depthText) {
      const textOffsetX = -nx * 18;
      const textOffsetY = -ny * 12;
      this.depthText.style.setProperty('--parallax-x', `${textOffsetX}px`);
      this.depthText.style.setProperty('--parallax-y', `${textOffsetY}px`);
    }
  }

  _returnToCenter() {
    this.target.rotX = 0;
    this.target.rotY = 0;
    this.target.rotZ = 0;
    this.target.pupilX = 0;
    this.target.pupilY = 0;
    if (this.depthText) {
      this.depthText.style.setProperty('--parallax-x', '0px');
      this.depthText.style.setProperty('--parallax-y', '0px');
    }
  }

  _onDeviceOrientation(e) {
    if (this.prefersReducedMotion || !e.gamma || !e.beta) return;
    const gamma = Math.max(-30, Math.min(30, e.gamma)); // Left-to-right [-30, 30]
    const beta = Math.max(15, Math.min(75, e.beta));    // Front-to-back [15, 75]

    this.target.rotY = (gamma / 30) * this.maxHeadRotY;
    this.target.rotX = -((beta - 45) / 30) * this.maxHeadRotX;
  }

  _onHoverEnter() {
    this.isHovered = true;
    this.target.translateZ = 22; // Head leans forward attentively
    this.container.classList.add('is-hovered');

    // Morph mouth into warm smile
    if (this.mouthPath) {
      this.mouthPath.setAttribute('d', 'M 146 200 Q 160 216 174 200');
    }

    // Raise eyebrows slightly
    if (this.leftEyebrow) this.leftEyebrow.style.transform = 'translateY(-2.5px) rotate(-2deg)';
    if (this.rightEyebrow) this.rightEyebrow.style.transform = 'translateY(-2.5px) rotate(2deg)';

    // Play subtle hover sound
    if (window.soundEngine) {
      window.soundEngine.playHoverTick();
    }
  }

  _onHoverLeave() {
    this.isHovered = false;
    this.target.translateZ = 0;
    this.container.classList.remove('is-hovered');

    // Return mouth to neutral curve if not winking
    if (!this.isWinking && this.mouthPath) {
      this.mouthPath.setAttribute('d', 'M 148 202 Q 160 207 172 202');
    }

    // Reset eyebrows
    if (this.leftEyebrow) this.leftEyebrow.style.transform = '';
    if (this.rightEyebrow) this.rightEyebrow.style.transform = '';
  }

  /**
   * Click Action:
   * 1. 2nd-order spring recoil impulse (translateZ = -26px, rotX = -9deg).
   * 2. Playful wink expression (right eye winks, smile widens).
   * 3. Procedural bubble pop sound.
   */
  _onClickTrigger() {
    // 1. Spring physics recoil impulse
    this.velocity.translateZ = -28;
    this.velocity.rotX = -9;
    this.velocity.rotY += (Math.random() - 0.5) * 8; // Slight playful wobble

    // 2. Play sound
    if (window.soundEngine) {
      window.soundEngine.playPop();
    }

    // 3. Playful wink expression
    this.isWinking = true;
    this.container.classList.add('is-winking');

    // Right eye winks shut
    if (this.rightEyelid) {
      this.rightEyelid.classList.add('wink-closed');
    }

    // Mouth forms an energetic cheerful grin
    if (this.mouthPath) {
      this.mouthPath.setAttribute('d', 'M 145 198 Q 160 220 175 198');
    }

    // Clear previous wink timer if user clicks repeatedly
    if (this.winkTimer) clearTimeout(this.winkTimer);
    this.winkTimer = setTimeout(() => {
      this.isWinking = false;
      this.container.classList.remove('is-winking');
      if (this.rightEyelid) {
        this.rightEyelid.classList.remove('wink-closed');
      }
      if (this.mouthPath) {
        this.mouthPath.setAttribute('d', this.isHovered ? 'M 146 200 Q 160 216 174 200' : 'M 148 202 Q 160 207 172 202');
      }
    }, 650);
  }

  /**
   * Spontaneous natural eyelid blinking every 3.5 to 6.5 seconds.
   */
  _startBlinkLoop() {
    const scheduleNextBlink = () => {
      const delay = 3500 + Math.random() * 3000;
      this.blinkTimer = setTimeout(() => {
        if (!this.isWinking) {
          this._triggerBlink();
        }
        scheduleNextBlink();
      }, delay);
    };
    scheduleNextBlink();
  }

  _triggerBlink() {
    this.isBlinking = true;
    if (this.leftEyelid) this.leftEyelid.classList.add('blink-shut');
    if (this.rightEyelid && !this.isWinking) this.rightEyelid.classList.add('blink-shut');

    setTimeout(() => {
      this.isBlinking = false;
      if (this.leftEyelid) this.leftEyelid.classList.remove('blink-shut');
      if (this.rightEyelid) this.rightEyelid.classList.remove('blink-shut');
    }, 125);
  }

  /**
   * Natural micro-saccades (tiny spontaneous eye movements) every 1.8 to 3.5 seconds.
   */
  _startSaccadeLoop() {
    const scheduleNextSaccade = () => {
      const delay = 1800 + Math.random() * 1800;
      this.saccadeTimer = setTimeout(() => {
        // Micro-saccadic jump [-1.5 .. 1.5 px]
        this.saccadeX = (Math.random() - 0.5) * 2.8;
        this.saccadeY = (Math.random() - 0.5) * 1.8;

        // Reset saccade after 700ms
        setTimeout(() => {
          this.saccadeX = 0;
          this.saccadeY = 0;
        }, 700);

        scheduleNextSaccade();
      }, delay);
    };
    scheduleNextSaccade();
  }

  /**
   * Main 60/120 FPS Physics Update Loop.
   * Updates 2nd-order damped harmonic spring equations on requestAnimationFrame.
   */
  _startRenderLoop() {
    const render = (now) => {
      const dt = Math.min((now - this.lastTime) / 16.666, 2.0); // Normalized delta time
      this.lastTime = now;

      // Update Spring Physics for Rotations and Translation
      ['rotX', 'rotY', 'rotZ', 'translateZ', 'pupilX', 'pupilY'].forEach((prop) => {
        const delta = this.current[prop] - this.target[prop];
        const springForce = -this.k * delta;
        const dampingForce = -this.c * this.velocity[prop];
        const acceleration = springForce + dampingForce;

        this.velocity[prop] += acceleration * dt;
        this.current[prop] += this.velocity[prop] * dt;
      });

      // Apply 3D Transforms to Head Rig
      if (this.headRig) {
        const rx = this.current.rotX.toFixed(2);
        const ry = this.current.rotY.toFixed(2);
        const rz = this.current.rotZ.toFixed(2);
        const tz = (60 + this.current.translateZ).toFixed(2);

        this.headRig.style.transform = `translate3d(0, 0, ${tz}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
      }

      // Apply subtle counter-rotation to torso for organic posture
      if (this.torso) {
        const torsoY = (this.current.rotY * 0.22).toFixed(2);
        const torsoX = (this.current.rotX * 0.15).toFixed(2);
        this.torso.style.transform = `translate3d(0, 0, 0px) rotateX(${torsoX}deg) rotateY(${torsoY}deg)`;
      }

      // Apply Pupil Eye-Tracking Displacements (Target + Saccade)
      const px = (this.current.pupilX + this.saccadeX).toFixed(2);
      const py = (this.current.pupilY + this.saccadeY).toFixed(2);

      if (this.leftPupil) {
        this.leftPupil.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      }
      if (this.rightPupil && !this.isWinking) {
        this.rightPupil.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  }
}

// Global initialization
window.SentientAvatar = SentientAvatar;
document.addEventListener('DOMContentLoaded', () => {
  window.sentientAvatar = new SentientAvatar('avatar-stage');
});
