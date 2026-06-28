import { aggregateTokenPathToWords, ctcTrellisAlign, logSoftmaxRows } from './forced-align.js';
import { buildTokenIds } from './ctc-tokens.js';

const ORT_URLS = [
  { url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.mjs', wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/' },
  { url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.mjs', wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/' },
  { url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.mjs', wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/' },
];

const DEFAULT_MODEL_FR = {
  id: 'Poulpidot/wav2vec2-large-xlsr-53-french-onnx',
  baseUrl: 'https://huggingface.co/Poulpidot/wav2vec2-large-xlsr-53-french-onnx/resolve/main',
  modelPath: 'model.onnx',
  vocabPath: 'vocab.json',
  preprocessorPath: 'preprocessor_config.json',
  specialTokensPath: 'special_tokens_map.json',
  tokenizerConfigPath: 'tokenizer_config.json',
  mode: 'direct-onnx',
};

let ortModule = null;
let ctcCache = null;
let ctcCacheKey = '';

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }
function diagnostic(payload = {}) { post('diagnostic', payload); }
function countSegmentWords(segments = []) { return segments.reduce((sum, segment) => sum + ((segment.words || []).filter((word) => word?.norm).length), 0); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }

async function importOrt() {
  if (ortModule) return ortModule;
  let last = null;
  for (const candidate of ORT_URLS) {
    try {
      post('status', { text: `Chargement ONNX Runtime (${new URL(candidate.url).host})...` });
      const module = await import(candidate.url);
      const ort = module.default || module;
      if (!ort?.InferenceSession || !ort?.Tensor) throw new Error('Exports ONNX Runtime incomplets.');
      try {
        if (ort.env?.wasm) {
          ort.env.wasm.wasmPaths = candidate.wasmPath;
          ort.env.wasm.numThreads = Math.max(1, Math.min(4, self.navigator?.hardwareConcurrency || 1));
        }
      } catch (_) {}
      ortModule = ort;
      diagnostic({ status: 'ORT loaded', url: candidate.url, wasmPath: candidate.wasmPath });
      return ort;
    } catch (error) {
      last = error;
      diagnostic({ status: 'ORT load failed', url: candidate.url, fallbackReason: error?.message || String(error) });
    }
  }
  throw new Error(`Impossible de charger ONNX Runtime Web. ${last?.message || ''}`.trim());
}

function hfUrl(model, path) {
  return `${model.baseUrl}/${path}`;
}

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`${label} inaccessible (${response.status})`);
  return response.json();
}

function buildDirectTokenizer(vocab, specialTokens = {}, tokenizerConfig = {}) {
  if (!vocab || typeof vocab !== 'object' || Array.isArray(vocab)) throw new Error('vocab.json CTC invalide.');
  const padToken = specialTokens.pad_token || tokenizerConfig.pad_token || '<pad>';
  const wordDelimiterToken = tokenizerConfig.word_delimiter_token || specialTokens.word_delimiter_token || '|';
  const padId = vocab[padToken] ?? vocab['<pad>'] ?? vocab['[PAD]'] ?? vocab['<PAD>'] ?? 0;
  return {
    vocab,
    pad_token_id: padId,
    word_delimiter_token: wordDelimiterToken,
    config: { pad_token_id: padId },
    model: { vocab },
  };
}

async function loadDirectOnnxCtc(modelSpec, device = 'wasm') {
  const ort = await importOrt();
  const key = `${modelSpec.id}::${device || 'wasm'}::direct-onnx`;
  if (ctcCache && ctcCacheKey === key) return ctcCache;

  post('status', { text: `Chargement CTC direct ONNX ${modelSpec.id}...` });
  diagnostic({ status: 'CTC direct loading', modelId: modelSpec.id });

  const [vocab, preprocessor, specialTokens, tokenizerConfig] = await Promise.all([
    fetchJson(hfUrl(modelSpec, modelSpec.vocabPath), 'vocab.json'),
    fetchJson(hfUrl(modelSpec, modelSpec.preprocessorPath), 'preprocessor_config.json'),
    fetchJson(hfUrl(modelSpec, modelSpec.specialTokensPath), 'special_tokens_map.json').catch(() => ({})),
    fetchJson(hfUrl(modelSpec, modelSpec.tokenizerConfigPath), 'tokenizer_config.json').catch(() => ({})),
  ]);

  const tokenizer = buildDirectTokenizer(vocab, specialTokens, tokenizerConfig);
  const modelUrl = hfUrl(modelSpec, modelSpec.modelPath);
  const providers = device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  const options = {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
  };
  post('status', { text: `Téléchargement modèle ONNX CTC lourd (${modelSpec.id})...` });
  diagnostic({ status: 'CTC session loading', modelId: modelSpec.id, modelUrl, vocabSize: Object.keys(vocab).length, providers: providers.join(',') });
  const session = await ort.InferenceSession.create(modelUrl, options);

  ctcCache = { engine: 'direct-onnx', ort, session, tokenizer, preprocessor, modelId: modelSpec.id };
  ctcCacheKey = key;
  diagnostic({
    status: 'CTC session loaded',
    modelId: modelSpec.id,
    vocabSize: Object.keys(vocab).length,
    inputNames: session.inputNames?.join(', ') || '',
    outputNames: session.outputNames?.join(', ') || '',
    normalize: Boolean(preprocessor?.do_normalize),
    samplingRate: preprocessor?.sampling_rate || 16000,
  });
  return ctcCache;
}

async function loadCtc(modelId, device) {
  // DEV2.11.4: Poulpidot does not ship tokenizer.json, so it must be loaded through direct ORT + vocab.json.
  const selected = DEFAULT_MODEL_FR;
  if (modelId && modelId !== selected.id) diagnostic({ status: 'CTC model override ignored', requestedModelId: modelId, modelId: selected.id });
  return loadDirectOnnxCtc(selected, device === 'webgpu' ? 'webgpu' : 'wasm');
}

function slicePcm(pcm, sampleRate, start, end) {
  const a = Math.max(0, Math.floor(start * sampleRate));
  const b = Math.min(pcm.length, Math.ceil(end * sampleRate));
  return pcm.slice(a, b);
}

function normalizeInputPcm(inputPcm, preprocessor = {}) {
  if (preprocessor?.do_normalize === false) return inputPcm;
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

function buildFeeds(ctx, inputPcm) {
  const normalized = normalizeInputPcm(inputPcm, ctx.preprocessor);
  const dims = [1, normalized.length];
  const feeds = {};
  const inputNames = ctx.session.inputNames || ['input_values'];
  for (const name of inputNames) {
    if (/attention_mask/i.test(name)) {
      const mask = new BigInt64Array(normalized.length);
      mask.fill(1n);
      feeds[name] = new ctx.ort.Tensor('int64', mask, dims);
    } else {
      feeds[name] = new ctx.ort.Tensor('float32', normalized, dims);
    }
  }
  diagnostic({ status: 'CTC direct feeds', inputNames: inputNames.join(', '), samples: normalized.length, normalized: ctx.preprocessor?.do_normalize !== false });
  return feeds;
}

async function runModel(ctx, inputPcm, sampleRate) {
  if (ctx.engine !== 'direct-onnx') throw new Error('Moteur CTC inconnu.');
  const expectedRate = Number(ctx.preprocessor?.sampling_rate || 16000);
  if (expectedRate && Math.abs(expectedRate - sampleRate) > 1) diagnostic({ status: 'CTC sample-rate warning', expectedRate, sampleRate });
  const feeds = buildFeeds(ctx, inputPcm);
  return ctx.session.run(feeds);
}

function logitsFromOutput(output) {
  if (!output || typeof output !== 'object') throw new Error('Sortie CTC vide.');
  const preferredKey = Object.keys(output).find((key) => key.toLowerCase().includes('logit')) || Object.keys(output)[0];
  const tensor = output[preferredKey];
  if (!tensor?.data || !tensor?.dims) throw new Error('Logits CTC absents (modèle sans tête CTC ?)');
  if (tensor.dims.length < 2) throw new Error(`Logits CTC invalides: dims ${tensor.dims.join('x')}`);
  diagnostic({ status: 'CTC logits received', outputName: preferredKey, dims: tensor.dims.join('x') });
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
  const { pcm16k, sampleRate = 16000, language = 'french', segments = [], modelId, device = 'wasm' } = message;
  if (!(pcm16k instanceof Float32Array)) throw new Error('PCM 16k manquant pour alignement forcé.');
  if (!Array.isArray(segments) || !segments.length) throw new Error('Segments manquants pour alignement forcé.');
  const requestedWords = countSegmentWords(segments);
  diagnostic({ status: 'CTC requested', segments: segments.length, requestedWords, alignedWords: 0, segmentsOk: 0, segmentsFailed: 0 });
  const selectedModel = modelId || (String(language).toLowerCase().startsWith('fr') ? DEFAULT_MODEL_FR.id : DEFAULT_MODEL_FR.id);
  const ctx = await loadCtc(selectedModel, device === 'webgpu' ? 'webgpu' : 'wasm');
  post('status', { text: `CTC prêt: ${ctx.modelId}. Trellis par fenêtre.` });
  diagnostic({ status: 'CTC ready', modelId: ctx.modelId, engine: ctx.engine, segments: segments.length, requestedWords });
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
  const diagnostics = { status: aligned.length ? 'CTC words returned' : 'CTC zero words', modelId: ctx.modelId, engine: ctx.engine, segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length };
  diagnostic(diagnostics);
  post('aligned', { words: aligned, modelId: ctx.modelId, diagnostics });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== 'falign') return;
  runForcedAlign(message).catch((error) => post('error', { message: error?.message || String(error) }));
};
