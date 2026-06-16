// Kokoro TTS web worker — loads the model off the main thread and synthesizes
// audio.
//
// Backend: prefer WebGPU (fp32) for fast generation; fall back to WASM (q8) so
// it still works on devices without WebGPU. WebGPU does NOT require
// cross-origin isolation (only WASM threads do), so this works on plain static
// hosting (localhost, GitHub Pages).
//
// Protocol (main thread <-> worker):
//   <- { type:'warm' }                      start loading the model
//   <- { type:'generate', id, text, voice, speed }
//   -> { type:'status', id, label }         progress / stage text (id null = warm load)
//   -> { type:'ready' }                     model finished loading
//   -> { type:'result', id, audio, samplingRate }
//   -> { type:'error', id, message }        (id null = load failure)

const KOKORO_MODULE_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let ttsPromise = null;
let tts = null;

function sendStatus(id, label) {
  self.postMessage({ type: 'status', id, label });
}

function reportProgress(id, info) {
  if (!info) return;
  if (info.status === 'progress' && Number.isFinite(info.progress)) {
    const pct = Math.round(info.progress);
    const mb = info.total
      ? ` (${Math.round((info.loaded || 0) / 1048576)}/${Math.round(info.total / 1048576)} MB)`
      : '';
    sendStatus(id, `Downloading voice ${pct}%${mb}`);
  } else if (info.status === 'done' || info.status === 'ready') {
    sendStatus(id, 'Preparing voice…');
  }
}

async function pickBackend() {
  // WebGPU = fast generation (recommended dtype fp32). WASM = universal fallback.
  try {
    if (self.navigator && self.navigator.gpu) {
      const adapter = await self.navigator.gpu.requestAdapter();
      if (adapter) return { device: 'webgpu', dtype: 'fp32' };
    }
  } catch {}
  return { device: 'wasm', dtype: 'q8' };
}

function fromPretrained(id, cfg, KokoroTTS) {
  sendStatus(id, cfg.device === 'webgpu' ? 'Downloading voice (GPU)…' : 'Downloading voice…');
  return KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
    dtype: cfg.dtype,
    device: cfg.device,
    progress_callback: info => reportProgress(id, info),
  });
}

async function loadTts(id) {
  if (tts) return tts;
  if (!ttsPromise) {
    ttsPromise = (async () => {
      sendStatus(id, 'Loading voice engine…');
      const { KokoroTTS } = await import(KOKORO_MODULE_URL);
      const cfg = await pickBackend();
      try {
        tts = await fromPretrained(id, cfg, KokoroTTS);
      } catch (err) {
        // WebGPU can fail on some machines/drivers; degrade to WASM q8.
        if (cfg.device === 'webgpu') {
          sendStatus(id, 'GPU unavailable, using CPU…');
          tts = await fromPretrained(id, { device: 'wasm', dtype: 'q8' }, KokoroTTS);
        } else {
          throw err;
        }
      }
      self.postMessage({ type: 'ready' });
      return tts;
    })();
    // On failure, reset so a later attempt can retry from scratch.
    ttsPromise.catch(() => { ttsPromise = null; tts = null; });
  }
  return ttsPromise;
}

self.addEventListener('message', event => {
  const msg = event.data || {};

  if (msg.type === 'warm') {
    loadTts(null).catch(err => {
      self.postMessage({ type: 'error', id: null, message: err?.message || String(err) });
    });
    return;
  }

  if (msg.type !== 'generate') return;

  (async () => {
    try {
      const model = await loadTts(msg.id);
      sendStatus(msg.id, 'Generating audio…');
      const raw = await model.generate(msg.text || '', {
        voice: msg.voice,
        speed: msg.speed,
      });
      const samples = raw.audio;
      self.postMessage({
        type: 'result',
        id: msg.id,
        audio: samples.buffer,
        samplingRate: raw.sampling_rate,
      }, [samples.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: err?.message || String(err) });
    }
  })();
});
