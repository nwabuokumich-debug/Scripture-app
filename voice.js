// ─────────────────────────────────────────────────────────────────────────
// voice.js — Scripture Voice Mode subsystem
//
// A self-contained, provider-abstracted text-to-speech engine + floating
// player. Today it ships a free, on-device Web Speech API provider. The
// engine and the player UI ONLY talk to the VoiceProvider interface, so a
// paid provider (ElevenLabs / OpenAI TTS) can be dropped in later by
// implementing the same interface and swapping one line — WITHOUT touching
// the player UI or app.js integration.
//
// Public surface (imported by app.js):
//   import { Voice, initVoice } from './voice.js?v=N';
//   initVoice({ onItemStart, onStateChange });   // wire app-side highlight/scroll
//   Voice.isSupported
//   Voice.playScripture(items, { startIndex })   // items: [{ ref, text, vnum? }]
//   Voice.pauseScripture() / resumeScripture() / stopScripture()
//   Voice.setVoice(id) / setPlaybackRate(r) / setRepeatMode(m) / setRepeatDelay(ms)
//
// app.js owns DOM knowledge of verse rows; this module owns only #voice-bar.
// ─────────────────────────────────────────────────────────────────────────

// ── Tunables ─────────────────────────────────────────────────────────────
const RATE_MIN = 0.5, RATE_MAX = 2.0, RATE_STEP = 0.1;
const DELAY_STEP = 500, DELAY_MAX = 10000;     // repeat delay, ms
const HEARTBEAT_MS = 12000;                    // keep long utterances alive

const DEFAULT_VOICE_SETTINGS = {
  voiceId: '',          // '' = system default
  rate: 1.0,
  repeatMode: 'none',   // none | verse | passage
  repeatDelayMs: 0,
};

// ── Small helpers ────────────────────────────────────────────────────────
function clampRate(r) {
  r = Number(r);
  if (!Number.isFinite(r)) return 1.0;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(r * 10) / 10));
}

function loadVoiceSettings() {
  try {
    return { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(localStorage.getItem('voice_settings') || '{}') };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}
function saveVoiceSettings(s) {
  try { localStorage.setItem('voice_settings', JSON.stringify(s)); } catch {}
}

// Light haptic, mirrors app.js triggerHaptic() but kept local so the
// subsystem has no dependency back into app.js.
function buzz(ms = 12) {
  try {
    const h = window?.Capacitor?.Plugins?.Haptics;
    if (h?.impact) { h.impact({ style: 'LIGHT' }); return; }
  } catch {}
  try { navigator.vibrate?.(ms); } catch {}
}

// ── Provider: Web Speech API (free, on-device) ───────────────────────────
// The swap seam. A future provider implements the same shape:
//   isSupported(), getVoices(), speakChunk(text,{voiceId,rate}) -> {promise,cancel},
//   pause(), resume(), cancel().
class WebSpeechProvider {
  constructor() {
    this.name = 'webspeech';
    this.synth = (typeof window !== 'undefined') ? window.speechSynthesis : null;
    this._voices = [];
    this._ready = false;
    if (this.synth) {
      this._loadVoices();
      // Voice list is populated asynchronously on Chrome / iOS Safari.
      try { this.synth.addEventListener('voiceschanged', () => this._loadVoices()); } catch {}
    }
  }

  isSupported() {
    return !!(this.synth && typeof window.SpeechSynthesisUtterance === 'function');
  }

  _loadVoices() {
    if (!this.synth) return;
    const list = this.synth.getVoices();
    if (list && list.length) { this._voices = list; this._ready = true; }
  }

  async getVoices() {
    if (!this.synth) return [];
    if (!this._ready) {
      this._loadVoices();
      if (!this._ready) {
        // Poll briefly until the engine populates the list.
        await new Promise(resolve => {
          let tries = 0;
          const t = setInterval(() => {
            this._loadVoices();
            if (this._ready || ++tries > 20) { clearInterval(t); resolve(); }
          }, 100);
        });
      }
    }
    return this._voices.map(v => ({
      id: this._idOf(v),
      label: `${v.name}${v.lang ? ' (' + v.lang + ')' : ''}`,
      lang: v.lang,
      isDefault: !!v.default,
    }));
  }

  _idOf(v) { return v.voiceURI || `${v.name}::${v.lang}`; }
  _resolve(voiceId) {
    if (!voiceId) return null;
    return this._voices.find(v => this._idOf(v) === voiceId) || null;
  }

  // Speak one chunk. Resolves on natural end; resolves('canceled') on
  // interrupt/cancel (engine's session token decides what that means);
  // rejects only on a genuine speech error.
  speakChunk(text, { voiceId, rate } = {}) {
    if (!this.synth) {
      return { promise: Promise.reject(new Error('no speechSynthesis')), cancel() {} };
    }
    const utter = new SpeechSynthesisUtterance(text);
    const v = this._resolve(voiceId);
    if (v) { utter.voice = v; if (v.lang) utter.lang = v.lang; }
    utter.rate = clampRate(rate);

    let settled = false;
    const promise = new Promise((resolve, reject) => {
      utter.onend = () => { if (!settled) { settled = true; resolve('end'); } };
      utter.onerror = (e) => {
        if (settled) return;
        settled = true;
        const err = e && e.error;
        if (err === 'interrupted' || err === 'canceled') resolve('canceled');
        else reject(new Error(err || 'speech error'));
      };
    });
    try { this.synth.speak(utter); } catch {}
    const cancel = () => { settled = true; utter.onend = null; utter.onerror = null; };
    return { promise, cancel };
  }

  pause()  { try { this.synth && this.synth.pause(); }  catch {} }
  resume() { try { this.synth && this.synth.resume(); } catch {} }
  cancel() { try { this.synth && this.synth.cancel(); } catch {} }
}

// ── Engine: queue + repeat + delay + state (provider-agnostic) ───────────
class VoiceEngine {
  constructor(provider) {
    this.provider = provider;
    this.playlist = [];
    this.index = 0;
    this.state = 'idle';        // idle | playing | paused
    this.token = 0;             // bumped on every stop / new play; guards stale async
    this.settings = loadVoiceSettings();
    this.callbacks = {};
    this._delayTimer = null;
    this._heartbeat = null;
    this._pausedInDelay = false;
    this._endedWhilePaused = false;
    this._errorStreak = 0;
  }

  get isSupported() { return this.provider.isSupported(); }
  setCallbacks(cb) { this.callbacks = { ...this.callbacks, ...cb }; }

  _emitState() { try { this.callbacks.onStateChange?.(this.state, this); } catch {} }

  // ── timers ──
  _startHeartbeat() {
    this._stopHeartbeat();
    // Chrome/iOS cut speech after ~15s; an imperceptible pause+resume keeps
    // it alive. Gated on state so it never fights a user-initiated pause.
    this._heartbeat = setInterval(() => {
      if (this.state === 'playing') { this.provider.pause(); this.provider.resume(); }
    }, HEARTBEAT_MS);
  }
  _stopHeartbeat() {
    if (this._heartbeat) { clearInterval(this._heartbeat); this._heartbeat = null; }
  }
  _clearDelay() {
    if (this._delayTimer) { clearTimeout(this._delayTimer); this._delayTimer = null; }
  }

  // ── lifecycle ──
  playScripture(items, { startIndex = 0 } = {}) {
    if (!this.isSupported) return;
    const list = (items || []).filter(it => it && typeof it.text === 'string' && it.text.trim());
    if (!list.length) return;
    this._hardStop();
    this._errorStreak = 0;
    this.playlist = list;
    this.index = Math.min(Math.max(0, startIndex), list.length - 1);
    this.state = 'playing';
    buzz();
    this._emitState();
    this._playIndex(this.index);
  }

  _playIndex(i) {
    const myToken = this.token;
    this.index = i;
    const item = this.playlist[i];
    if (!item) { this._finish(); return; }

    try { this.callbacks.onItemStart?.(item, i, this); } catch {}
    this._emitState();

    const { promise } = this.provider.speakChunk(item.text, {
      voiceId: this.settings.voiceId,
      rate: this.settings.rate,
    });
    this._startHeartbeat();

    const settle = (errored) => {
      if (myToken !== this.token) return;    // stale: stopped or restarted
      this._stopHeartbeat();
      if (errored) {
        // Skip past an occasional error, but guard against a tight error
        // loop (e.g. broken synthesis while in Verse repeat).
        this._errorStreak++;
        if (this._errorStreak > Math.max(4, this.playlist.length)) { this._finish(); return; }
      } else {
        this._errorStreak = 0;
      }
      // iOS pause() is flaky: an utterance can finish during a "pause".
      // Remember that so resume() advances instead of hanging.
      if (this.state === 'paused') { this._endedWhilePaused = true; return; }
      this._advanceAfter(i);
    };
    promise.then(() => settle(false)).catch(() => settle(true));
  }

  _advanceAfter(i) {
    if (this.state !== 'playing') return;    // paused mid-utterance must not advance
    const mode = this.settings.repeatMode;
    const isLast = i >= this.playlist.length - 1;

    let nextIndex = null;
    let atRepeatBoundary = false;
    if (mode === 'verse') {
      nextIndex = i; atRepeatBoundary = true;
    } else if (mode === 'passage') {
      nextIndex = isLast ? 0 : i + 1; atRepeatBoundary = isLast;
    } else { // none
      nextIndex = isLast ? null : i + 1;
    }

    if (nextIndex === null) { this._finish(); return; }

    const delay = Math.max(0, this.settings.repeatDelayMs || 0);
    const go = () => { if (this.state === 'playing') this._playIndex(nextIndex); };
    if (delay > 0 && atRepeatBoundary) {
      const myToken = this.token;
      this._delayTimer = setTimeout(() => {
        this._delayTimer = null;
        if (myToken === this.token) go();
      }, delay);
    } else {
      go();
    }
  }

  pauseScripture() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._stopHeartbeat();
    if (this._delayTimer) { this._clearDelay(); this._pausedInDelay = true; }
    this.provider.pause();
    buzz();
    this._emitState();
  }

  resumeScripture() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    buzz();
    this._emitState();
    if (this._endedWhilePaused) {
      this._endedWhilePaused = false;
      this._advanceAfter(this.index);   // current chunk already finished; move on
    } else if (this._pausedInDelay) {
      this._pausedInDelay = false;
      this._playIndex(this.index);      // we were between repeats; restart current
    } else {
      this.provider.resume();
      this._startHeartbeat();
    }
  }

  // Jump within the current playlist (prev/next), keeping it intact.
  skipTo(i) {
    if (!this.playlist.length) return;
    const target = Math.min(Math.max(0, i), this.playlist.length - 1);
    this._hardStop();
    this._errorStreak = 0;
    this.state = 'playing';
    buzz();
    this._emitState();
    this._playIndex(target);
  }
  next() { this.skipTo(this.index + 1); }
  prev() { this.skipTo(this.index - 1); }

  stopScripture() {
    this._hardStop();
    this.state = 'idle';
    buzz();
    this._emitState();
  }

  // Invalidate all in-flight async work and silence the provider.
  // Preserves playlist/index (used by skipTo and play).
  _hardStop() {
    this.token++;
    this._clearDelay();
    this._stopHeartbeat();
    this._pausedInDelay = false;
    this._endedWhilePaused = false;
    this.provider.cancel();
  }

  _finish() {
    this.token++;
    this._clearDelay();
    this._stopHeartbeat();
    this._pausedInDelay = false;
    this.state = 'idle';
    this.provider.cancel();
    this._emitState();
  }

  // ── settings (apply to subsequent utterances) ──
  setPlaybackRate(rate) { this.settings.rate = clampRate(rate); saveVoiceSettings(this.settings); this._emitState(); }
  setVoice(voiceId)     { this.settings.voiceId = voiceId || ''; saveVoiceSettings(this.settings); this._emitState(); }
  setRepeatMode(mode)   { this.settings.repeatMode = mode; saveVoiceSettings(this.settings); this._emitState(); }
  setRepeatDelay(ms)    { this.settings.repeatDelayMs = Math.min(DELAY_MAX, Math.max(0, ms | 0)); saveVoiceSettings(this.settings); this._emitState(); }
}

// ── Floating player UI (owns only #voice-bar) ────────────────────────────
class VoicePlayer {
  constructor(engine) {
    this.engine = engine;
    this.el = null;
    this._build();
    this._populateVoices();
    this.update();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'voice-bar';
    el.className = 'voice-bar';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Scripture audio player');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="voice-main">
        <button class="voice-btn voice-prev" type="button" aria-label="Previous verse">⏮</button>
        <button class="voice-btn voice-toggle" type="button" aria-label="Pause" aria-pressed="true">⏸</button>
        <button class="voice-btn voice-stop" type="button" aria-label="Stop">⏹</button>
        <button class="voice-btn voice-next" type="button" aria-label="Next verse">⏭</button>
        <div class="voice-label" aria-live="polite">
          <span class="voice-ref"></span>
          <span class="voice-sub"></span>
        </div>
        <button class="voice-btn voice-tray-toggle" type="button" aria-label="Playback options" aria-expanded="false">⚙</button>
      </div>
      <div class="voice-tray" hidden>
        <div class="voice-tray-row">
          <span class="voice-tray-label">Speed</span>
          <div class="voice-stepper">
            <button class="voice-step voice-rate-down" type="button" aria-label="Slower">−</button>
            <span class="voice-rate-val">1.0×</span>
            <button class="voice-step voice-rate-up" type="button" aria-label="Faster">+</button>
          </div>
        </div>
        <div class="voice-tray-row">
          <span class="voice-tray-label">Voice</span>
          <select class="voice-select" aria-label="Reading voice"></select>
        </div>
        <div class="voice-tray-row">
          <span class="voice-tray-label">Repeat</span>
          <div class="voice-repeat-group" role="group" aria-label="Repeat mode">
            <button class="voice-repeat-btn" data-mode="none" type="button" aria-pressed="true">Off</button>
            <button class="voice-repeat-btn" data-mode="verse" type="button" aria-pressed="false">Verse</button>
            <button class="voice-repeat-btn" data-mode="passage" type="button" aria-pressed="false">Passage</button>
          </div>
        </div>
        <div class="voice-tray-row">
          <span class="voice-tray-label">Repeat delay</span>
          <div class="voice-stepper">
            <button class="voice-step voice-delay-down" type="button" aria-label="Less delay">−</button>
            <span class="voice-delay-val">0.0s</span>
            <button class="voice-step voice-delay-up" type="button" aria-label="More delay">+</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this._bind();
    // Voice list is often empty on first load and arrives asynchronously.
    try { window.speechSynthesis?.addEventListener('voiceschanged', () => this._populateVoices()); } catch {}
  }

  _$(sel) { return this.el.querySelector(sel); }

  _bind() {
    const eng = this.engine;
    this._$('.voice-toggle').addEventListener('click', () => {
      if (eng.state === 'playing') eng.pauseScripture();
      else if (eng.state === 'paused') eng.resumeScripture();
    });
    this._$('.voice-stop').addEventListener('click', () => eng.stopScripture());
    this._$('.voice-prev').addEventListener('click', () => eng.prev());
    this._$('.voice-next').addEventListener('click', () => eng.next());

    this._$('.voice-tray-toggle').addEventListener('click', () => {
      const tray = this._$('.voice-tray');
      const open = tray.hasAttribute('hidden');
      if (open) tray.removeAttribute('hidden'); else tray.setAttribute('hidden', '');
      this.el.classList.toggle('tray-open', open);
      this._$('.voice-tray-toggle').setAttribute('aria-expanded', String(open));
    });

    this._$('.voice-rate-down').addEventListener('click', () => eng.setPlaybackRate(eng.settings.rate - RATE_STEP));
    this._$('.voice-rate-up').addEventListener('click',   () => eng.setPlaybackRate(eng.settings.rate + RATE_STEP));
    this._$('.voice-delay-down').addEventListener('click', () => eng.setRepeatDelay(eng.settings.repeatDelayMs - DELAY_STEP));
    this._$('.voice-delay-up').addEventListener('click',   () => eng.setRepeatDelay(eng.settings.repeatDelayMs + DELAY_STEP));

    this.el.querySelectorAll('.voice-repeat-btn').forEach(btn => {
      btn.addEventListener('click', () => eng.setRepeatMode(btn.dataset.mode));
    });
    this._$('.voice-select').addEventListener('change', e => eng.setVoice(e.target.value));
  }

  async _populateVoices() {
    let voices = [];
    try { voices = await this.engine.provider.getVoices(); } catch {}
    const sel = this._$('.voice-select');
    if (!sel) return;
    const current = this.engine.settings.voiceId;
    sel.innerHTML =
      `<option value="">System default</option>` +
      voices.map(v => `<option value="${escapeAttr(v.id)}">${escapeHtml(v.label)}</option>`).join('');
    sel.value = current || '';
  }

  update() {
    const eng = this.engine;
    if (!this.el) return;
    const visible = eng.state !== 'idle';
    this.el.classList.toggle('open', visible);
    this.el.setAttribute('aria-hidden', String(!visible));
    document.body.classList.toggle('voice-active', visible);

    const item = eng.playlist[eng.index];
    this._$('.voice-ref').textContent = item ? item.ref : '';
    this._$('.voice-sub').textContent = eng.playlist.length > 1 ? `${eng.index + 1} / ${eng.playlist.length}` : '';

    const toggle = this._$('.voice-toggle');
    if (eng.state === 'paused') {
      toggle.textContent = '▶'; toggle.setAttribute('aria-label', 'Resume'); toggle.setAttribute('aria-pressed', 'false');
    } else {
      toggle.textContent = '⏸'; toggle.setAttribute('aria-label', 'Pause'); toggle.setAttribute('aria-pressed', 'true');
    }

    this._$('.voice-rate-val').textContent = `${eng.settings.rate.toFixed(1)}×`;
    this._$('.voice-delay-val').textContent = `${(eng.settings.repeatDelayMs / 1000).toFixed(1)}s`;

    this.el.querySelectorAll('.voice-repeat-btn').forEach(b => {
      const on = b.dataset.mode === eng.settings.repeatMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const sel = this._$('.voice-select');
    if (sel && sel.value !== (eng.settings.voiceId || '')) sel.value = eng.settings.voiceId || '';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ── Singleton wiring ─────────────────────────────────────────────────────
const provider = new WebSpeechProvider();
const engine = new VoiceEngine(provider);
let player = null;

function initVoice(appCallbacks = {}) {
  if (!engine.isSupported) return Voice;     // no UI on unsupported browsers
  if (!player) player = new VoicePlayer(engine);
  engine.setCallbacks({
    onItemStart: (item, i, eng) => {
      player && player.update();
      try { appCallbacks.onItemStart?.(item, i, eng); } catch {}
    },
    onStateChange: (state, eng) => {
      player && player.update();
      try { appCallbacks.onStateChange?.(state, eng); } catch {}
    },
  });
  return Voice;
}

export const Voice = {
  get isSupported() { return engine.isSupported; },
  get state() { return engine.state; },
  playScripture: (items, opts) => engine.playScripture(items, opts),
  pauseScripture: () => engine.pauseScripture(),
  resumeScripture: () => engine.resumeScripture(),
  stopScripture: () => engine.stopScripture(),
  setVoice: (id) => engine.setVoice(id),
  setPlaybackRate: (r) => engine.setPlaybackRate(r),
  setRepeatMode: (m) => engine.setRepeatMode(m),
  setRepeatDelay: (ms) => engine.setRepeatDelay(ms),
};

export { initVoice };
