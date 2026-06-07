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

const KOKORO_WORKER_URL = './kokoro-worker.js?v=2';
const KOKORO_DEFAULT_VOICE = 'af_heart';
const KOKORO_VOICE_PREFIX = 'kokoro:';
const KOKORO_LOAD_TIMEOUT_MS = 25000;
const KOKORO_GENERATE_TIMEOUT_MS = 15000;
const KOKORO_RETRY_COOLDOWN_MS = 120000;
const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Kokoro Heart (US female, A)' },
  { id: 'af_bella', label: 'Kokoro Bella (US female, A-)' },
  { id: 'af_nicole', label: 'Kokoro Nicole (US female, B-)' },
  { id: 'af_aoede', label: 'Kokoro Aoede (US female, C+)' },
  { id: 'af_kore', label: 'Kokoro Kore (US female, C+)' },
  { id: 'af_nova', label: 'Kokoro Nova (US female, C)' },
  { id: 'af_sarah', label: 'Kokoro Sarah (US female, C+)' },
  { id: 'am_fenrir', label: 'Kokoro Fenrir (US male, C+)' },
  { id: 'am_michael', label: 'Kokoro Michael (US male, C+)' },
  { id: 'am_puck', label: 'Kokoro Puck (US male, C+)' },
  { id: 'bf_emma', label: 'Kokoro Emma (UK female, B-)' },
  { id: 'bf_isabella', label: 'Kokoro Isabella (UK female, C)' },
  { id: 'bm_fable', label: 'Kokoro Fable (UK male, C)' },
  { id: 'bm_george', label: 'Kokoro George (UK male, C)' },
];

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
    this.defaultVoiceLabel = 'Automatic (best available)';
    this.needsHeartbeat = true;
    this.synth = (typeof window !== 'undefined') ? window.speechSynthesis : null;
    this._voices = [];
    this._ready = false;
    this._preferred = null;
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
    if (list && list.length) { this._voices = list; this._ready = true; this._preferred = null; }
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
    return this._voices
      .slice()
      .sort((a, b) => this._score(b) - this._score(a))   // best voices first
      .map(v => ({
        id: this._idOf(v),
        label: `${v.name}${v.lang ? ' (' + v.lang + ')' : ''}`,
        lang: v.lang,
        isDefault: !!v.default,
      }));
  }

  _idOf(v) { return v.voiceURI || `${v.name}::${v.lang}`; }
  _resolve(voiceId) {
    if (voiceId) {
      const found = this._voices.find(v => this._idOf(v) === voiceId);
      if (found) return found;
    }
    return this._pickPreferred();   // '' or unknown id → best available voice
  }

  // The platform "default" voice is often a low-quality / novelty one
  // (e.g. macOS "Albert"). Pick the best available English voice so Voice
  // Mode sounds decent out of the box; the user can still override.
  _pickPreferred() {
    const voices = this._voices;
    if (!voices.length) return null;
    if (this._preferred && voices.includes(this._preferred)) return this._preferred;
    let best = null, bestScore = -Infinity;
    for (const v of voices) { const sc = this._score(v); if (sc > bestScore) { bestScore = sc; best = v; } }
    this._preferred = best;
    return best;
  }

  // Higher = better quality / more natural. Used to auto-pick the default
  // voice and to sort the voice list (best first) in the player.
  _score(v) {
    const name = v.name || '';
    const lang = (v.lang || '').toLowerCase();
    let s = 0;
    if (lang.startsWith('en')) s += 100;
    if (lang === 'en-us') s += 25;
    if (/\b(premium|enhanced|neural|natural)\b/i.test(name)) s += 70;   // downloadable HQ voices
    if (/google (us|uk) english/i.test(name)) s += 55;                  // Chrome
    if (/microsoft.*(aria|jenny|guy|sonia|natural)/i.test(name)) s += 60;
    if (/\b(samantha|ava|allison|aaron|evan|nathan|joelle|zoe|serena|karen|daniel|moira|tessa|fiona|siri)\b/i.test(name)) s += 45;
    // demote the old robotic / novelty macOS voices
    if (/\b(albert|fred|junior|ralph|kathy|princess|bad news|good news|bahh|bells|boing|bubbles|cellos|deranged|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i.test(name)) s -= 300;
    if (v.localService) s += 8;
    if (v.default) s += 4;
    return s;
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

// ── Provider: Kokoro.js (free, local model) + Web Speech fallback ────────
class KokoroProvider {
  constructor(fallback) {
    this.name = 'kokoro';
    this.defaultVoiceLabel = 'Automatic (system voice)';
    this.needsHeartbeat = false;
    this.fallback = fallback;
    this._fallbackUntil = 0;
    this._worker = null;
    this._workerJobs = new Map();
    this._workerJobId = 0;
    this._workerReady = false;
    this._job = null;
    this._currentAudio = null;
    this._currentSource = null;
    this._currentUrl = null;
    this._paused = false;
  }

  isSupported() {
    return this._canPlayAudio() || !!this.fallback?.isSupported();
  }

  _canPlayAudio() {
    return typeof window !== 'undefined'
      && typeof Audio === 'function'
      && typeof Blob === 'function'
      && !!window.URL?.createObjectURL;
  }

  async getVoices() {
    const kokoro = this._canPlayAudio()
      ? KOKORO_VOICES.map(v => ({
          id: `${KOKORO_VOICE_PREFIX}${v.id}`,
          label: v.label,
          lang: v.id.startsWith('b') ? 'en-GB' : 'en-US',
          isDefault: v.id === KOKORO_DEFAULT_VOICE,
        }))
      : [];

    let system = [];
    try {
      const fallbackVoices = await this.fallback?.getVoices?.() || [];
      const englishVoices = fallbackVoices.filter(v => (v.lang || '').toLowerCase().startsWith('en'));
      system = (englishVoices.length ? englishVoices : fallbackVoices).map(v => ({
        ...v,
        label: `System: ${v.label}`,
      }));
    } catch {}
    return kokoro.concat(system);
  }

  speakChunk(text, { voiceId, rate, onStatus } = {}) {
    if (!this._shouldUseKokoro(voiceId)) {
      if (!voiceId) this._warmKokoro();
      return this._speakWithFallback(text, { voiceId, rate });
    }
    if (!this._canPlayAudio()) {
      return this._speakWithFallback(text, { voiceId: '', rate });
    }
    if (!this._workerReady && Date.now() < this._fallbackUntil) {
      this._warmKokoro();
      return this._speakFallbackChunk(text, {
        rate,
        onStatus,
        label: 'Kokoro still loading; using system voice...',
      });
    }

    this.needsHeartbeat = false;
    const job = { canceled: false, fallbackSpeech: null, stopPlayback: null, resumeWaiter: null };
    this._cancelJob(this._job);
    this._job = job;
    this._paused = false;
    const reportLoadStatus = label => {
      if (!this._isCanceled(job)) onStatus?.(label);
    };

    const promise = (async () => {
      let generation = null;
      try {
        onStatus?.(this._workerReady ? 'Generating Kokoro audio...' : 'Loading Kokoro voice model...');
        await this._unlockAudio();
        generation = this._generateInWorker(text, {
          voice: this._voiceName(voiceId),
          speed: clampRate(rate),
          onStatus: reportLoadStatus,
        });
        const audio = await this._withTimeout(
          generation.promise,
          this._workerReady ? KOKORO_GENERATE_TIMEOUT_MS : KOKORO_LOAD_TIMEOUT_MS,
          this._workerReady ? 'Kokoro generation is still running' : 'Kokoro model is still loading'
        );
        if (this._isCanceled(job)) return 'canceled';

        onStatus?.('');
        return await this._playSamples(audio.samples, audio.samplingRate, job);
      } catch (err) {
        generation?.cancel?.();
        this._cleanupAudio();
        if (this._isCanceled(job)) return 'canceled';
        if (err?.code === 'kokoro-timeout') this._fallbackUntil = Date.now() + KOKORO_RETRY_COOLDOWN_MS;
        try { console.warn('Kokoro TTS failed; falling back to system voice.', err); } catch {}
        if (this.fallback?.isSupported()) {
          onStatus?.(err?.code === 'kokoro-timeout' ? 'Kokoro still loading; using system voice...' : 'Using system voice...');
          job.fallbackSpeech = this.fallback.speakChunk(text, { voiceId: '', rate });
          return await job.fallbackSpeech.promise;
        }
        throw err;
      } finally {
        if (this._job === job) this._job = null;
        onStatus?.('');
      }
    })();

    return { promise, cancel: () => this._cancelJob(job) };
  }

  _shouldUseKokoro(voiceId) {
    return String(voiceId || '').startsWith(KOKORO_VOICE_PREFIX);
  }

  _warmKokoro() {
    if (this._workerReady || Date.now() < this._fallbackUntil || !this._canPlayAudio()) return;
    try {
      this._getWorker().postMessage({ type: 'warm' });
    } catch {
      this._fallbackUntil = Date.now() + KOKORO_RETRY_COOLDOWN_MS;
    }
  }

  _voiceName(voiceId) {
    const id = String(voiceId || '').replace(KOKORO_VOICE_PREFIX, '');
    return KOKORO_VOICES.some(v => v.id === id) ? id : KOKORO_DEFAULT_VOICE;
  }

  _getWorker() {
    if (this._worker) return this._worker;
    if (typeof Worker !== 'function') throw new Error('Kokoro worker unavailable');

    const worker = new Worker(KOKORO_WORKER_URL, { type: 'module' });
    worker.addEventListener('message', event => {
      const msg = event.data || {};
      if (msg.type === 'ready') {
        this._workerReady = true;
        return;
      }

      const job = this._workerJobs.get(msg.id);
      if (!job) return;

      if (msg.type === 'status') {
        job.onStatus?.(msg.label || '');
      } else if (msg.type === 'result') {
        this._workerReady = true;
        this._workerJobs.delete(msg.id);
        job.resolve({
          samples: new Float32Array(msg.audio),
          samplingRate: msg.samplingRate || 24000,
        });
      } else if (msg.type === 'error') {
        this._workerJobs.delete(msg.id);
        job.reject(new Error(msg.message || 'Kokoro worker error'));
      }
    });
    worker.addEventListener('error', event => {
      const err = new Error(event.message || 'Kokoro worker error');
      for (const [, job] of this._workerJobs) job.reject(err);
      this._workerJobs.clear();
      this._worker = null;
      this._workerReady = false;
    });
    this._worker = worker;
    return worker;
  }

  _generateInWorker(text, { voice, speed, onStatus } = {}) {
    const worker = this._getWorker();
    const id = ++this._workerJobId;
    const promise = new Promise((resolve, reject) => {
      this._workerJobs.set(id, { resolve, reject, onStatus });
    });
    worker.postMessage({ type: 'generate', id, text, voice, speed });
    return {
      promise,
      cancel: () => this._workerJobs.delete(id),
    };
  }

  _withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message);
        err.code = 'kokoro-timeout';
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async _unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this._audioCtx = this._audioCtx || new Ctx();
      if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
    } catch {}
  }

  _playSamples(samples, samplingRate, job) {
    if (!samples || !samples.length) return Promise.reject(new Error('Kokoro returned no audio'));

    return new Promise((resolve, reject) => {
      let settled = false;
      const ctx = this._audioCtx;
      if (!ctx) { reject(new Error('AudioContext unavailable')); return; }

      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        try { source.onended = null; } catch {}
        if (this._currentSource === source) this._currentSource = null;
        if (error) reject(error); else resolve(value);
      };

      let source = null;
      try {
        const buffer = ctx.createBuffer(1, samples.length, samplingRate || 24000);
        buffer.copyToChannel(samples, 0);
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        this._currentSource = source;
        source.onended = () => finish('end');
        job.stopPlayback = () => {
          try { source.stop(); } catch {}
          finish('canceled');
        };
      } catch (err) {
        finish(null, err);
        return;
      }

      (async () => {
        try {
          if (this._paused) await this._waitForResume(job);
          if (this._isCanceled(job)) { finish('canceled'); return; }
          if (ctx.state === 'suspended') await ctx.resume();
          source.start();
        } catch (err) {
          finish(null, err);
        }
      })();
    });
  }

  _playRawAudio(rawAudio, job) {
    const blob = rawAudio?.toBlob ? rawAudio.toBlob() : null;
    if (!blob) return Promise.reject(new Error('Kokoro returned no audio'));

    return new Promise((resolve, reject) => {
      let settled = false;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this._currentAudio = audio;
      this._currentUrl = url;

      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        if (this._currentAudio === audio) this._cleanupAudio();
        if (error) reject(error); else resolve(value);
      };
      const onEnded = () => finish('end');
      const onError = () => finish(null, new Error('audio playback error'));
      job.stopPlayback = () => finish('canceled');

      audio.preload = 'auto';
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      (async () => {
        try {
          if (this._paused) await this._waitForResume(job);
          if (this._isCanceled(job)) { finish('canceled'); return; }
          await audio.play();
        } catch (err) {
          finish(null, err);
        }
      })();
    });
  }

  _waitForResume(job) {
    if (!this._paused || this._isCanceled(job)) return Promise.resolve();
    return new Promise(resolve => { job.resumeWaiter = resolve; });
  }

  _resolveResume(job = this._job) {
    if (!job?.resumeWaiter) return;
    const resolve = job.resumeWaiter;
    job.resumeWaiter = null;
    resolve();
  }

  _speakWithFallback(text, { voiceId, rate } = {}) {
    this.needsHeartbeat = this.fallback?.needsHeartbeat !== false;
    if (this.fallback?.isSupported()) return this.fallback.speakChunk(text, { voiceId, rate });
    return { promise: Promise.reject(new Error('no TTS provider available')), cancel() {} };
  }

  _speakFallbackChunk(text, { voiceId = '', rate, onStatus, label = 'Using system voice...' } = {}) {
    const speech = this._speakWithFallback(text, { voiceId, rate });
    const promise = (async () => {
      try {
        onStatus?.(label);
        return await speech.promise;
      } finally {
        onStatus?.('');
      }
    })();
    return { promise, cancel: () => speech.cancel?.() };
  }

  _isCanceled(job) {
    return !job || job.canceled || this._job !== job;
  }

  _cancelJob(job = this._job) {
    if (!job) return;
    job.canceled = true;
    this._resolveResume(job);
    try { job.fallbackSpeech?.cancel?.(); } catch {}
    try { job.stopPlayback?.(); } catch {}
    if (this._job === job) this._job = null;
  }

  _cleanupAudio() {
    const audio = this._currentAudio;
    const source = this._currentSource;
    const url = this._currentUrl;
    this._currentAudio = null;
    this._currentSource = null;
    this._currentUrl = null;
    try { audio?.pause(); } catch {}
    try { source?.stop?.(); } catch {}
    try { if (audio) audio.src = ''; } catch {}
    try { if (url) URL.revokeObjectURL(url); } catch {}
  }

  pause() {
    this._paused = true;
    try { this._currentAudio?.pause(); } catch {}
    try { if (this._currentSource && this._audioCtx?.state === 'running') this._audioCtx.suspend(); } catch {}
    try { this.fallback?.pause?.(); } catch {}
  }

  resume() {
    this._paused = false;
    this._resolveResume();
    try {
      const play = this._currentAudio?.play?.();
      play?.catch?.(() => {});
    } catch {}
    try { if (this._currentSource && this._audioCtx?.state === 'suspended') this._audioCtx.resume(); } catch {}
    try { this.fallback?.resume?.(); } catch {}
  }

  cancel() {
    this._cancelJob();
    this._cleanupAudio();
    this._paused = false;
    try { this.fallback?.cancel?.(); } catch {}
  }
}

// ── Engine: queue + repeat + delay + state (provider-agnostic) ───────────
class VoiceEngine {
  constructor(provider) {
    this.provider = provider;
    this.playlist = [];
    this.index = 0;
    this.state = 'idle';        // idle | playing | paused
    this.statusLabel = '';
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
    if (this.provider.needsHeartbeat === false) return;
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
    this.statusLabel = '';

    try { this.callbacks.onItemStart?.(item, i, this); } catch {}
    this._emitState();

    const { promise } = this.provider.speakChunk(item.text, {
      voiceId: this.settings.voiceId,
      rate: this.settings.rate,
      onStatus: label => {
        if (myToken !== this.token) return;
        this.statusLabel = label || '';
        this._emitState();
      },
    });
    this._startHeartbeat();

    const settle = (errored) => {
      if (myToken !== this.token) return;    // stale: stopped or restarted
      this._stopHeartbeat();
      this.statusLabel = '';
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
    this.statusLabel = '';
    this._pausedInDelay = false;
    this._endedWhilePaused = false;
    this.provider.cancel();
  }

  _finish() {
    this.token++;
    this._clearDelay();
    this._stopHeartbeat();
    this.statusLabel = '';
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
    const automaticLabel = this.engine.provider.defaultVoiceLabel || 'Automatic (best available)';
    sel.innerHTML =
      `<option value="">${escapeHtml(automaticLabel)}</option>` +
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
    this._$('.voice-sub').textContent = eng.statusLabel || (eng.playlist.length > 1 ? `${eng.index + 1} / ${eng.playlist.length}` : '');

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
const provider = new KokoroProvider(new WebSpeechProvider());
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
