import { aggregateTokenPathToWords, ctcTrellisAlign, logSoftmaxRows } from './forced-align.js';
import { buildTokenIds } from './ctc-tokens.js';

const TRANSFORMERS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  'https://unpkg.com/@huggingface/transformers@3.5.2',
  'https://unpkg.com/@huggingface/transformers@3',
];

const DEFAULT_CTC_CANDIDATES = [
  'Xenova/wav2vec2-base-960h',
  'onnx-community/wav2vec2-base-960h-ONNX',
];

let transformersModule = null;
const ctcCache = new Map();

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }
function diagnostic(payload = {}) { post('diagnostic', payload); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function countSegmentWords(segments = []) { return segments.reduce((sum, segment) => sum + ((segment.words || []).filter((word) => word?.norm).length), 0); }

async function importTransformers() {
  if (transformersModule) return transformersModule;
  let lastError = null;
  for (const url of TRANSFORMERS_URLS) {
    try {
      post('status', { text: `Chargement Transformers.js CTC (${new URL(url).host})...` });
      transformersModule = await import(url);
      return transformersModule;
    } catch (error) {
      lastError = error;
      diagnostic({ status: 'Transformers CTC import failed', url, fallbackReason: error?.message || String(error) });
    }
  }
  throw new Error(`Impossible de charger Transformers.js pour le CTC. ${lastError?.message || ''}`.trim());
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
    diagnostic({ status: 'CTC env configured', threads, isolated: Boolean(self.crossOriginIsolated) });
  } catch (_) {}
}

function orderedCandidates(overrideModelId = '') {
  const list = [];
  const override = String(overrideModelId || '').trim();
  if (override) list.push(override);
  list.push(...DEFAULT_CTC_CANDIDATES);
  return [...new Set(list.filter(Boolean))];
}

async function loadOneCtc(candidate, device = 'wasm') {
  const runtime = device === 'webgpu' ? 'webgpu' : 'wasm';
  const key = `${candidate}::${runtime}::q8`;
  if (ctcCache.has(key)) return ctcCache.get(key);

  const { AutoModelForCTC, AutoProcessor, AutoTokenizer, env } = await importTransformers();
  if (!AutoModelForCTC) throw new Error('AutoModelForCTC indisponible dans Transformers.js.');
  if (!AutoProcessor) throw new Error('AutoProcessor indisponible dans Transformers.js.');
  if (!AutoTokenizer) throw new Error('AutoTokenizer indisponible dans Transformers.js.');
  configureEnv(env);

  const progress_callback = (event = {}) => {
    if (event.status === 'progress' && Number.isFinite(event.progress)) {
      const pct = Math.max(0, Math.min(30, event.progress * 0.3));
      post('progress', { pct });
      post('status', { text: `Téléchargement modèle d'alignement CTC q8 (~90 Mo, une seule fois): ${Math.round(event.progress)}%` });
    } else if (event.status) {
      const file = event.file ? ` - ${event.file}` : '';
      post('status', { text: `CTC modèle: ${event.status}${file}` });
    }
  };

  post('status', { text: `Téléchargement du modèle d'alignement CTC q8 (~90 Mo, une seule fois): ${candidate}` });
  diagnostic({ status: 'CTC model loading', modelId: candidate, runtime, dtype: 'q8' });

  const options = { device: runtime, dtype: 'q8', progress_callback };
  const [model, processor, tokenizer] = await Promise.all([
    AutoModelForCTC.from_pretrained(candidate, options),
    AutoProcessor.from_pretrained(candidate, { progress_callback }),
    AutoTokenizer.from_pretrained(candidate, { progress_callback }),
  ]);

  if (!processor) throw new Error('Processor CTC indisponible.');
  if (!tokenizer) throw new Error('Tokenizer CTC indisponible.');

  const ctx = { engine: 'transformers-ctc-q8', model, processor, tokenizer, modelId: candidate, runtime };
  ctcCache.set(key, ctx);
  diagnostic({ status: 'CTC model loaded', modelId: candidate, runtime, dtype: 'q8' });
  return ctx;
}

async function loadCtc(modelId, device) {
  const candidates = orderedCandidates(modelId);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const ctx = await loadOneCtc(candidate, device);
      if (candidate !== candidates[0]) diagnostic({ status: 'CTC candidate fallback active', modelId: candidate, previous: candidates[0] });
      return ctx;
    } catch (error) {
      lastError = error;
      diagnostic({ status: 'CTC candidate failed', modelId: candidate, fallbackReason: error?.message || String(error) });
      post('status', { text: `Modèle CTC indisponible (${candidate}). Tentative suivante...` });
    }
  }
  throw new Error(`Aucun modèle CTC public quantifié n'a pu être chargé. ${lastError?.message || ''}`.trim());
}

function slicePcm(pcm, sampleRate, start, end) {
  const a = Math.max(0, Math.floor(start * sampleRate));
  const b = Math.min(pcm.length, Math.ceil(end * sampleRate));
  return pcm.slice(a, b);
}

async function runModel(ctx, inputPcm, sampleRate) {
  if (ctx.engine !== 'transformers-ctc-q8') throw new Error('Moteur CTC inconnu.');
  if (!ctx.processor) throw new Error('Processor CTC indisponible: impossible de normaliser le PCM.');
  let processed;
  try {
    processed = await ctx.processor(inputPcm, { sampling_rate: sampleRate });
  } catch (error) {
    throw new Error(`Prétraitement CTC impossible: ${error?.message || error}`);
  }
  if (!processed?.input_values) throw new Error('Processor CTC sans input_values.');
  diagnostic({
    status: 'CTC processor output',
    modelId: ctx.modelId,
    keys: Object.keys(processed || {}).join(', '),
    samples: inputPcm.length,
  });
  return ctx.model(processed);
}

function logitsFromOutput(output) {
  if (!output || typeof output !== 'object') throw new Error('Sortie CTC vide.');
  const tensor = output.logits;
  if (!tensor?.data || !tensor?.dims) throw new Error('Logits CTC absents (modèle sans tête CTC ?)');
  if (tensor.dims.length < 2) throw new Error(`Logits CTC invalides: dims ${tensor.dims.join('x')}`);
  diagnostic({ status: 'CTC logits received', outputName: 'logits', dims: tensor.dims.join('x') });
  return { data: tensor.data, dims: tensor.dims };
}

async function alignSegment(ctx, segment, pcm, sampleRate, index, total) {
  const start = Math.max(0, Number(segment.start) || 0);
  const end = Math.max(start + 0.25, Number(segment.end) || start + 0.25);
  const words = (segment.words || []).filter((word) => word?.norm);
  if (!words.length) return [];
  const { tokenIds, tokenToWord, blank, skipped, vocabSize } = buildTokenIds(words, ctx.tokenizer);
  diagnostic({ status: 'CTC segment tokens', segmentIndex: index, requestedWords: words.length, tokenCount: tokenIds.length, vocabSize, skipped: [...new Set(skipped)].slice(0, 12).join('') });
  if (!tokenIds.length) return [];
  const chunk = slicePcm(pcm, sampleRate, start, end);
  if (chunk.length < sampleRate * 0.18) return [];
  post('status', { text: `Alignement forcé ${index + 1}/${total}: ${segment.text.slice(0, 42)}` });
  const output = await runModel(ctx, chunk, sampleRate);
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
  const local = aggregateTokenPathToWords(path, tokenToWord, frameSeconds, start)
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  diagnostic({ status: 'CTC segment aligned', segmentIndex: index, requestedWords: words.length, alignedWords: local.length, frames, tokenCount: tokenIds.length });
  return local.map((item) => ({
    lineIndex: segment.lineIndex,
    wordIndex: item.wordIndex,
    start: item.start,
    end: Math.max(item.end, item.start + 0.04),
    score: clamp01(item.score),
  }));
}

async function runForcedAlign(message) {
  const { pcm16k, sampleRate = 16000, segments = [], modelId, device = 'wasm' } = message;
  if (!(pcm16k instanceof Float32Array)) throw new Error('PCM 16k manquant pour alignement forcé.');
  if (!Array.isArray(segments) || !segments.length) throw new Error('Segments manquants pour alignement forcé.');
  const requestedWords = countSegmentWords(segments);
  diagnostic({ status: 'CTC requested', segments: segments.length, requestedWords, alignedWords: 0, segmentsOk: 0, segmentsFailed: 0 });
  post('status', { text: 'Alignement forcé: modèle acoustique générique, texte conservé depuis les paroles utilisateur.' });
  const ctx = await loadCtc(modelId, device === 'webgpu' ? 'webgpu' : 'wasm');
  post('status', { text: `CTC prêt: ${ctx.modelId}. Trellis par fenêtre.` });
  diagnostic({ status: 'CTC ready', modelId: ctx.modelId, engine: ctx.engine, runtime: ctx.runtime, segments: segments.length, requestedWords });

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
      diagnostic({ status: 'CTC running', modelId: ctx.modelId, segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length });
    } catch (error) {
      segmentsFailed += 1;
      diagnostic({ status: 'CTC segment error', modelId: ctx.modelId, segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length, fallbackReason: error?.message || String(error) });
      post('status', { text: `Segment non aligné, repli ASR: ${error?.message || error}` });
    }
  }
  post('progress', { pct: 98 });
  const diagnostics = { status: aligned.length ? 'CTC words returned' : 'CTC zero words', modelId: ctx.modelId, engine: ctx.engine, runtime: ctx.runtime, segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length };
  diagnostic(diagnostics);
  post('aligned', { words: aligned, modelId: ctx.modelId, diagnostics });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== 'falign') return;
  runForcedAlign(message).catch((error) => post('error', { message: error?.message || String(error) }));
};
