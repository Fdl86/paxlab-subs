import { aggregateTokenPathToWords, ctcTrellisAlign, logSoftmaxRows } from './forced-align.js';

const TRANSFORMERS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  'https://unpkg.com/@huggingface/transformers@3.5.2',
  'https://unpkg.com/@huggingface/transformers@3',
];
const DEFAULT_MODEL_FR = 'Xenova/wav2vec2-large-xlsr-53-french';
const FALLBACK_MODEL = 'Xenova/wav2vec2-base-960h';
let transformersModule = null;
let modelCache = null;
let tokenizerCache = null;
let processorCache = null;
let cacheKey = '';

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }

function normalizeCtc(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function importTransformers() {
  if (transformersModule) return transformersModule;
  let last = null;
  for (const url of TRANSFORMERS_URLS) {
    try {
      post('status', { text: `Chargement module CTC (${new URL(url).host})...` });
      transformersModule = await import(url);
      return transformersModule;
    } catch (error) { last = error; }
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
      return { model, tokenizer, processor, modelId: candidate };
    } catch (error) {
      lastError = error;
      post('status', { text: `Échec CTC ${candidate}. ${candidate !== FALLBACK_MODEL ? 'Tentative repli...' : ''}` });
    }
  }
  throw lastError || new Error('Impossible de charger un modèle CTC.');
}

function getVocab(tokenizer) {
  const vocab = tokenizer?.vocab || tokenizer?.model?.vocab || (typeof tokenizer?.get_vocab === 'function' ? tokenizer.get_vocab() : null);
  if (!vocab) throw new Error('Vocabulaire CTC inaccessible.');
  return vocab;
}

function blankId(tokenizer, vocab) {
  return tokenizer?.pad_token_id ?? tokenizer?.config?.pad_token_id ?? vocab['<pad>'] ?? vocab['[PAD]'] ?? 0;
}

function delimiterToken(tokenizer, vocab) {
  const candidates = [tokenizer?.word_delimiter_token, '|', ' ', '<s>', '</s>'].filter(Boolean);
  for (const c of candidates) if (Object.prototype.hasOwnProperty.call(vocab, c)) return c;
  return null;
}

function tokenForChar(char, vocab, delimiter) {
  if (char === ' ') return delimiter && Object.prototype.hasOwnProperty.call(vocab, delimiter) ? vocab[delimiter] : null;
  const variants = [char, char.toUpperCase(), char.toLowerCase()];
  for (const v of variants) if (Object.prototype.hasOwnProperty.call(vocab, v)) return vocab[v];
  return null;
}

function buildTokenIds(words, tokenizer) {
  const vocab = getVocab(tokenizer);
  const delimiter = delimiterToken(tokenizer, vocab);
  const tokenIds = [];
  const tokenToWord = [];
  words.forEach((word, wordIndex) => {
    const text = normalizeCtc(word.text || word.norm || '');
    if (!text) return;
    if (tokenIds.length && delimiter) {
      tokenIds.push(vocab[delimiter]);
      tokenToWord.push(null);
    }
    for (const char of text.replace(/\s+/g, '')) {
      const id = tokenForChar(char, vocab, delimiter);
      if (id === null || id === undefined) continue;
      tokenIds.push(id);
      tokenToWord.push(wordIndex);
    }
  });
  return { tokenIds, tokenToWord, blank: blankId(tokenizer, vocab) };
}

function slicePcm(pcm, sampleRate, start, end) {
  const a = Math.max(0, Math.floor(start * sampleRate));
  const b = Math.min(pcm.length, Math.ceil(end * sampleRate));
  return pcm.slice(a, b);
}

async function runModel(model, processor, inputPcm, sampleRate) {
  if (processor) {
    const inputs = await processor(inputPcm, { sampling_rate: sampleRate });
    return model(inputs);
  }
  return model({ input_values: inputPcm });
}

function logitsFromOutput(output) {
  const tensor = output?.logits || output?.last_hidden_state || output?.[0];
  if (!tensor?.data || !tensor?.dims) throw new Error('Logits CTC non renvoyés par le modèle.');
  return { data: tensor.data, dims: tensor.dims };
}

async function alignSegment(ctx, segment, pcm, sampleRate, index, total) {
  const start = Math.max(0, Number(segment.start) || 0);
  const end = Math.max(start + 0.25, Number(segment.end) || start + 0.25);
  const words = (segment.words || []).filter((word) => word?.norm);
  if (!words.length) return [];
  const { tokenIds, tokenToWord, blank } = buildTokenIds(words, ctx.tokenizer);
  if (!tokenIds.length) return [];
  const chunk = slicePcm(pcm, sampleRate, start, end);
  if (chunk.length < sampleRate * 0.18) return [];
  post('status', { text: `Alignement forcé ${index + 1}/${total}: ${segment.text.slice(0, 42)}` });
  const output = await runModel(ctx.model, ctx.processor, chunk, sampleRate);
  const { data, dims } = logitsFromOutput(output);
  const frames = dims[dims.length - 2];
  if (!frames || frames < tokenIds.length) return [];
  const wanted = [blank, ...tokenIds];
  const emissions = logSoftmaxRows(data, dims, wanted);
  const path = ctcTrellisAlign(emissions, tokenIds, blank);
  const frameSeconds = (end - start) / Math.max(1, frames);
  const local = aggregateTokenPathToWords(path, tokenToWord, frameSeconds, start);
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
  const selectedModel = modelId || (String(language).toLowerCase().startsWith('fr') ? DEFAULT_MODEL_FR : FALLBACK_MODEL);
  const ctx = await loadCtc(selectedModel, device === 'webgpu' ? 'webgpu' : 'wasm');
  post('status', { text: `CTC prêt: ${ctx.modelId}. Trellis par fenêtre.` });
  const aligned = [];
  const total = segments.length;
  for (let i = 0; i < total; i += 1) {
    const pct = 35 + (i / Math.max(1, total)) * 60;
    post('progress', { pct });
    try {
      aligned.push(...await alignSegment(ctx, segments[i], pcm16k, sampleRate, i, total));
    } catch (error) {
      post('status', { text: `Segment non aligné, repli ASR: ${error?.message || error}` });
    }
  }
  post('progress', { pct: 98 });
  post('aligned', { words: aligned, modelId: ctx.modelId });
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== 'falign') return;
  runForcedAlign(message).catch((error) => post('error', { message: error?.message || String(error) }));
};
