import { aggregateTokenPathToWords, ctcTrellisAlign, logSoftmaxRows } from './forced-align.js';
import { buildTokenIds } from './ctc-tokens.js';

// DEV2.11.5 : alignement force 100 % automatique, sans hebergement ni conversion.
//
// Strategie robuste :
//  - LE MODELE est charge via transformers.js (AutoModelForCTC) en dtype q8 :
//    modele PUBLIC deja quantifie (~90 Mo), telecharge une fois puis cache.
//  - LE TOKENIZER est construit directement depuis vocab.json (toujours present),
//    ce qui evite la dependance a tokenizer.json (absente sur beaucoup de repos
//    wav2vec2 et cause du blocage precedent).
//  - Modele acoustique anglais : en alignement force il ne transcrit pas, il cale
//    le texte FR connu (normalise a-z). Le Poulpidot fp32 (1,26 Go) est abandonne.

const TRANSFORMERS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3',
  'https://unpkg.com/@huggingface/transformers@3.5.2',
  'https://unpkg.com/@huggingface/transformers@3',
];

// Repos publics, structures pour transformers.js, avec poids ONNX quantifies (q8).
const LIGHT_CTC_MODELS = [
  'Xenova/wav2vec2-base-960h',
  'onnx-community/wav2vec2-base-960h-ONNX',
];

const HF_BASE = 'https://huggingface.co';

let transformersModule = null;
let ctcCache = null;
let ctcCacheKey = '';

function post(type, payload = {}) { self.postMessage({ type, ...payload }); }
function diagnostic(payload = {}) { post('diagnostic', payload); }
function countSegmentWords(segments = []) { return segments.reduce((sum, segment) => sum + ((segment.words || []).filter((word) => word?.norm).length), 0); }
function clamp01(value) { return Math.max(0, Math.min(1, value)); }

async function importTransformers() {
  if (transformersModule) return transformersModule;
  let last = null;
  for (const url of TRANSFORMERS_URLS) {
    try {
      post('status', { text: `Chargement module CTC (${new URL(url).host})...` });
      const module = await import(url);
      if (!module?.AutoModelForCTC && !module?.Wav2Vec2ForCTC) throw new Error('Classe CTC absente du module.');
      if (!module?.Tensor) throw new Error('Tensor absent du module.');
      try {
        module.env.allowLocalModels = false;
        module.env.useBrowserCache = true;
        if (module.env.backends?.onnx?.wasm) {
          module.env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, self.navigator?.hardwareConcurrency || 1));
        }
      } catch (_) {}
      transformersModule = module;
      diagnostic({ status: 'CTC module loaded', url });
      return module;
    } catch (error) {
      last = error;
      diagnostic({ status: 'CTC module load failed', url, fallbackReason: error?.message || String(error) });
    }
  }
  throw new Error(`Impossible de charger Transformers.js (CTC). ${last?.message || ''}`.trim());
}

async function fetchJson(url, label) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`${label} inaccessible (${response.status})`);
  return response.json();
}

// Construit un tokenizer minimal a partir de vocab.json (token -> id), compatible
// avec ctc-tokens.js (getVocab lit tokenizer.vocab / model.vocab / pad_token_id).
async function buildTokenizerFromVocab(modelId) {
  const base = `${HF_BASE}/${modelId}/resolve/main`;
  const [vocab, special, tcfg] = await Promise.all([
    fetchJson(`${base}/vocab.json`, 'vocab.json'),
    fetchJson(`${base}/special_tokens_map.json`, 'special_tokens_map.json').catch(() => ({})),
    fetchJson(`${base}/tokenizer_config.json`, 'tokenizer_config.json').catch(() => ({})),
  ]);
  if (!vocab || typeof vocab !== 'object' || Array.isArray(vocab)) throw new Error('vocab.json CTC invalide.');
  const padToken = special.pad_token || tcfg.pad_token || '<pad>';
  const delim = tcfg.word_delimiter_token || special.word_delimiter_token || '|';
  const padId = vocab[padToken] ?? vocab['<pad>'] ?? vocab['[PAD]'] ?? vocab['<PAD>'] ?? 0;
  return {
    vocab,
    pad_token_id: padId,
    word_delimiter_token: delim,
    config: { pad_token_id: padId },
    model: { vocab },
  };
}

async function loadCtc(requestedModelId) {
  // Toujours WASM + q8 : leger (~90 Mo), fiable, et q8 n'est pas garanti sur WebGPU.
  // Les segments sont courts -> WASM suffit largement.
  const t = await importTransformers();
  const candidates = [];
  if (requestedModelId && LIGHT_CTC_MODELS.includes(requestedModelId)) candidates.push(requestedModelId);
  for (const id of LIGHT_CTC_MODELS) if (!candidates.includes(id)) candidates.push(id);

  let lastError = null;
  for (const candidate of candidates) {
    const key = `${candidate}::wasm::q8`;
    if (ctcCache && ctcCacheKey === key) return ctcCache;
    try {
      post('status', { text: `Chargement modele CTC ${candidate} (~90 Mo, une seule fois)...` });
      diagnostic({ status: 'CTC model loading', modelId: candidate });
      const AutoModelForCTC = t.AutoModelForCTC || t.Wav2Vec2ForCTC;

      // Preprocessor (do_normalize) : base-960h => false, large/xlsr => true.
      const preprocessor = await fetchJson(`${HF_BASE}/${candidate}/resolve/main/preprocessor_config.json`, 'preprocessor_config.json').catch(() => ({}));

      const [model, tokenizer] = await Promise.all([
        AutoModelForCTC.from_pretrained(candidate, {
          device: 'wasm',
          dtype: 'q8',
          progress_callback: (event) => {
            if (event?.status === 'progress' && Number.isFinite(event.progress)) {
              post('progress', { pct: Math.min(34, (event.progress || 0) * 0.34) });
            }
          },
        }),
        buildTokenizerFromVocab(candidate),
      ]);

      ctcCache = {
        engine: 'transformers',
        t,
        model,
        tokenizer,
        doNormalize: preprocessor?.do_normalize === true,
        modelId: candidate,
      };
      ctcCacheKey = key;
      diagnostic({ status: 'CTC model loaded', modelId: candidate, doNormalize: ctcCache.doNormalize });
      return ctcCache;
    } catch (error) {
      lastError = error;
      diagnostic({ status: 'CTC model unavailable', modelId: candidate, fallbackReason: error?.message || String(error) });
      post('status', { text: `Echec CTC ${candidate}${candidate !== LIGHT_CTC_MODELS[LIGHT_CTC_MODELS.length - 1] ? ', tentative suivante...' : ''}` });
    }
  }
  throw lastError || new Error('Aucun modele CTC disponible.');
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

async function runModel(ctx, inputPcm) {
  const values = ctx.doNormalize ? normalizeInputPcm(inputPcm) : (inputPcm instanceof Float32Array ? inputPcm : Float32Array.from(inputPcm));
  const tensor = new ctx.t.Tensor('float32', values, [1, values.length]);
  return ctx.model({ input_values: tensor });
}

function logitsFromOutput(output) {
  if (!output || typeof output !== 'object') throw new Error('Sortie CTC vide.');
  const tensor = output.logits
    || output[Object.keys(output).find((key) => key.toLowerCase().includes('logit')) || ''];
  if (!tensor?.data || !tensor?.dims) throw new Error('Logits CTC absents (modele sans tete CTC ?)');
  if (tensor.dims.length < 2) throw new Error(`Logits CTC invalides: dims ${tensor.dims.join('x')}`);
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
  post('status', { text: `Alignement force ${index + 1}/${total}: ${segment.text.slice(0, 42)}` });
  const output = await runModel(ctx, chunk);
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
  return local.map((item) => {
    const sourceWord = words[item.wordIndex];
    return {
      lineIndex: sourceWord?.lineIndex ?? segment.lineIndex,
      wordIndex: sourceWord?.wordIndex ?? item.wordIndex,
      start: item.start,
      end: Math.max(item.end, item.start + 0.04),
      score: clamp01(item.score),
    };
  });
}

async function runForcedAlign(message) {
  const { pcm16k, sampleRate = 16000, segments = [], modelId } = message;
  if (!(pcm16k instanceof Float32Array)) throw new Error('PCM 16k manquant pour alignement force.');
  if (!Array.isArray(segments) || !segments.length) throw new Error('Segments manquants pour alignement force.');
  const requestedWords = countSegmentWords(segments);
  diagnostic({ status: 'CTC requested', segments: segments.length, requestedWords, alignedWords: 0, segmentsOk: 0, segmentsFailed: 0 });

  const ctx = await loadCtc(modelId);
  post('status', { text: `CTC pret: ${ctx.modelId} (acoustique EN, calage du texte FR connu).` });
  diagnostic({ status: 'CTC ready', modelId: ctx.modelId, engine: ctx.engine, segments: segments.length, requestedWords });

  const aligned = [];
  const total = segments.length;
  let segmentsOk = 0;
  let segmentsFailed = 0;
  for (let i = 0; i < total; i += 1) {
    post('progress', { pct: 35 + (i / Math.max(1, total)) * 60 });
    try {
      const local = await alignSegment(ctx, segments[i], pcm16k, sampleRate, i, total);
      if (local.length) segmentsOk += 1; else segmentsFailed += 1;
      aligned.push(...local);
      diagnostic({ status: 'CTC running', segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length });
    } catch (error) {
      segmentsFailed += 1;
      diagnostic({ status: 'CTC segment error', segments: total, segmentsOk, segmentsFailed, requestedWords, alignedWords: aligned.length, fallbackReason: error?.message || String(error) });
      post('status', { text: `Segment non aligne, repli ASR: ${error?.message || error}` });
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
