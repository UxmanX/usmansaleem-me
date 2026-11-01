/**
 * usmansaleem.me Master Application Controller
 * Powered by Plushie WebGL Continuum Physics with Multi-Expression Morphing:
 * - Resting: Smile
 * - Grabbed: Shock
 * - Pulled: Ouch
 * - Hovered: Annoyed / Deadpan
 * - Released / Dazed: Dizzy
 * - Procedural Web Audio API Squeak Synthesizer
 * - Native <dialog> Modal with Discrete Transitions
 */

import { createPlushie } from "./face/plushie.js";
import { attachSqueak } from "./face/squeak.js";

document.addEventListener("DOMContentLoaded", () => {
  initPlushFace();
  initCadDialog();
  initCopyEmail();
  initSmoothScroll();
});

let plushInstance = null;
let squeakInstance = null;
let isAudioEnabled = true;

/**
 * Initializes the Elastic Plush Face Simulation with Live Expressions
 */
async function initPlushFace() {
  const root = document.getElementById("usman-plush");
  if (!root) return;

  const canvas = root.querySelector("canvas");
  const hit = root.querySelector(".plush-hit");
  const bubble = document.getElementById("hero-bubble");
  const bubbleKicker = document.getElementById("hero-bubble-kicker");
  const bubbleText = document.getElementById("hero-bubble-text");

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

    squeakInstance = attachSqueak(plushInstance, { volume: 0.65 });

    let resetTimer = null;

    // Pointer feedback & speech bubble reactions
    hit.addEventListener("pointerdown", () => {
      clearTimeout(resetTimer);
      if (bubbleKicker) bubbleKicker.innerText = "OWWW!";
      if (bubbleText) bubbleText.innerText = "Please don't pull too much. It hurts!";
      if (bubble) bubble.style.borderColor = "var(--brand-orange)";
    });

    window.addEventListener("pointerup", () => {
      if (bubbleKicker) bubbleKicker.innerText = "HEHE!";
      if (bubbleText) bubbleText.innerText = "Boing! That was a satisfying stretch.";
      if (bubble) bubble.style.borderColor = "var(--border-light)";

      resetTimer = setTimeout(() => {
        if (bubbleKicker) bubbleKicker.innerText = "PSST.";
        if (bubbleText) bubbleText.innerText = "Click and pull my face like elastic!";
      }, 3500);
    });

    // Sound toggle control
    const soundToggle = document.getElementById("sound-toggle");
    if (soundToggle) {
      soundToggle.addEventListener("click", () => {
        isAudioEnabled = !isAudioEnabled;
        if (squeakInstance) {
          squeakInstance.enabled = isAudioEnabled;
        }
        soundToggle.classList.toggle("muted", !isAudioEnabled);
        soundToggle.setAttribute("aria-pressed", isAudioEnabled ? "true" : "false");
        const label = soundToggle.querySelector(".sound-label");
        if (label) label.innerText = isAudioEnabled ? "Audio: On" : "Audio: Muted";
      });
    }

  } catch (err) {
    console.warn("Plushie WebGL initialization fallback:", err);
    const photo = root.querySelector("img");
    if (photo) photo.style.display = "block";
    if (canvas) canvas.style.display = "none";
  }
}

/**
 * Native <dialog> Modal Manager (Modern Web Guidance `dialog` compliant)
 */
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

  openBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openDialog();
    });
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closeDialog);
  }

  // Light dismiss fallback
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

/**
 * Accessible Clipboard Interaction
 */
function initCopyEmail() {
  const btn = document.getElementById("copy-email-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const email = "usman.saleem@uottawa.ca";
    try {
      await navigator.clipboard.writeText(email);
      const textSpan = btn.querySelector(".btn-text");
      const original = textSpan ? textSpan.innerText : "Copy Email";
      if (textSpan) textSpan.innerText = "Email Copied! ✓";
      btn.style.borderColor = "#10b981";
      btn.style.color = "#10b981";
      
      setTimeout(() => {
        if (textSpan) textSpan.innerText = original;
        btn.style.borderColor = "";
        btn.style.color = "";
      }, 2200);
    } catch {
      window.location.href = `mailto:${email}`;
    }
  });
}

/**
 * Smooth in-page scrolling
 */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
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
