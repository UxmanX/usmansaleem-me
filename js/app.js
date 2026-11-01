/**
 * usmansaleem.me Master Application Controller
 * Integrates WebGL Plushie Elastic Face, Procedural Squeak Audio,
 * Interactive Speech Bubble Reactions, and 3D CAD Modal Controls.
 */

import { createPlushie } from "./face/plushie.js";
import { attachSqueak } from "./face/squeak.js";

document.addEventListener("DOMContentLoaded", async () => {
  initPlushFace();
  initModal();
  initSmoothScroll();
});

let plushInstance = null;
let squeakInstance = null;
let isAudioEnabled = true;

/**
 * Initializes the Elastic Plush Face Simulation
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
        smile: "assets/usman_smile.webp"
      },
      frame: {
        kind: "circle",
        x: 0.5,
        y: 0.55,
        r: 0.43
      },
      grid: 72,
      wobble: 2.3,
      reach: 0.085,
      damping: 0.14,
      flesh: 0.35,
      grabRadius: 0.085,
      maxPull: 0.6
    });

    squeakInstance = attachSqueak(plushInstance, { volume: 0.6 });

    // Handle speech bubble dynamic text reactions on interaction
    let resetTimer = null;

    hit.addEventListener("pointerdown", () => {
      clearTimeout(resetTimer);
      if (bubbleKicker) bubbleKicker.innerText = "OWWW!";
      if (bubbleText) bubbleText.innerText = "Please don't pull too much. It hurts!";
      if (bubble) bubble.style.borderColor = "var(--brand-orange)";
    });

    window.addEventListener("pointerup", () => {
      if (bubbleKicker) bubbleKicker.innerText = "HEHE!";
      if (bubbleText) bubbleText.innerText = "Boing! That was a good stretch.";
      if (bubble) bubble.style.borderColor = "var(--border-light)";

      resetTimer = setTimeout(() => {
        if (bubbleKicker) bubbleKicker.innerText = "PSST.";
        if (bubbleText) bubbleText.innerText = "Click and pull my face like elastic!";
      }, 3500);
    });

    // Sound toggle listener
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
    // Graceful fallback to static photograph if WebGL unavailable
    const photo = root.querySelector("img");
    if (photo) photo.style.display = "block";
    if (canvas) canvas.style.display = "none";
  }
}

/**
 * CAD 3D Modal Manager
 */
function initModal() {
  const modal = document.getElementById("cad-modal");
  const openBtns = document.querySelectorAll(".open-cad-btn");
  const closeBtn = document.getElementById("close-cad-modal");
  const iframe = document.getElementById("cad-iframe");

  if (!modal) return;

  openBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      modal.classList.add("open");
      document.body.style.overflow = "hidden";
      if (iframe && !iframe.src) {
        iframe.src = "cad-modal.html";
      }
    });
  });

  const closeModal = () => {
    modal.classList.remove("open");
    document.body.style.overflow = "";
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) {
      closeModal();
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
