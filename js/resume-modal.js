/**
 * RESUME-MODAL.JS — Accessible Dual-Mode Resume Modal & ATS Copier
 * Site: Usman Saleem — Sentient 3D Showcase (usmansaleem.me)
 * 
 * Features:
 * - Dual-tab navigation (PDF Document Preview vs Clean ATS Plain-Text Transcript).
 * - 1-Click Copy-to-Clipboard with visual and Web Audio chime feedback.
 * - Full WCAG 2.1 AA keyboard accessibility: Focus trap, Escape key dismissal, ARIA attributes.
 */

(function () {
  'use strict';

  function initResumeModal() {
    const modal = document.getElementById('resume-modal');
    if (!modal) return;

    const openBtns = document.querySelectorAll('#btn-open-resume-modal, [data-open-modal="resume"]');
    const closeBtn = document.getElementById('btn-close-resume');
    const tabPdf = document.getElementById('tab-btn-pdf');
    const tabAts = document.getElementById('tab-btn-ats');
    const panelPdf = document.getElementById('tab-panel-pdf');
    const panelAts = document.getElementById('tab-panel-ats');
    const copyBtn = document.getElementById('btn-copy-ats');
    const copyStatus = document.getElementById('ats-copy-status');
    const atsPre = document.getElementById('resume-ats-text');

    let previousActiveElement = null;

    // Open Modal
    function openModal() {
      previousActiveElement = document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      if (window.soundEngine) {
        window.soundEngine.playChime();
      }

      // Focus close button or first tab
      if (closeBtn) {
        closeBtn.focus();
      }
    }

    // Close Modal
    function closeModal() {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';

      if (window.soundEngine) {
        window.soundEngine.playPop();
      }

      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
    }

    // Tab Switching
    function switchTab(target) {
      if (target === 'pdf') {
        if (tabPdf) {
          tabPdf.classList.add('is-active');
          tabPdf.setAttribute('aria-selected', 'true');
        }
        if (tabAts) {
          tabAts.classList.remove('is-active');
          tabAts.setAttribute('aria-selected', 'false');
        }
        if (panelPdf) panelPdf.classList.add('is-active');
        if (panelAts) panelAts.classList.remove('is-active');
      } else {
        if (tabAts) {
          tabAts.classList.add('is-active');
          tabAts.setAttribute('aria-selected', 'true');
        }
        if (tabPdf) {
          tabPdf.classList.remove('is-active');
          tabPdf.setAttribute('aria-selected', 'false');
        }
        if (panelAts) panelAts.classList.add('is-active');
        if (panelPdf) panelPdf.classList.remove('is-active');
      }

      if (window.soundEngine) {
        window.soundEngine.playHoverTick();
      }
    }

    // Copy ATS Plain-Text
    function copyAtsText() {
      if (!atsPre) return;
      const textToCopy = atsPre.innerText || atsPre.textContent;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          showCopyFeedback();
        }).catch(() => {
          fallbackCopyText(textToCopy);
        });
      } else {
        fallbackCopyText(textToCopy);
      }
    }

    function fallbackCopyText(text) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showCopyFeedback();
      } catch (err) {
        console.warn('[ResumeModal] Fallback copy failed:', err);
      }
    }

    function showCopyFeedback() {
      if (copyStatus) {
        copyStatus.classList.add('is-visible');
        setTimeout(() => {
          copyStatus.classList.remove('is-visible');
        }, 2500);
      }
      if (copyBtn) {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '✓ Copied to Clipboard!';
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
        }, 2500);
      }
      if (window.soundEngine) {
        window.soundEngine.playChime();
      }
    }

    // Attach Listeners
    openBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
      });
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
      if (!modal.classList.contains('is-open')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }

      // Focus Trap
      if (e.key === 'Tab') {
        const focusable = modal.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const firstElem = focusable[0];
        const lastElem = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElem) {
            e.preventDefault();
            lastElem.focus();
          }
        } else {
          if (document.activeElement === lastElem) {
            e.preventDefault();
            firstElem.focus();
          }
        }
      }
    });

    if (tabPdf) {
      tabPdf.addEventListener('click', () => switchTab('pdf'));
    }
    if (tabAts) {
      tabAts.addEventListener('click', () => switchTab('ats'));
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', copyAtsText);
    }
  }

  document.addEventListener('DOMContentLoaded', initResumeModal);
})();
