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
    sendStatus(id, `Downloading Kokoro model ${Math.round(info.progress)}%`);
  } else if (info.status === 'ready') {
    sendStatus(id, 'Preparing Kokoro voice...');
  }
}

async function loadTts(id) {
  if (tts) return tts;
  if (!ttsPromise) {
    ttsPromise = (async () => {
      sendStatus(id, 'Loading Kokoro code...');
      const { KokoroTTS } = await import(KOKORO_MODULE_URL);
      sendStatus(id, 'Downloading Kokoro model...');
      tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: info => reportProgress(id, info),
      });
      self.postMessage({ type: 'ready' });
      return tts;
    })();
    ttsPromise.catch(() => {
      ttsPromise = null;
      tts = null;
    });
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
      sendStatus(msg.id, 'Generating Kokoro audio...');
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
