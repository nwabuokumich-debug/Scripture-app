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

const KOKORO_WORKER_URL = './kokoro-worker.js?v=4';
const KOKORO_DEFAULT_VOICE = 'af_heart';
const KOKORO_VOICE_PREFIX = 'kokoro:';
const KOKORO_WARM_WATCHDOG_MS = 300000;     // give a cold model load up to 5 min before declaring failure
const KOKORO_GENERATE_TIMEOUT_MS = 60000;   // per-verse synth safety once the model is ready
const KOKORO_RETRY_COOLDOWN_MS = 120000;    // after a HARD load error, wait before retrying
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
    this._worker = null;
    this._workerJobs = new Map();
    this._workerJobId = 0;
    this._workerReady = false;
    this._loadState = 'idle';        // idle | loading | ready | error
    this._loadLabel = '';            // latest download/progress label
    this._errorCooldownUntil = 0;    // only after a HARD load error
    this._warmWatchdog = null;
    this._audioCache = new Map();    // key -> { samples, samplingRate } (prefetch)
    this._inflight = new Map();      // key -> Promise (dedupe generation)
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
    // A non-Kokoro selection ('' = system default) goes straight to Web Speech.
    if (!this._shouldUseKokoro(voiceId)) {
      return this._speakWithFallback(text, { voiceId, rate });
    }
    if (!this._canPlayAudio()) {
      return this._speakFallbackChunk(text, { rate, onStatus, label: 'Using system voice...' });
    }

    // Kokoro selected but the model isn't ready: read THIS verse with the
    // system voice while the model keeps downloading in the background. No
    // blocking timeout and no cooldown — the next verse picks up Kokoro once
    // it's ready. (Hard load failures show a clear "unavailable" message.)
    if (!this._workerReady) {
      this._warmKokoro();
      const label = this._loadState === 'error'
        ? 'Kokoro unavailable — using system voice'
        : (this._loadLabel || 'Loading Kokoro voice…');
      return this._speakFallbackChunk(text, { rate, onStatus, label });
    }

    // Model is ready → synthesize with Kokoro (served from the prefetch cache
    // when available, so chapter playback is gapless).
    this.needsHeartbeat = false;
    const job = { canceled: false, fallbackSpeech: null, stopPlayback: null, resumeWaiter: null };
    this._cancelJob(this._job);
    this._job = job;
    this._paused = false;

    const promise = (async () => {
      try {
        await this._unlockAudio();
        const cached = this._audioCache.get(this._genKey(voiceId, rate, text));
        if (!cached) onStatus?.('Generating Kokoro audio…');
        const audio = await this._withTimeout(
          this._ensureGenerated(text, { voiceId, rate }),
          KOKORO_GENERATE_TIMEOUT_MS,
          'Kokoro generation timed out'
        );
        if (this._isCanceled(job)) return 'canceled';
        onStatus?.('');
        return await this._playSamples(audio.samples, audio.samplingRate, job);
      } catch (err) {
        this._cleanupAudio();
        if (this._isCanceled(job)) return 'canceled';
        try { console.warn('Kokoro generation failed; using system voice for this verse.', err); } catch {}
        // Fall back for THIS verse only — keep Kokoro enabled for the next one.
        if (this.fallback?.isSupported()) {
          onStatus?.('Using system voice...');
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

  // Generate (or reuse) Kokoro audio for a chunk, de-duped and cached so a
  // prefetched verse plays instantly. Returns { samples, samplingRate }.
  _genKey(voiceId, rate, text) {
    return `${this._voiceName(voiceId)}|${clampRate(rate)}|${text}`;
  }
  _ensureGenerated(text, { voiceId, rate } = {}) {
    const key = this._genKey(voiceId, rate, text);
    const cached = this._audioCache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this._inflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      const gen = this._generateInWorker(text, { voice: this._voiceName(voiceId), speed: clampRate(rate) });
      const audio = await gen.promise;
      // Keep a small bounded cache (the current + a few prefetched verses).
      this._audioCache.set(key, audio);
      while (this._audioCache.size > 4) {
        this._audioCache.delete(this._audioCache.keys().next().value);
      }
      return audio;
    })();
    this._inflight.set(key, p);
    p.finally(() => { if (this._inflight.get(key) === p) this._inflight.delete(key); }).catch(() => {});
    return p;
  }

  // Called by the engine for the upcoming verse so it's ready before we need it.
  prefetch(text, { voiceId, rate } = {}) {
    if (!this._shouldUseKokoro(voiceId) || !this._workerReady || !this._canPlayAudio()) return;
    if (!text || !text.trim()) return;
    this._ensureGenerated(text, { voiceId, rate }).catch(() => {});
  }

  _shouldUseKokoro(voiceId) {
    return String(voiceId || '').startsWith(KOKORO_VOICE_PREFIX);
  }

  // Start loading the model in the background (idempotent). Loading is never
  // gated by a per-utterance timeout — only a generous watchdog guards a true
  // hang, after which we degrade cleanly to the system voice.
  _warmKokoro() {
    if (this._workerReady || this._loadState === 'loading' || !this._canPlayAudio()) return;
    if (this._loadState === 'error' && Date.now() < this._errorCooldownUntil) return;
    this._loadState = 'loading';
    this._loadLabel = 'Loading Kokoro voice…';
    try {
      this._getWorker().postMessage({ type: 'warm' });
      this._armWarmWatchdog();
    } catch {
      this._markLoadError();
    }
  }

  _armWarmWatchdog() {
    if (this._warmWatchdog) clearTimeout(this._warmWatchdog);
    this._warmWatchdog = setTimeout(() => {
      if (!this._workerReady) this._markLoadError();
    }, KOKORO_WARM_WATCHDOG_MS);
  }

  _markLoadError() {
    this._loadState = 'error';
    this._loadLabel = '';
    this._errorCooldownUntil = Date.now() + KOKORO_RETRY_COOLDOWN_MS;
    if (this._warmWatchdog) { clearTimeout(this._warmWatchdog); this._warmWatchdog = null; }
    // Drop the worker so a retry after the cooldown starts fresh.
    try { this._worker?.terminate?.(); } catch {}
    this._worker = null;
    this._workerJobs.clear();
  }

  // Called when the user selects a voice — warm Kokoro ahead of the first play.
  onVoiceSelected(voiceId) {
    if (this._shouldUseKokoro(voiceId)) this._warmKokoro();
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
        this._loadState = 'ready';
        this._loadLabel = '';
        if (this._warmWatchdog) { clearTimeout(this._warmWatchdog); this._warmWatchdog = null; }
        return;
      }

      // Background-load messages carry id === null (no per-job owner).
      if (msg.id == null) {
        if (msg.type === 'status') this._loadLabel = msg.label || '';
        else if (msg.type === 'error') this._markLoadError();
        return;
      }

      const job = this._workerJobs.get(msg.id);
      if (!job) return;

      if (msg.type === 'status') {
        job.onStatus?.(msg.label || '');
      } else if (msg.type === 'result') {
        this._workerReady = true;
        this._loadState = 'ready';
        if (this._warmWatchdog) { clearTimeout(this._warmWatchdog); this._warmWatchdog = null; }
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
    worker.addEventListener('error', () => {
      const err = new Error('Kokoro worker error');
      for (const [, job] of this._workerJobs) job.reject(err);
      this._workerJobs.clear();
      this._markLoadError();
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
      item,                                  // providers keyed by verse ref need this
      onStatus: label => {
        if (myToken !== this.token) return;
        this.statusLabel = label || '';
        this._emitState();
      },
    });
    this._startHeartbeat();

    // Prefetch the next verse's audio so playback is gapless.
    const nextItem = this.playlist[i + 1];
    if (nextItem && this.provider.prefetch) {
      try { this.provider.prefetch(nextItem.text, { voiceId: this.settings.voiceId, rate: this.settings.rate, item: nextItem }); } catch {}
    }

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
  setVoice(voiceId)     { this.settings.voiceId = voiceId || ''; saveVoiceSettings(this.settings); try { this.provider.onVoiceSelected?.(this.settings.voiceId); } catch {} this._emitState(); }
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
      <div class="voice-compact">
        <button class="voice-btn voice-compact-toggle" type="button" aria-label="Pause" aria-pressed="true">⏸</button>
        <div class="voice-compact-label" aria-live="polite">
          <span class="voice-compact-ref"></span>
          <span class="voice-compact-sub"></span>
        </div>
        <button class="voice-btn voice-expand-toggle" type="button" aria-label="Expand player" aria-expanded="false">▲</button>
      </div>
      <div class="voice-expanded" hidden>
        <div class="voice-header">
          <div class="voice-label" aria-live="polite">
            <span class="voice-ref"></span>
            <span class="voice-sub"></span>
          </div>
          <button class="voice-btn voice-collapse" type="button" aria-label="Minimize player">▼</button>
        </div>
        <div class="voice-transport">
          <button class="voice-btn voice-prev" type="button" aria-label="Previous verse">⏮</button>
          <button class="voice-btn voice-toggle" type="button" aria-label="Pause" aria-pressed="true">⏸</button>
          <button class="voice-btn voice-next" type="button" aria-label="Next verse">⏭</button>
        </div>
        <div class="voice-tray">
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
        <button class="voice-stop" type="button">Stop reading</button>
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

    const togglePlay = () => {
      if (eng.state === 'playing') eng.pauseScripture();
      else if (eng.state === 'paused') eng.resumeScripture();
    };
    this._$('.voice-compact-toggle').addEventListener('click', togglePlay);
    this._$('.voice-toggle').addEventListener('click', togglePlay);

    this._$('.voice-stop').addEventListener('click', () => eng.stopScripture());
    this._$('.voice-prev').addEventListener('click', () => eng.prev());
    this._$('.voice-next').addEventListener('click', () => eng.next());

    this._$('.voice-expand-toggle').addEventListener('click', () => this._setExpanded(true));
    this._$('.voice-collapse').addEventListener('click', () => this._setExpanded(false));

    this._$('.voice-rate-down').addEventListener('click', () => eng.setPlaybackRate(eng.settings.rate - RATE_STEP));
    this._$('.voice-rate-up').addEventListener('click',   () => eng.setPlaybackRate(eng.settings.rate + RATE_STEP));
    this._$('.voice-delay-down').addEventListener('click', () => eng.setRepeatDelay(eng.settings.repeatDelayMs - DELAY_STEP));
    this._$('.voice-delay-up').addEventListener('click',   () => eng.setRepeatDelay(eng.settings.repeatDelayMs + DELAY_STEP));

    this.el.querySelectorAll('.voice-repeat-btn').forEach(btn => {
      btn.addEventListener('click', () => eng.setRepeatMode(btn.dataset.mode));
    });
    this._$('.voice-select').addEventListener('change', e => eng.setVoice(e.target.value));

    // Collapse when tapping outside the player (but not on another control).
    document.addEventListener('click', e => {
      if (!this.el.classList.contains('expanded')) return;
      if (this.el.contains(e.target)) return;
      this._setExpanded(false);
    });
  }

  _setExpanded(expanded) {
    const expandedEl = this._$('.voice-expanded');
    if (expanded) {
      expandedEl.removeAttribute('hidden');
      this.el.classList.add('expanded');
      this._$('.voice-expand-toggle').setAttribute('aria-expanded', 'true');
    } else {
      expandedEl.setAttribute('hidden', '');
      this.el.classList.remove('expanded');
      this._$('.voice-expand-toggle').setAttribute('aria-expanded', 'false');
    }
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
    const refText = item ? item.ref : '';
    const subText = eng.statusLabel || (eng.playlist.length > 1 ? `${eng.index + 1} / ${eng.playlist.length}` : '');

    // Compact + expanded labels stay in sync.
    this._$('.voice-ref').textContent = refText;
    this._$('.voice-sub').textContent = subText;
    this._$('.voice-compact-ref').textContent = refText;
    this._$('.voice-compact-sub').textContent = subText;

    const isPaused = eng.state === 'paused';
    [this._$('.voice-toggle'), this._$('.voice-compact-toggle')].forEach(btn => {
      if (!btn) return;
      if (isPaused) {
        btn.textContent = '▶';
        btn.setAttribute('aria-label', 'Resume');
        btn.setAttribute('aria-pressed', 'false');
      } else {
        btn.textContent = '⏸';
        btn.setAttribute('aria-label', 'Pause');
        btn.setAttribute('aria-pressed', 'true');
      }
    });

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

// ── Provider: pre-rendered audio files (OpenAI TTS, cached in Storage) ───
// A verse that has been rendered before is a plain CDN fetch — instant, free,
// and identical every time. A verse nobody has played yet is rendered once by
// the `tts` Edge Function (which holds the API key), stored, and then behaves
// like every other cached verse forever after.
//
// Anything that fails — offline, function down, verse missing — falls through
// to the wrapped provider so playback never simply dies.
// config.js is a classic script loaded before app.js, so this is a global.
// typeof-guarded so the module still parses if it's ever loaded standalone.
const SUPABASE_PROJECT_URL = (typeof SUPABASE_URL === 'string' && SUPABASE_URL) || '';
// Public key, already shipped in config.js. The Edge Function gateway rejects
// requests without it even though the function itself does no auth.
const SUPABASE_PUBLIC_KEY = (typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY) || '';
const AUDIO_BUCKET_URL = `${SUPABASE_PROJECT_URL}/storage/v1/object/public/scripture-audio`;
const TTS_FUNCTION_URL = `${SUPABASE_PROJECT_URL}/functions/v1/tts`;
const AUDIO_VOICE = 'marin';
const RENDER_TIMEOUT_MS = 30000;

// Must match slugForRef() in render-audio.mjs and the Edge Function.
function slugForRef(ref) {
  return String(ref).trim().replace(/\s+/g, '-').replace(/:/g, '-');
}

class AudioFileProvider {
  constructor(fallback) {
    this.name = 'audiofile';
    this.defaultVoiceLabel = 'Marin (recorded)';
    this.needsHeartbeat = false;   // a real <audio> element needs no keep-alive
    this.fallback = fallback;
    this._el = null;
    this._objectUrls = new Map();  // storage url -> blob object URL
    this._inflight = new Map();    // storage url -> Promise<objectURL>
    this._misses = new Set();      // refs known unrenderable; don't retry all session
    this._settle = null;
    this._fallbackHandle = null;
  }

  isSupported() {
    return this._canPlay() || !!this.fallback?.isSupported();
  }

  _canPlay() {
    return typeof window !== 'undefined'
      && typeof Audio === 'function'
      && typeof fetch === 'function'
      && !!window.URL?.createObjectURL;
  }

  // The voice picker still belongs to the fallback chain — those voices apply
  // to anything this provider can't serve.
  getVoices(...args) { return this.fallback.getVoices(...args); }
  onVoiceSelected(...args) { return this.fallback.onVoiceSelected?.(...args); }

  _translation() {
    try { return localStorage.getItem('active_translation') || 'kjv'; } catch { return 'kjv'; }
  }

  _storageUrl(ref) {
    return `${AUDIO_BUCKET_URL}/${this._translation()}/${slugForRef(ref)}.mp3`;
  }

  // Audio committed to the repo, served straight off GitHub Pages. Lets a
  // rendered chapter work with no Supabase setup at all.
  _localUrl(ref) {
    return `./audio/${this._translation()}/${slugForRef(ref)}.mp3`;
  }

  // One <audio> element for the whole session. iOS only unlocks playback on a
  // user gesture, and the unlock is per-element — reusing it is what lets
  // verse 2 onward play without another tap.
  _element() {
    if (!this._el) {
      this._el = new Audio();
      this._el.preload = 'auto';
      this._el.crossOrigin = 'anonymous';
    }
    return this._el;
  }

  // Resolve a ref to a playable object URL: try Storage, then render on miss.
  _resolve(ref) {
    const url = this._storageUrl(ref);
    if (this._objectUrls.has(url)) return Promise.resolve(this._objectUrls.get(url));
    if (this._inflight.has(url)) return this._inflight.get(url);

    const job = (async () => {
      // 1. Repo-committed audio (no Supabase needed at all).
      let res = await fetch(this._localUrl(ref), { cache: 'force-cache' }).catch(() => null);

      // 2. Storage — the normal path once a verse has ever been rendered.
      if (!res?.ok) res = await fetch(url, { cache: 'force-cache' }).catch(() => null);

      if (!res?.ok) {
        // Not rendered yet — ask the Edge Function to make it, then re-fetch.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), RENDER_TIMEOUT_MS);
        try {
          const gen = await fetch(TTS_FUNCTION_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_PUBLIC_KEY}`,
              'apikey': SUPABASE_PUBLIC_KEY,
            },
            body: JSON.stringify({ ref, translation: this._translation(), voice: AUDIO_VOICE }),
            signal: ctrl.signal,
          });
          if (!gen.ok) throw new Error(`tts ${gen.status}`);
          const { url: rendered } = await gen.json();
          res = await fetch(rendered || url);
        } finally {
          clearTimeout(timer);
        }
      }

      if (!res?.ok) throw new Error(`audio unavailable for ${ref}`);
      // A host that serves an HTML 404 page with a 200 status would otherwise
      // produce a blob that only fails later, inside the audio element.
      if (!/^audio\//i.test(res.headers.get('content-type') || '')) {
        throw new Error(`not audio for ${ref}`);
      }
      const objectUrl = URL.createObjectURL(await res.blob());
      this._objectUrls.set(url, objectUrl);
      return objectUrl;
    })().finally(() => this._inflight.delete(url));

    this._inflight.set(url, job);
    return job;
  }

  speakChunk(text, opts = {}) {
    const ref = opts.item?.ref;

    // No ref (or a ref we already know has no audio) → straight to fallback.
    if (!ref || !this._canPlay() || this._misses.has(ref)) {
      return this.fallback.speakChunk(text, opts);
    }

    let cancelled = false;

    const promise = (async () => {
      let src;
      try {
        src = await this._resolve(ref);
      } catch {
        this._misses.add(ref);
        if (cancelled) return;
        opts.onStatus?.('');
        this._fallbackHandle = this.fallback.speakChunk(text, opts);
        return this._fallbackHandle.promise;
      }
      if (cancelled) return;
      opts.onStatus?.('');
      return this._play(src, opts.rate);
    })();

    // A first-time verse takes a few seconds to render; say so rather than
    // sitting silent.
    if (!this._objectUrls.has(this._storageUrl(ref))) opts.onStatus?.('Preparing audio…');

    return {
      promise,
      cancel: () => {
        cancelled = true;
        try { this._fallbackHandle?.cancel(); } catch {}
        this._fallbackHandle = null;
        this._stopElement();
      },
    };
  }

  _play(src, rate = 1) {
    const el = this._element();
    return new Promise((resolve, reject) => {
      this._settle = { resolve, reject };
      const done = (fn) => (...a) => { this._settle = null; el.onended = el.onerror = null; fn(...a); };
      el.onended = done(resolve);
      el.onerror = done(() => reject(new Error('audio element error')));
      el.src = src;
      el.playbackRate = rate || 1;
      el.play().catch(done(reject));
    });
  }

  _stopElement() {
    const el = this._el;
    if (!el) return;
    el.onended = el.onerror = null;
    try { el.pause(); } catch {}
    try { el.removeAttribute('src'); el.load(); } catch {}
    this._settle = null;
  }

  // Warm the next verse while the current one plays, so a first-time chapter
  // doesn't stall between every verse.
  prefetch(text, opts = {}) {
    const ref = opts.item?.ref;
    if (!ref || this._misses.has(ref) || !this._canPlay()) return;
    this._resolve(ref).catch(() => {});
  }

  pause() {
    if (this._fallbackHandle) return this.fallback.pause();
    try { this._el?.pause(); } catch {}
  }

  resume() {
    if (this._fallbackHandle) return this.fallback.resume();
    try { this._el?.play?.().catch(() => {}); } catch {}
  }

  cancel() {
    try { this.fallback.cancel(); } catch {}
    this._fallbackHandle = null;
    this._stopElement();
  }
}

// ── Singleton wiring ─────────────────────────────────────────────────────
const provider = new AudioFileProvider(new KokoroProvider(new WebSpeechProvider()));
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
  // If the saved voice is a Kokoro voice, start downloading the model now so
  // it's ready (or close) by the time the user hits Play.
  try { provider.onVoiceSelected?.(engine.settings.voiceId); } catch {}
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
