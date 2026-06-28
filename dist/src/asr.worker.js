const APP_VERSION = 'DEV2.9';
const ASR_SAMPLE_RATE = 16000;
const TRANSFORMERS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  'https://unpkg.com/@huggingface/transformers@3.5.2',
  'https://unpkg.com/@huggingface/transformers@3',
];

const FALLBACK_MODELS = new Map([
  ['onnx-community/whisper-tiny_timestamped', 'Xenova/whisper-tiny'],
  ['onnx-community/whisper-base_timestamped', 'Xenova/whisper-base'],
  ['onnx-community/whisper-small_timestamped', 'Xenova/whisper-small'],
]);

const pipelineCache = new Map();
let transformersModule = null;

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function normalizeWord(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9']/g, '')
    .trim();
}

async function importTransformers() {
  if (transformersModule) return transformersModule;
  let lastError = null;
  for (const url of TRANSFORMERS_URLS) {
    try {
      post('status', { text: `Chargement Transformers.js (${new URL(url).host})...` });
      transformersModule = await import(url);
      return transformersModule;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Impossible de charger Transformers.js. ${lastError?.message || ''}`.trim());
}

function configureEnv(env) {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  try {
    const concurrency = self.navigator?.hardwareConcurrency || 1;
    const threads = Math.max(1, Math.min(4, concurrency));
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = threads;
    }
    post('status', { text: `WASM threads demandés: ${threads}${self.crossOriginIsolated ? ' (isolated)' : ' (non isolated)'}` });
  } catch (_) {}
}

async function loadPipeline(model, device, progressId = '') {
  const { pipeline, env } = await importTransformers();
  configureEnv(env);
  const key = `${model}::${device}`;
  if (pipelineCache.has(key)) return pipelineCache.get(key);

  post('status', { text: `Chargement modèle ${model} (${device})...` });
  const options = {
    device,
    progress_callback: (event) => {
      if (event?.status === 'progress' && Number.isFinite(event.progress)) {
        post('progress', { phase: 'model', pct: Math.max(0, Math.min(55, event.progress * 0.55)), file: event.file || '', progressId });
      } else if (event?.status) {
        post('status', { text: `Modèle: ${event.status}${event.file ? ` - ${event.file}` : ''}` });
      }
    },
  };

  try {
    const transcriber = await pipeline('automatic-speech-recognition', model, options);
    pipelineCache.set(key, transcriber);
    return transcriber;
  } catch (error) {
    const fallback = FALLBACK_MODELS.get(model);
    if (!fallback) throw error;
    post('status', { text: `Modèle timestamped indisponible. Repli ${fallback}.` });
    const fallbackKey = `${fallback}::${device}`;
    if (pipelineCache.has(fallbackKey)) return pipelineCache.get(fallbackKey);
    const transcriber = await pipeline('automatic-speech-recognition', fallback, options);
    pipelineCache.set(fallbackKey, transcriber);
    return transcriber;
  }
}

function extractAsrWords(output) {
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const words = [];
  for (const chunk of chunks) {
    const text = String(chunk?.text || '').trim();
    const ts = chunk?.timestamp || chunk?.timestamps;
    if (!text || !Array.isArray(ts)) continue;
    let start = Number(ts[0]);
    let end = Number(ts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= start) end = start + 0.18;
    const norm = normalizeWord(text);
    if (!norm) continue;
    words.push({ text, norm, start, end });
  }
  words.sort((a, b) => a.start - b.start);
  return words;
}

async function runTranscription(message) {
  const { pcm, model, device, language, progressId } = message;
  if (!(pcm instanceof Float32Array)) throw new Error('PCM invalide côté worker.');
  const runtime = device || 'wasm';
  const transcriber = await loadPipeline(model, runtime, progressId);

  post('progress', { phase: 'asr', pct: 62, progressId });
  post('status', { text: `Transcription complète en cours (${Math.round(pcm.length / ASR_SAMPLE_RATE)}s audio, chunk natif Whisper 30s / stride 5s).` });

  const options = {
    task: 'transcribe',
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
  };
  if (language) options.language = language;

  try {
    options.callback_function = (item) => {
      const text = String(item?.text || item || '').trim();
      if (text) post('partial', { text, progressId });
    };
  } catch (_) {}

  const output = await transcriber(pcm, options);
  const words = extractAsrWords(output);
  post('progress', { phase: 'asr_done', pct: 88, progressId });
  post('done', { words, text: String(output?.text || '').trim(), appVersion: APP_VERSION, progressId });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== 'run') return;
  runTranscription(message).catch((error) => {
    post('error', { message: error?.message || String(error) });
  });
};
