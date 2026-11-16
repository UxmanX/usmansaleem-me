/**
 * Procedural Web Audio API SoundEngine for Usman Saleem's Sentient 3D Showcase.
 * 
 * Synthesizes all sounds mathematically via native Web Audio API oscillators,
 * biquad filters, and gain envelopes.
 * ZERO external audio files (.mp3/.wav), ZERO network requests, ZERO 404 errors.
 * 
 * Features:
 * - Autoplay-compliant user gesture auto-unlock across click, pointerdown, keydown, touchstart.
 * - Accessible mute toggle with ARIA attributes and localStorage persistence ('usman_portfolio_sound_muted').
 * - Keyboard shortcut ('M') to toggle sound on/off.
 * - Multi-frequency synthetic audio palette:
 *     - playPop(): Frequency-modulated sine bubble pop for clicks & avatar poke
 *     - playChime(): Harmonic pentatonic ascending chord (C5, E5, G5, C6) for milestones & unlocks
 *     - playHoverTick(): Subtle high-frequency click with 45ms chatter debounce
 *     - playMechanicalExplode(): Resonant lowpass filtered sawtooth sweep for mechanical CAD interactions
 *     - playTonePair(): Ascending/descending confirmation chimes on mute/unmute
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = this._getMuteState();
    this.lastHoverTime = 0;
    this.isUnlocked = false;

    this._setupAutoUnlock();
    this._setupKeyboardShortcut();
  }

  _initContext() {
    if (this.ctx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    } catch (err) {
      console.warn('[SoundEngine] AudioContext unavailable in current environment:', err);
    }
  }

  _setupAutoUnlock() {
    const unlockHandler = () => {
      this.unlock();
      ['click', 'pointerdown', 'keydown', 'touchstart'].forEach(evt => {
        window.removeEventListener(evt, unlockHandler);
      });
    };

    ['click', 'pointerdown', 'keydown', 'touchstart'].forEach(evt => {
      window.addEventListener(evt, unlockHandler, { once: true, passive: true });
    });
  }

  _setupKeyboardShortcut() {
    window.addEventListener('keydown', (e) => {
      if (e.key && e.key.toLowerCase() === 'm') {
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (!['INPUT', 'TEXTAREA'].includes(activeTag)) {
          e.preventDefault();
          this.toggleMute();
        }
      }
    });
  }

  unlock() {
    this._initContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this.isUnlocked = true;
      }).catch(() => {});
    } else if (this.ctx && this.ctx.state === 'running') {
      this.isUnlocked = true;
    }
  }

  _getMuteState() {
    try {
      return localStorage.getItem('usman_portfolio_sound_muted') === 'true';
    } catch (e) {
      return false;
    }
  }

  _setMuteState(muted) {
    try {
      localStorage.setItem('usman_portfolio_sound_muted', muted ? 'true' : 'false');
    } catch (e) {}
  }

  toggleMute() {
    this.unlock();
    if (this.isMuted) {
      // Unmuting
      this.isMuted = false;
      this._setMuteState(false);
      this._playTonePair(440, 880, 0.08); // Ascending positive chime
      this.updateToggleUI();
      return true;
    } else {
      // Muting: play descending tone then update state immediately
      this._playTonePair(660, 330, 0.08);
      this.isMuted = true;
      this._setMuteState(true);
      this.updateToggleUI();
      return false;
    }
  }

  updateToggleUI() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;

    const isMuted = this.isMuted;
    btn.setAttribute('aria-pressed', (!isMuted).toString());
    btn.setAttribute(
      'aria-label',
      isMuted ? 'Sound effects muted. Click or press M to enable.' : 'Sound effects active. Click or press M to mute.'
    );
    btn.classList.toggle('is-muted', isMuted);

    const iconOn = btn.querySelector('.sound-icon-on');
    const iconOff = btn.querySelector('.sound-icon-off');
    const textSpan = btn.querySelector('.sound-text');

    if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
    if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
    if (textSpan) textSpan.textContent = isMuted ? 'MUTED' : 'AUDIO ON';
  }

  /**
   * Playful frequency-modulated sine bubble pop for avatar poke & button clicks.
   */
  playPop() {
    if (this.isMuted) return;
    this.unlock();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(720, t);
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.065);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.075);
    } catch (e) {
      // Graceful fallback if audio context state transitions
    }
  }

  /**
   * Subtle high-frequency micro-click for card and navigation hover ticks.
   * Debounced at 45ms to prevent audio chatter on rapid cursor sweeps.
   */
  playHoverTick() {
    if (this.isMuted) return;
    const now = performance.now();
    if (now - this.lastHoverTime < 45) return;
    this.lastHoverTime = now;

    this.unlock();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2400, t);
      osc.frequency.exponentialRampToValueAtTime(1600, t + 0.012);

      gain.gain.setValueAtTime(0.035, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.018);
    } catch (e) {}
  }

  /**
   * Harmonic pentatonic arpeggio chime (C5, E5, G5, C6) for modal openings,
   * resume downloads, or milestone achievements.
   */
  playChime() {
    if (this.isMuted) return;
    this.unlock();
    if (!this.ctx) return;

    try {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const t = this.ctx.currentTime + (idx * 0.045);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0.08 / (idx + 1), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + 0.5);
      });
    } catch (e) {}
  }

  /**
   * Resonant lowpass filtered mechanical servo sweep for CAD assembly slider movements.
   */
  playMechanicalExplode() {
    if (this.isMuted) return;
    this.unlock();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.linearRampToValueAtTime(340, t + 0.22);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(260, t);
      filter.frequency.linearRampToValueAtTime(850, t + 0.12);
      filter.frequency.exponentialRampToValueAtTime(130, t + 0.24);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.065, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.26);
    } catch (e) {}
  }

  _playTonePair(f1, f2, dur) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      [{ f: f1, start: t }, { f: f2, start: t + dur }].forEach(item => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(item.f, item.start);
        gain.gain.setValueAtTime(0.07, item.start);
        gain.gain.exponentialRampToValueAtTime(0.0001, item.start + dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(item.start);
        osc.stop(item.start + dur + 0.01);
      });
    } catch (e) {}
  }
}

// Global singleton instance
window.soundEngine = new SoundEngine();
document.addEventListener('DOMContentLoaded', () => {
  window.soundEngine.updateToggleUI();
  const toggleBtn = document.getElementById('sound-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => window.soundEngine.toggleMute());
  }
});
