import { aggregateTokenPathToWords, ctcTrellisAlign, logSoftmaxRows } from './forced-align.js';
import { buildTokenIds } from './ctc-tokens.js';

const TRANSFORMERS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  'https://unpkg.com/@huggingface/transformers@3.5.2',
  'https://unpkg.com/@huggingface/transformers@3',
];
const DEFAULT_MODEL_FR = 'Poulpidot/wav2vec2-large-xlsr-53-french-onnx';
const FALLBACK_MODEL = 'Xenova/wav2vec2-base-960h';
let transformersModule = null;
let modelCache = null;
let tokenizerCache = null;
let processorCache = null;
let cacheKey = '';

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }
function diagnostic(payload = {}) { post('diagnostic', payload); }
function countSegmentWords(segments = []) { return segments.reduce((sum, segment) => sum + ((segment.words || []).filter((word) => word?.norm).length), 0); }

async function importTransformers() {
  if (transformersModule) return transformersModule;
  let last = null;
  for (const url of TRANSFORMERS_URLS) {
    try {
      post('status', { text: `Chargement module CTC (${new URL(url).host})...` });
      transformersModule = await import(url);
      return transformersModule;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`Impossible de charger Transformers.js pour alignement forcé. ${last?.message || ''}`.trim());
}

function configureEnv(env) {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  try {
    const threads = Math.max(1, Math.min(4, self.navigator?.hardwareConcurrency || 1));
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = threads;
  } catch (_) {}
}

async function loadCtc(modelId, device) {
  const t = await importTransformers();
  configureEnv(t.env);
  const candidates = [modelId || DEFAULT_MODEL_FR, FALLBACK_MODEL].filter(Boolean);
  let lastError = null;
  for (const candidate of candidates) {
    const key = `${candidate}::${device || 'wasm'}`;
    if (modelCache && cacheKey === key) return { model: modelCache, tokenizer: tokenizerCache, processor: processorCache, modelId: candidate };
    try {
      post('status', { text: `Chargement modèle CTC ${candidate}...` });
      diagnostic({ status: 'CTC model loading', modelId: candidate });
      const AutoModelForCTC = t.AutoModelForCTC || t.Wav2Vec2ForCTC || t.AutoModel;
      if (!AutoModelForCTC || !t.AutoTokenizer) throw new Error('Classes CTC indisponibles dans Transformers.js.');
      const options = {
        device: device || 'wasm',
        progress_callback: (event) => {
          if (event?.status === 'progress' && Number.isFinite(event.progress)) post('progress', { pct: Math.min(35, event.progress * 0.35) });
        },
      };
      const [model, tokenizer, processor] = await Promise.all([
        AutoModelForCTC.from_pretrained(candidate, options),
        t.AutoTokenizer.from_pretrained(candidate),
        t.AutoProcessor ? t.AutoProcessor.from_pretrained(candidate).catch(() => null) : Promise.resolve(null),
      ]);
      modelCache = model;
      tokenizerCache = tokenizer;
      processorCache = processor;
      cacheKey = key;
      diagnostic({ status: 'CTC model loaded', modelId: candidate, processor: Boolean(processor), tokenizerModel: tokenizer?.model?.constructor?.name || 'unknown' });
      return { model, tokenizer, processor, modelId: candidate };
    } catch (error) {
      lastError = error;
      diagnostic({ status: 'CTC model failed', modelId: candidate, fallbackReason: error?.message || String(error) });
      post('status', { text: `Échec CTC ${candidate}. ${candidate !== FALLBACK_MODEL ? 'Tentative repli...' : ''}` });
    }
  }
  throw lastError || new Error('Impossible de charger un modèle CTC.');
}

function slicePcm(pcm, sampleRate, start, end) {
  const a = Math.max(0, Math.floor(start * sampleRate));
  const b = Math.min(pcm.length, Math.ceil(end * sampleRate));
  return pcm.slice(a, b);
}


function normalizeInputPcm(inputPcm) {
  let sum = 0;
  for (let i = 0; i < inputPcm.length; i += 1) sum += inputPcm[i] || 0;
  const mean = sum / Math.max(1, inputPcm.length);
  let variance = 0;
  for (let i = 0; i < inputPcm.length; i += 1) {
    const d = (inputPcm[i] || 0) - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / Math.max(1, inputPcm.length)) || 1;
  const out = new Float32Array(inputPcm.length);
  for (let i = 0; i < inputPcm.length; i += 1) out[i] = ((inputPcm[i] || 0) - mean) / std;
  return out;
}

async function runModel(model, processor, inputPcm, sampleRate) {
  if (processor) {
    diagnostic({ status: 'CTC processor run', samples: inputPcm.length, sampleRate });
    const inputs = await processor(inputPcm, { sampling_rate: sampleRate });
    return model(inputs);
  }

  const Tensor = transformersModule?.Tensor;
  if (!Tensor) throw new Error('Processor CTC indisponible et Tensor Transformers.js indisponible.');
  diagnostic({ status: 'CTC processor missing - manual normalized tensor', samples: inputPcm.length, sampleRate });
  const normalized = normalizeInputPcm(inputPcm);
  const input_values = new Tensor('float32', normalized, [1, normalized.length]);
  return model({ input_values });
}

function logitsFromOutput(output) {
  const tensor = output?.logits;
  if (!tensor?.data || !tensor?.dims) throw new Error('Logits CTC absents (modèle sans tête CTC ?)');
  return { data: tensor.data, dims: tensor.dims };
}


async function alignSegment(ctx, segment, pcm, sampleRate, index, total) {
  const start = Math.max(0, Number(segment.start) || 0);
  const end = Math.max(start + 0.25, Number(segment.end) || start + 0.25);
  const words = (segment.words || []).filter((word) => word?.norm);
  if (!words.length) return [];
  const { tokenIds, tokenToWord, blank } = buildTokenIds(words, ctx.tokenizer);
  diagnostic({ status: 'CTC segment tokens', segmentIndex: index, requestedWords: words.length, tokenCount: tokenIds.length });
  if (!tokenIds.length) return [];
  const chunk = slicePcm(pcm, sampleRate, start, end);
  if (chunk.length < sampleRate * 0.18) return [];
  post('status', { text: `Alignement forcé ${index + 1}/${total}: ${segment.text.slice(0, 42)}` });
  const output = await runModel(ctx.model, ctx.processor, chunk, sampleRate);
  const { data, dims } = logitsFromOutput(output);
  const frames = dims[dims.length - 2];
  if (!frames || frames < tokenIds.length) {
    diagnostic({ status: 'CTC segment skipped', segmentIndex: index, requestedWords: words.length, frames: frames || 0, tokenCount: tokenIds.length });
    return [];
  }
  const wanted = [blank, ...tokenIds];
  const emissions = logSoftmaxRows(data, dims, wanted);
  const path = ctcTrellisAlign(emissions, tokenIds, blank);
  const frameSeconds = (end - start) / Math.max(1, frames);
  const local = aggregateTokenPathToWords(path, tokenToWord, frameSeconds, start);
  diagnostic({ status: 'CTC segment aligned', segmentIndex: index, requestedWords: words.length, alignedWords: local.length, frames, tokenCount: tokenIds.length });
  return local.map((item) => ({
    lineIndex: segment.lineIndex,
    wordIndex: item.wordIndex,
    start: item.start,
    end: Math.max(item.end, item.start + 0.04),
    score: item.score,
  }));
}

async function runForcedAlign(message) {
  const { pcm16k, sampleRate = 16000, language = 'french', segments = [], modelId, device = 'wasm' } = message;
  if (!(pcm16k instanceof Float32Array)) throw new Error('PCM 16k manquant pour alignement forcé.');
  if (!Array.isArray(segments) || !segments.length) throw new Error('Segments manquants pour alignement forcé.');
  const requestedWords = countSegmentWords(segments);
  diagnostic({ status: 'CTC requested', segments: segments.length, requestedWords, alignedWords: 0, segmentsOk: 0, segmentsFailed: 0 });
  const selectedModel = modelId || (String(language).toLowerCase().startsWith('fr') ? DEFAULT_MODEL_FR : FALLBACK_MODEL);
  const ctx = await loadCtc(selectedModel, device === 'webgpu' ? 'webgpu' : 'wasm');
  post('status', { text: `CTC prêt: ${ctx.modelId}. Trellis par fenêtre.` });
  diagnostic({ status: 'CTC ready', modelId: ctx.modelId, segments: segments.length, requestedWords });
  const aligned = [];
  const total = segments.length;
  let segmentsOk = 0;
  let segmentsFailed = 0;
  for (let i = 0; i < total; i += 1) {
    const pct = 35 + (i / Math.max(1, total)) * 60;
    post('progress', { pct });
    try {
      const local = await alignSegment(ctx, segments[i], pcm16k, sampleRate, i, total);
      if (local.length) segmentsOk += 1;
      else segmentsFailed += 1;
      aligned.push(...local);
      diagnostic({ status: 'CTC running', segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length });
    } catch (error) {
      segmentsFailed += 1;
      diagnostic({ status: 'CTC segment error', segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length, fallbackReason: error?.message || String(error) });
      post('status', { text: `Segment non aligné, repli ASR: ${error?.message || error}` });
    }
  }
  post('progress', { pct: 98 });
  const diagnostics = { status: aligned.length ? 'CTC words returned' : 'CTC zero words', modelId: ctx.modelId, segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length };
  diagnostic(diagnostics);
  post('aligned', { words: aligned, modelId: ctx.modelId, diagnostics });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== 'falign') return;
  runForcedAlign(message).catch((error) => post('error', { message: error?.message || String(error) }));
};
