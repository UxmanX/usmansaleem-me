/**
 * Main Application Coordinator & Visual Systems
 * Site: Usman Saleem — Sentient 3D Showcase (usmansaleem.me)
 * 
 * Features:
 * - Interactive ambient canvas particle constellation with mouse repulsion.
 * - Global audio event triggers for hover ticks and click pops.
 * - Identity Grounding modal coordinator (linking to authentic headshot.jpg).
 * - Keyboard navigation and accessibility shortcuts.
 */

document.addEventListener('DOMContentLoaded', () => {
  initParticleConstellation();
  initAudioInteractions();
  initIdentityModal();
  initSmoothScroll();
  initMetricsHUD();
  printEngineeringBanner();
});

/* --------------------------------------------------------------------------
   1. Interactive Ambient Particle Constellation Canvas
   -------------------------------------------------------------------------- */
function initParticleConstellation() {
  const canvas = document.getElementById('hero-particle-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let particles = [];
  const particleCount = window.innerWidth < 768 ? 32 : 65;
  const maxDistance = 110;

  const mouse = {
    x: -9999,
    y: -9999,
    radius: 120
  };

  function resize() {
    width = canvas.parentElement.offsetWidth || window.innerWidth;
    height = canvas.parentElement.offsetHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
  }

  class Particle {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.vx = (Math.random() - 0.5) * 0.45;
      this.vy = (Math.random() - 0.5) * 0.45;
      this.radius = 1.2 + Math.random() * 1.6;
      this.baseAlpha = 0.25 + Math.random() * 0.45;
      this.alpha = this.baseAlpha;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;

      // Screen boundary wrap
      if (this.x < 0) this.x = width;
      if (this.x > width) this.x = 0;
      if (this.y < 0) this.y = height;
      if (this.y > height) this.y = 0;

      // Mouse repulsion
      const dx = mouse.x - this.x;
      const dy = mouse.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist < mouse.radius && dist > 0) {
        const force = (mouse.radius - dist) / mouse.radius;
        const angle = Math.atan2(dy, dx);
        this.x -= Math.cos(angle) * force * 1.8;
        this.y -= Math.sin(angle) * force * 1.8;
        this.alpha = Math.min(1.0, this.baseAlpha + 0.35);
      } else {
        this.alpha = this.baseAlpha;
      }
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${this.alpha})`;
      ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
      ctx.shadowBlur = 6;
      ctx.fill();
    }
  }

  function init() {
    resize();
    particles = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push(new Particle());
    }
  }

  window.addEventListener('resize', () => {
    resize();
  }, { passive: true });

  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  }, { passive: true });

  window.addEventListener('mouseleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  // Animation Loop
  function animate() {
    ctx.clearRect(0, 0, width, height);

    // Draw connection lines
    for (let i = 0; i < particles.length; i++) {
      particles[i].update();
      particles[i].draw();

      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.hypot(dx, dy);

        if (dist < maxDistance) {
          const lineAlpha = (1 - dist / maxDistance) * 0.16;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(56, 189, 248, ${lineAlpha})`;
          ctx.lineWidth = 0.75;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(animate);
  }

  init();
  animate();
}

/* --------------------------------------------------------------------------
   2. Global Web Audio Event Triggers
   -------------------------------------------------------------------------- */
function initAudioInteractions() {
  const interactiveSelectors = 'a, button, .telemetry-card, .avatar-stage-container';

  document.querySelectorAll(interactiveSelectors).forEach((el) => {
    el.addEventListener('mouseenter', () => {
      if (window.soundEngine) {
        window.soundEngine.playHoverTick();
      }
    }, { passive: true });

    el.addEventListener('click', (e) => {
      // Don't double pop avatar clicks as avatar controller triggers pop with spring impulse
      if (el.classList.contains('avatar-stage-container')) return;
      if (window.soundEngine) {
        window.soundEngine.playPop();
      }
    });
  });
}

/* --------------------------------------------------------------------------
   3. Authentic Portrait Identity Grounding Modal
   -------------------------------------------------------------------------- */
function initIdentityModal() {
  const modal = document.getElementById('identity-modal');
  const openBtn = document.getElementById('btn-verify-identity');
  const closeBtn = document.getElementById('btn-close-identity');

  if (!modal || !openBtn) return;

  function openModal() {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    if (window.soundEngine) window.soundEngine.playChime();
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (window.soundEngine) window.soundEngine.playPop();
    openBtn.focus();
  }

  openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal();
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      closeModal();
    }
  });
}

/* --------------------------------------------------------------------------
   4. Smooth Scrolling for Anchor Links
   -------------------------------------------------------------------------- */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || !targetId) return;
      const targetElem = document.querySelector(targetId);
      if (targetElem) {
        e.preventDefault();
        targetElem.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

/* --------------------------------------------------------------------------
   5. Live Operational Metrics HUD Animated Counter
   -------------------------------------------------------------------------- */
function initMetricsHUD() {
  const counterElements = document.querySelectorAll('.hud-val[data-target]');
  if (counterElements.length === 0) return;

  if (!('IntersectionObserver' in window)) {
    // Fallback if IntersectionObserver is not supported
    counterElements.forEach((el) => {
      const target = el.getAttribute('data-target') || '0';
      const prefix = el.getAttribute('data-prefix') || '';
      const suffix = el.getAttribute('data-suffix') || '';
      el.textContent = `${prefix}${target}${suffix}`;
    });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCounters();
        observer.disconnect();
      }
    });
  }, { threshold: 0.2 });

  const targetContainer = document.querySelector('.hud-counter-grid') || document.getElementById('showcase');
  if (targetContainer) {
    observer.observe(targetContainer);
  }

  function animateCounters() {
    counterElements.forEach((el) => {
      const target = parseFloat(el.getAttribute('data-target')) || 0;
      const prefix = el.getAttribute('data-prefix') || '';
      const suffix = el.getAttribute('data-suffix') || '';
      const duration = 1500;
      const startTime = performance.now();

      function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(target * easeOut);

        el.textContent = `${prefix}${current}${suffix}`;

        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          el.textContent = `${prefix}${target}${suffix}`;
        }
      }

      requestAnimationFrame(update);
    });
  }
}

/* --------------------------------------------------------------------------
   6. Engineering Terminal Banner
   -------------------------------------------------------------------------- */
function printEngineeringBanner() {
  console.log(
    `%c[USMAN SALEEM // SENTIENT 3D PORTFOLIO]\n%cArchitecture: Multi-plane CSS 3D + SVG Sentient Rig\nPhysics: 2nd-Order Damped Harmonic Spring (k=0.08, c=0.72)\nAudio: Pure Web Audio API Synthesizer (0 External Assets)\nHost: usmansaleem.me | Repo: UxmanX/usmansaleem-me`,
    'color: #00f0ff; font-weight: bold; font-size: 13px;',
    'color: #94a3b8; font-family: monospace; font-size: 11px;'
  );
}
