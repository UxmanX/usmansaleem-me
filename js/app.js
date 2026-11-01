/**
 * usmansaleem.me Master Application Controller
 * Powered by Gemini 4 Argon High-Thinking Architecture:
 * - Continuum WebGL Viscoelastic Face Deformation with Multi-Expression Morphing
 * - Real-Time Tensile Strain Gauge (0 to 12.4 MPa) & Persistent Pull Telemetry
 * - Tactile Quick Actions (Boop Nose, Max Stretch, Espresso Overclock)
 * - Playable ASSA ABLOY SL500 Electromechanical Sliding Door Simulator
 * - Project Category Filter Tabs
 * - Procedural Web Audio API Synthesizer (Squeaks, Chirps, Brushless Servo Hums)
 * - Modern Web Guidance Native <dialog> Modal with Discrete Transitions
 */

import { createPlushie } from "./face/plushie.js";
import { attachSqueak } from "./face/squeak.js";

/* ==========================================================================
   1. PROCEDURAL AUDIO SYNTHESIZER
   ========================================================================== */

class HardwareAudioSynthesizer {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  playRadarChirp(f1 = 1850, f2 = 2480) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(f1, now);
    osc.frequency.setValueAtTime(f2, now + 0.055);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
    gain.gain.setValueAtTime(0.12, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.16);
  }

  playServoHum(duration = 0.9) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(65, now);
    osc.frequency.linearRampToValueAtTime(140, now + duration * 0.3);
    osc.frequency.setValueAtTime(140, now + duration * 0.7);
    osc.frequency.exponentialRampToValueAtTime(45, now + duration);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.1);
    gain.gain.setValueAtTime(0.05, now + duration * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  playWarningBuzz() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.setValueAtTime(140, now + 0.1);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.setValueAtTime(0.01, now + 0.08);
    gain.gain.setValueAtTime(0.09, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.25);
  }

  playBoop() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(1280, now + 0.07);
    osc.frequency.exponentialRampToValueAtTime(840, now + 0.14);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.19);
  }

  playSnapback() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.35);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.37);
  }

  playEspressoArpeggio() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = now + idx * 0.045;

      osc.type = "square";
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.035, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.042);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.044);
    });
  }
}

const soundSynth = new HardwareAudioSynthesizer();

/* ==========================================================================
   2. GLOBAL STATE & INITIALIZATION
   ========================================================================== */

let plushInstance = null;
let squeakInstance = null;
let isAudioEnabled = true;

document.addEventListener("DOMContentLoaded", () => {
  initPlushFace();
  initSL500Simulator();
  initProjectFilters();
  initCadDialog();
  initCopyEmail();
  initSmoothScroll();
});

/* ==========================================================================
   3. VISCOELASTIC FACE SIMULATION & TELEMETRY
   ========================================================================== */

async function initPlushFace() {
  const root = document.getElementById("usman-plush");
  if (!root) return;

  const canvas = root.querySelector("canvas");
  const hit = root.querySelector(".plush-hit");
  const bubble = document.getElementById("hero-bubble");
  const bubbleKicker = document.getElementById("hero-bubble-kicker");
  const bubbleText = document.getElementById("hero-bubble-text");

  // Telemetry Elements
  const strainFill = document.getElementById("strain-fill");
  const strainVal = document.getElementById("strain-val");
  const pullCountEl = document.getElementById("pull-count");

  // Quick Action Buttons
  const btnBoop = document.getElementById("btn-boop");
  const btnMaxStretch = document.getElementById("btn-max-stretch");
  const btnEspresso = document.getElementById("btn-espresso");

  // Pull counter state from localStorage
  const PULL_STORAGE_KEY = "usman_pull_count";
  let pullCount = parseInt(localStorage.getItem(PULL_STORAGE_KEY) || "0", 10);
  if (pullCountEl) pullCountEl.textContent = String(pullCount);

  // Dynamic Witty Quotes
  const quotes = {
    low: [
      { kicker: "NOMINAL", text: "Light vertex calibration detected. Elastic modulus nominal!" },
      { kicker: "HEHE", text: "Just a gentle cheek tug. Feels like soft silicone!" },
      { kicker: "SPRINGY", text: "Checking damping coefficients... Hooke's Law verified!" }
    ],
    medium: [
      { kicker: "WHOA", text: "Careful! I need these cheek vertices for tomorrow's standup." },
      { kicker: "STRETCH", text: "Tensile stress ramping up! WebGL mesh deforming smoothly." },
      { kicker: "OWWW!", text: "Please don't pull too much. It hurts!" }
    ],
    high: [
      { kicker: "CRITICAL!", text: "12.4 MPa MAX! My beard shaders are approaching yield limit!" },
      { kicker: "DANGER", text: "Elastic modulus exceeded! Initiating emergency snapback!" },
      { kicker: "SNAP!", text: "Boing! My spring constants just saw another dimension!" }
    ],
    milestones: {
      10: { kicker: "TEN PULLS!", text: "Should I invoice you for quality assurance stress testing?" },
      25: { kicker: "STRESS TEST", text: "25 pulls! You really love continuum physics simulations!" },
      50: { kicker: "CHIEF SQUISH", text: "50+ pulls! Achievement Unlocked: Chief Elasticity Officer." }
    }
  };

  const updateStrainUI = (stressMPa) => {
    const maxStress = 12.4;
    const pct = Math.min((stressMPa / maxStress) * 100, 100);
    if (strainFill) strainFill.style.width = `${pct.toFixed(1)}%`;
    if (strainVal) strainVal.textContent = `${stressMPa.toFixed(1)} MPa`;
  };

  const animateDecay = (currentStress) => {
    let s = currentStress;
    const step = () => {
      s *= 0.76;
      if (s < 0.15) {
        updateStrainUI(0);
        return;
      }
      updateStrainUI(s);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const setSpeech = (kicker, text, borderColor = "var(--border-light)") => {
    if (bubbleKicker) bubbleKicker.textContent = kicker;
    if (bubbleText) bubbleText.textContent = text;
    if (bubble) bubble.style.borderColor = borderColor;
  };

  try {
    plushInstance = await createPlushie(canvas, {
      hit,
      faces: {
        smile: "assets/usman_smile.webp",
        shock: "assets/usman_shock.webp",
        ouch: "assets/usman_ouch.webp",
        annoyed: "assets/usman_annoyed.webp",
        dizzy: "assets/usman_dizzy.webp"
      },
      reactions: {
        hovered: ["annoyed"],
        held: ["shock", "ouch"],
        pulled: ["ouch", "shock"],
        tapped: ["shock"],
        dazed: ["dizzy", "ouch"],
        fedUp: ["annoyed", "dizzy"]
      },
      expressions: true,
      frame: {
        kind: "circle",
        x: 0.5,
        y: 0.55,
        r: 0.43
      },
      grid: 72,
      wobble: 2.6,
      reach: 0.09,
      damping: 0.15,
      flesh: 0.32,
      grabRadius: 0.085,
      maxPull: 0.62
    });

    // Expose globally for browser console and external tools
    window.plushInstance = plushInstance;

    // Mark plush live and STRICTLY hide any background fallback photo
    root.classList.add("is-live");
    root.classList.remove("no-webgl");
    const photo = root.querySelector("img");
    if (photo) {
      photo.style.display = "none";
      photo.style.visibility = "hidden";
    }

    squeakInstance = attachSqueak(plushInstance, { volume: 0.65 });

    /* ----------------------------------------------------------------------
       EXPRESSION CONTROLLER (Smile, Shock, Ouch, Annoyed, Dizzy)
       ---------------------------------------------------------------------- */
    const EXPRESSIONS = {
      smile: {
        label: "SMILE",
        icon: "😊",
        kicker: "NATURAL",
        quote: "Optimal resting state! Drag my cheek to stretch.",
        sound: () => soundSynth.playRadarChirp(1200, 1600)
      },
      shock: {
        label: "SHOCK",
        icon: "😲",
        kicker: "SURPRISED!",
        quote: "Woah! Did you see that sudden displacement?",
        sound: () => soundSynth.playBoop()
      },
      ouch: {
        label: "OUCH",
        icon: "😣",
        kicker: "TENSION!",
        quote: "Ouch! Tensile shear limit approaching 12.4 MPa!",
        sound: () => soundSynth.playWarningBuzz()
      },
      annoyed: {
        label: "ANNOYED",
        icon: "😒",
        kicker: "SKEPTICAL",
        quote: "Continuous prodding detected. Can we build something?",
        sound: () => soundSynth.playServoHum(0.4)
      },
      dizzy: {
        label: "DIZZY",
        icon: "😵",
        kicker: "OVERLOAD!",
        quote: "Buffer overflow! Vertices oscillating at 40 Hz!",
        sound: () => soundSynth.playEspressoArpeggio()
      }
    };

    let activeExpression = "smile";

    function setExpression(name, playAudio = true) {
      if (!EXPRESSIONS[name]) return;
      activeExpression = name;
      const meta = EXPRESSIONS[name];

      // 1. Tell plushie WebGL engine to cross-fade into new expression
      if (typeof plushInstance.setFace === "function") {
        plushInstance.setFace(name, 160);
      }

      // 2. Update UI Expression Buttons
      document.querySelectorAll(".expr-btn").forEach((btn) => {
        const isMatch = btn.getAttribute("data-face") === name;
        btn.classList.toggle("active", isMatch);
        btn.setAttribute("aria-pressed", isMatch ? "true" : "false");
      });

      // 3. Update Face State Pill in Speech Bubble
      const pill = document.getElementById("face-state-pill");
      if (pill) {
        pill.textContent = meta.label;
        pill.setAttribute("aria-label", `Current expression: ${meta.label}. Click to cycle.`);
      }

      // 4. Update Speech Bubble
      setSpeech(meta.kicker, meta.quote, "var(--brand-orange)");

      // 5. Sound cue
      if (playAudio && typeof meta.sound === "function") {
        meta.sound();
      }
    }

    window.setExpression = setExpression;

    // Click handler on Face State Pill or Bubble to cycle through reactions
    const facePill = document.getElementById("face-state-pill");
    const bubbleEl = document.getElementById("hero-bubble");
    const triggerCycle = () => {
      const faceKeys = Object.keys(EXPRESSIONS);
      const curIdx = faceKeys.indexOf(activeExpression);
      const nextIdx = (curIdx + 1) % faceKeys.length;
      setExpression(faceKeys[nextIdx], true);
    };
    if (facePill) facePill.addEventListener("click", triggerCycle);

    // React to engine-driven expression changes (e.g. idle acts or reactions)
    if (typeof plushInstance.on === "function") {
      plushInstance.on("facechange", ({ face }) => {
        if (face && EXPRESSIONS[face] && face !== activeExpression) {
          activeExpression = face;
          const meta = EXPRESSIONS[face];
          const pill = document.getElementById("face-state-pill");
          if (pill) pill.textContent = meta.label;
          document.querySelectorAll(".expr-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.getAttribute("data-face") === face);
          });
        }
      });
    }

    /* ----------------------------------------------------------------------
       POINTER DRAG TELEMETRY & DYNAMIC EXPRESSION MORPHING
       ---------------------------------------------------------------------- */
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let peakStress = 0;
    let resetTimer = null;

    hit.addEventListener("pointerdown", (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      peakStress = 0.6;
      updateStrainUI(0.6);
      clearTimeout(resetTimer);
      if (typeof plushInstance.react === "function") {
        plushInstance.react("shock", 400);
      }
      setSpeech("HOLD ON...", "You grabbed my face! Stretching viscoelastic vertices...", "var(--brand-orange)");
    });

    window.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dist = Math.hypot(dx, dy);

      const normalized = Math.min(dist / 140, 1.0);
      const stress = +(normalized * 12.4).toFixed(1);
      if (stress > peakStress) peakStress = stress;

      updateStrainUI(stress);

      // Dynamic reactive expressions during pull
      if (stress > 7.5) {
        if (typeof plushInstance.react === "function") plushInstance.react("ouch", 600);
        setSpeech("CRITICAL!", "Please don't pull too much. It hurts!", "var(--brand-orange)");
      } else if (stress > 3.0) {
        if (typeof plushInstance.react === "function") plushInstance.react("shock", 400);
      }
    });

    const onPointerRelease = () => {
      if (!isDragging) return;
      isDragging = false;
      const finalPeak = peakStress;

      if (finalPeak >= 1.2) {
        pullCount += 1;
        localStorage.setItem(PULL_STORAGE_KEY, String(pullCount));
        if (pullCountEl) pullCountEl.textContent = String(pullCount);

        // React with dizzy/dazed if pulled hard
        if (finalPeak > 6.5 && typeof plushInstance.react === "function") {
          plushInstance.react("dizzy", 1800);
        }

        // Check milestone or quote pool
        if (quotes.milestones[pullCount]) {
          const m = quotes.milestones[pullCount];
          setSpeech(m.kicker, m.text, "var(--brand-orange)");
        } else {
          let pool = quotes.low;
          if (finalPeak > 6.5) pool = quotes.high;
          else if (finalPeak > 2.5) pool = quotes.medium;
          const q = pool[Math.floor(Math.random() * pool.length)];
          setSpeech(q.kicker, q.text);
        }

        resetTimer = setTimeout(() => {
          // Gracefully return to user's selected expression
          if (typeof plushInstance.setFace === "function") {
            plushInstance.setFace(activeExpression, 220);
          }
          setSpeech("PSST.", "Click and pull my face like elastic!");
        }, 3200);
      }

      animateDecay(finalPeak);
    };

    window.addEventListener("pointerup", onPointerRelease);
    window.addEventListener("pointercancel", onPointerRelease);

    // Quick Action 1: Boop Nose
    if (btnBoop) {
      btnBoop.addEventListener("click", () => {
        soundSynth.playBoop();
        updateStrainUI(2.4);
        if (typeof plushInstance.tap === "function") {
          plushInstance.tap(0.5, 0.52);
        }
        if (typeof plushInstance.react === "function") {
          plushInstance.react("shock", 800);
        }
        setSpeech("BOOP!", "Hey! That tickles my nose sensor! 👉", "var(--brand-orange)");
        setTimeout(() => animateDecay(2.4), 220);
      });
    }

    // Quick Action 2: Max Stretch
    if (btnMaxStretch) {
      btnMaxStretch.addEventListener("click", () => {
        pullCount += 1;
        localStorage.setItem(PULL_STORAGE_KEY, String(pullCount));
        if (pullCountEl) pullCountEl.textContent = String(pullCount);

        updateStrainUI(12.4);
        if (typeof plushInstance.poke === "function") {
          plushInstance.poke(0.5, 0.5, 0.1, -0.15);
        }
        if (typeof plushInstance.react === "function") {
          plushInstance.react("ouch", 1100);
        }

        setTimeout(() => {
          soundSynth.playSnapback();
          setSpeech("12.4 MPa!", "MAX STRETCH EXECUTED! Snapback boing triggered! ⚡", "var(--brand-orange)");
          animateDecay(12.4);
        }, 300);
      });
    }

    // Quick Action 3: Espresso Overclock
    if (btnEspresso) {
      btnEspresso.addEventListener("click", () => {
        soundSynth.playEspressoArpeggio();
        updateStrainUI(8.8);
        if (typeof plushInstance.poke === "function") {
          plushInstance.poke(0.48, 0.5, -0.06, 0.04);
          setTimeout(() => plushInstance.poke(0.52, 0.5, 0.06, -0.04), 80);
        }
        if (typeof plushInstance.react === "function") {
          plushInstance.react("annoyed", 1300);
        }
        setSpeech("OVERCLOCKED!", "Double espresso injected! Velocity +400 RPM! ☕", "var(--brand-orange)");
        setTimeout(() => animateDecay(8.8), 350);
      });
    }

    // Sound Toggle Control
    const soundToggle = document.getElementById("sound-toggle");
    if (soundToggle) {
      soundToggle.addEventListener("click", () => {
        isAudioEnabled = !isAudioEnabled;
        soundSynth.enabled = isAudioEnabled;
        if (squeakInstance) squeakInstance.enabled = isAudioEnabled;

        soundToggle.classList.toggle("muted", !isAudioEnabled);
        soundToggle.setAttribute("aria-pressed", isAudioEnabled ? "true" : "false");
        const label = soundToggle.querySelector(".sound-label");
        if (label) label.textContent = isAudioEnabled ? "Audio: On" : "Audio: Muted";

        if (isAudioEnabled) soundSynth.playRadarChirp(1400, 1800);
      });
    }
  } catch (err) {
    console.warn("Plushie WebGL initialization fallback:", err);
    const photo = root.querySelector("img");
    if (photo) photo.style.display = "block";
    if (canvas) canvas.style.display = "none";
  }
}

/* ==========================================================================
   4. PLAYABLE ASSA ABLOY SL500 SLIDING DOOR SIMULATOR
   ========================================================================== */

function initSL500Simulator() {
  const stage = document.getElementById("door-stage");
  const triggerBtn = document.getElementById("btn-trigger-radar");
  const modeBtns = document.querySelectorAll(".sim-mode-btn");
  const cyclesEl = document.getElementById("sim-cycles");
  const pwmEl = document.getElementById("sim-pwm");
  const beamEl = document.getElementById("sim-beam");

  if (!stage || !triggerBtn) return;

  let currentMode = "AUTO"; // 'AUTO' | 'HOLD' | 'EXIT' | 'LOCK'
  let cycles = 142;
  let isOpen = false;
  let autoCloseTimer = null;

  // Mode Selection
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-checked", "true");

      currentMode = btn.dataset.mode || "AUTO";

      if (currentMode === "HOLD") {
        openDoor();
      } else if (currentMode === "LOCK") {
        closeDoor();
        soundSynth.playWarningBuzz();
        if (beamEl) {
          beamEl.textContent = "LOCKED";
          beamEl.style.color = "#ef4444";
        }
      } else {
        if (beamEl) {
          beamEl.textContent = "ARMED";
          beamEl.style.color = "var(--accent-green)";
        }
      }
    });
  });

  const openDoor = () => {
    if (currentMode === "LOCK") {
      soundSynth.playWarningBuzz();
      if (beamEl) {
        beamEl.textContent = "DENIED: LOCKED";
        beamEl.style.color = "#ef4444";
        setTimeout(() => {
          if (currentMode === "LOCK" && beamEl) beamEl.textContent = "LOCKED";
        }, 1200);
      }
      return;
    }

    if (!isOpen) {
      cycles += 1;
      if (cyclesEl) cyclesEl.textContent = String(cycles);
    }

    isOpen = true;
    stage.classList.add("is-open");
    soundSynth.playRadarChirp();
    soundSynth.playServoHum(0.7);

    // Animate Motor PWM
    if (pwmEl) {
      pwmEl.textContent = "92%";
      setTimeout(() => { if (pwmEl && isOpen) pwmEl.textContent = "15% (HOLD)"; }, 700);
    }
    if (beamEl) {
      beamEl.textContent = "TRANSIT (OPEN)";
      beamEl.style.color = "#ff7a4d";
    }

    clearTimeout(autoCloseTimer);
    if (currentMode === "AUTO" || currentMode === "EXIT") {
      autoCloseTimer = setTimeout(() => {
        closeDoor();
      }, 3200);
    }
  };

  const closeDoor = () => {
    if (currentMode === "HOLD") return; // Keep held
    isOpen = false;
    stage.classList.remove("is-open");
    soundSynth.playServoHum(0.7);

    if (pwmEl) {
      pwmEl.textContent = "78% (DECEL)";
      setTimeout(() => { if (pwmEl && !isOpen) pwmEl.textContent = "0%"; }, 700);
    }
    if (beamEl) {
      beamEl.textContent = currentMode === "LOCK" ? "LOCKED" : "ARMED";
      beamEl.style.color = currentMode === "LOCK" ? "#ef4444" : "var(--accent-green)";
    }
  };

  triggerBtn.addEventListener("click", () => {
    openDoor();
  });
}

/* ==========================================================================
   5. PROJECT CATEGORY FILTER TABS
   ========================================================================== */

function initProjectFilters() {
  const filterPills = document.querySelectorAll(".filter-pill");
  const projectCards = document.querySelectorAll(".project-card");

  if (!filterPills.length || !projectCards.length) return;

  filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.forEach((p) => {
        p.classList.remove("active");
        p.setAttribute("aria-selected", "false");
      });
      pill.classList.add("active");
      pill.setAttribute("aria-selected", "true");

      const filter = pill.dataset.filter || "all";

      projectCards.forEach((card) => {
        const category = card.dataset.category || "";
        if (filter === "all" || category === filter) {
          card.classList.remove("hidden-filter");
          card.style.display = "";
          card.style.opacity = "1";
        } else {
          card.classList.add("hidden-filter");
          card.style.display = "none";
          card.style.opacity = "0";
        }
      });
    });
  });
}

/* ==========================================================================
   6. NATIVE <DIALOG> MODAL MANAGER (CAD EXPLORER)
   Complies with Modern Web Guidance `dialog`
   ========================================================================== */

function initCadDialog() {
  const dialog = document.getElementById("cad-dialog");
  const openBtns = document.querySelectorAll(".open-cad-btn");
  const closeBtn = document.getElementById("close-cad-dialog");
  const iframe = document.getElementById("cad-iframe");

  if (!dialog) return;

  const openDialog = () => {
    if (!dialog.open) {
      if (iframe && !iframe.src) {
        iframe.src = "cad-modal.html";
      }
      dialog.showModal();
    }
  };

  const closeDialog = () => {
    if (dialog.open) {
      dialog.close();
    }
  };

  openBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openDialog();
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closeDialog);
  }

  // Light dismiss fallback on backdrop click
  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect();
    const isInDialog = (
      rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width
    );
    if (!isInDialog) {
      closeDialog();
    }
  });
}

/* ==========================================================================
   7. ACCESSIBLE CLIPBOARD INTERACTION
   ========================================================================== */

function initCopyEmail() {
  const btn = document.getElementById("copy-email-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const email = "usman.saleem@uottawa.ca";
    try {
      await navigator.clipboard.writeText(email);
      const textSpan = btn.querySelector(".btn-text");
      const original = textSpan ? textSpan.textContent : "Copy Email";
      if (textSpan) textSpan.textContent = "Email Copied! ✓";
      btn.style.borderColor = "#10b981";
      btn.style.color = "#10b981";

      setTimeout(() => {
        if (textSpan) textSpan.textContent = original;
        btn.style.borderColor = "";
        btn.style.color = "";
      }, 2200);
    } catch {
      window.location.href = `mailto:${email}`;
    }
  });
}

/* ==========================================================================
   8. SMOOTH ANCHOR SCROLLING
   ========================================================================== */

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      const targetId = this.getAttribute("href");
      if (targetId === "#") return;
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: "smooth" });
      }
    });
  });
}
