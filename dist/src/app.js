import {
  CPS_MAX,
  MIN_CUE_DURATION,
  applyForcedAlignmentToCues,
  attachCueQuality,
  buildCuesFromLyricsAndAsr,
  buildForcedAlignSegments,
  enforceCueOrder,
  normalizeWord,
  splitCleanLyrics,
  spreadCueWords,
} from './align.js';

const APP_VERSION = 'DEV2.11.12';
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ASR_SAMPLE_RATE = 16000;

const MODEL_LABELS = new Map([
  ['onnx-community/whisper-tiny_timestamped', 'Whisper tiny'],
  ['onnx-community/whisper-base_timestamped', 'Whisper base'],
  ['onnx-community/whisper-small_timestamped', 'Whisper small'],
  ['onnx-community/whisper-large-v3-turbo_timestamped', 'Whisper large-v3-turbo'],
]);

const state = {
  audioFile: null,
  audioUrl: '',
  duration: 0,
  cues: [],
  activeCueIndex: -1,
  activeWordIndex: -1,
  selectedCueIndex: -1,
  cueRows: [],
  currentWordSpans: [],
  worker: null,
  alignWorker: null,
  pcm16kForAlign: null,
  forcedWords: [],
  ctcStats: { status: 'OFF', modelId: '-', requestedWords: 0, alignedWords: 0, substitutedWords: 0, segments: 0, segmentsOk: 0, segmentsFailed: 0, cuesAffected: 0, cuesChanged: 0, avgShiftMs: 0, fallbackReason: '' },
  running: false,
  startedAt: 0,
  elapsedTimer: null,
  transcript: '',
  asrWords: [],
  vocalOnsets: [],
  qualitySummary: { total: 0, ok: 0, info: 0, warn: 0, flags: 0 },
  renderRequested: false,
  playbackAnchorTime: 0,
  playbackAnchorPerf: 0,
};

const $ = (id) => document.getElementById(id);

const els = {
  audioInput: $('psAudioInput'),
  dropZone: $('psDropZone'),
  audioDropTitle: $('psAudioDropTitle'),
  audioMeta: $('psAudioMeta'),
  languageSelect: $('psLanguageSelect'),
  modelSelect: $('psModelSelect'),
  runtimeSelect: $('psRuntimeSelect'),
  guideToggle: $('psGuideToggle'),
  onsetToggle: $('psOnsetToggle'),
  forcedAlignToggle: $('psForcedAlignToggle'),
  lyricsInput: $('psLyricsInput'),
  generateBtn: $('psGenerateBtn'),
  stopBtn: $('psStopBtn'),
  resetBtn: $('psResetBtn'),
  testRuntimeBtn: $('psTestRuntimeBtn'),
  runtimeBadge: $('psRuntimeBadge'),
  statusText: $('psStatusText'),
  progressFill: $('psProgressFill'),
  phaseText: $('psPhaseText'),
  elapsedText: $('psElapsedText'),
  engineText: $('psEngineText'),
  engineModelText: $('psEngineModelText'),
  engineRuntimeText: $('psEngineRuntimeText'),
  progressHint: $('psProgressHint'),
  ctcStatus: $('psCtcStatus'),
  ctcWords: $('psCtcWords'),
  ctcCues: $('psCtcCues'),
  ctcShift: $('psCtcShift'),
  liveCueMetric: $('psLiveCueMetric'),
  liveWordMetric: $('psLiveWordMetric'),
  previewLanguage: $('psPreviewLanguage'),
  prevLine: $('psPrevLine'),
  activeLine: $('psActiveLine'),
  nextLine: $('psNextLine'),
  audioEl: $('psAudioEl'),
  playBtn: $('psPlayBtn'),
  seekBar: $('psSeekBar'),
  timeDisplay: $('psTimeDisplay'),
  cueCount: $('psCueCount'),
  qualityBadge: $('psQualityBadge'),
  cueList: $('psCueList'),
  transcriptOutput: $('psTranscriptOutput'),
  timeTrack: $('psTimeTrack'),
  trackRuler: $('psTrackRuler'),
  playhead: $('psPlayhead'),
  selectedCueLabel: $('psSelectedCueLabel'),
  startInput: $('psStartInput'),
  endInput: $('psEndInput'),
  downloadSrtBtn: $('psDownloadSrtBtn'),
  downloadVttBtn: $('psDownloadVttBtn'),
  downloadJsonBtn: $('psDownloadJsonBtn'),
  cueAdjustButtons: Array.from(document.querySelectorAll('[data-ps-adjust]')),
  setStartBtn: $('psSetStartBtn'),
  setEndBtn: $('psSetEndBtn'),
};


function resetCtcStats(status = 'OFF') {
  state.ctcStats = {
    status,
    modelId: '-',
    requestedWords: 0,
    alignedWords: 0,
    substitutedWords: 0,
    segments: 0,
    segmentsOk: 0,
    segmentsFailed: 0,
    cuesAffected: 0,
    cuesChanged: 0,
    avgShiftMs: 0,
    fallbackReason: '',
  };
  updateCtcDiagnostics();
}

function updateCtcDiagnostics() {
  if (!els.ctcStatus) return;
  const stats = state.ctcStats || {};
  const status = stats.fallbackReason ? `Fallback: ${stats.fallbackReason}` : (stats.status || 'OFF');
  els.ctcStatus.textContent = status;
  els.ctcWords.textContent = `${stats.substitutedWords || 0}/${stats.requestedWords || 0}`;
  els.ctcCues.textContent = `${stats.cuesAffected || 0} CTC / ${stats.cuesChanged || 0} mod.`;
  els.ctcShift.textContent = `${Math.round(stats.avgShiftMs || 0)} ms`;
}

function mergeCtcDiagnostic(diag = {}) {
  const stats = state.ctcStats || {};
  if (diag.status) stats.status = diag.status;
  if (diag.modelId) stats.modelId = diag.modelId;
  if (Number.isFinite(diag.requestedWords)) stats.requestedWords = diag.requestedWords;
  if (Number.isFinite(diag.alignedWords)) stats.alignedWords = diag.alignedWords;
  if (Number.isFinite(diag.substitutedWords)) stats.substitutedWords = diag.substitutedWords;
  if (Number.isFinite(diag.cuesAffected)) stats.cuesAffected = diag.cuesAffected;
  if (Number.isFinite(diag.cuesChanged)) stats.cuesChanged = diag.cuesChanged;
  if (Number.isFinite(diag.avgShiftMs)) stats.avgShiftMs = diag.avgShiftMs;
  if (Number.isFinite(diag.segments)) stats.segments = diag.segments;
  if (Number.isFinite(diag.segmentsOk)) stats.segmentsOk = diag.segmentsOk;
  if (Number.isFinite(diag.segmentsFailed)) stats.segmentsFailed = diag.segmentsFailed;
  if (diag.fallbackReason) stats.fallbackReason = diag.fallbackReason;
  state.ctcStats = stats;
  updateCtcDiagnostics();
}

function modelLabel(value = els.modelSelect.value) {
  return MODEL_LABELS.get(value) || 'Whisper base';
}

function runtimeLabel(value = els.runtimeSelect.value) {
  if (value === 'webgpu') return 'WebGPU labo';
  if (value === 'auto') return 'Auto -> WASM';
  return 'WASM CPU';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatClock(seconds) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}

function formatCueTime(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalCentis = Math.round(safe * 100);
  const centis = String(totalCentis % 100).padStart(2, '0');
  const totalSeconds = Math.floor(totalCentis / 100);
  const sec = String(totalSeconds % 60).padStart(2, '0');
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = String(totalMinutes % 60).padStart(2, '0');
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}:${min}:${sec}.${centis}` : `${min}:${sec}.${centis}`;
}

function parseCueTime(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return NaN;
  if (!raw.includes(':')) return Number(raw);
  const parts = raw.split(':').map((part) => part.trim());
  if (parts.some((part) => part === '')) return NaN;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return NaN;
  if (nums.length === 2) return (nums[0] * 60) + nums[1];
  if (nums.length === 3) return (nums[0] * 3600) + (nums[1] * 60) + nums[2];
  return NaN;
}

function formatSrtTime(seconds) {
  const msTotal = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
  const ms = String(msTotal % 1000).padStart(3, '0');
  const totalSeconds = Math.floor(msTotal / 1000);
  const s = String(totalSeconds % 60).padStart(2, '0');
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = String(totalMinutes % 60).padStart(2, '0');
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  return `${h}:${m}:${s},${ms}`;
}

function formatVttTime(seconds) {
  return formatSrtTime(seconds).replace(',', '.');
}

function setProgress(pct) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  els.progressFill.style.width = `${value}%`;
}

function setStatus(text, pct = null, hint = null) {
  els.statusText.textContent = text;
  if (pct !== null) setProgress(pct);
  if (hint !== null) els.progressHint.textContent = hint;
}

function setPhase(text) {
  els.phaseText.textContent = `Phase: ${text}`;
}

function setMetrics() {
  els.liveCueMetric.textContent = String(state.cues.length);
  els.liveWordMetric.textContent = String(state.asrWords.length);
  els.cueCount.textContent = `${state.cues.length} cues`;
  if (els.qualityBadge) {
    const q = state.qualitySummary || {};
    els.qualityBadge.textContent = qualitySummaryText();
    els.qualityBadge.classList.toggle('ps-quality-warn', (q.warn || 0) > 0);
    els.qualityBadge.classList.toggle('ps-quality-info', !(q.warn || 0) && (q.info || 0) > 0);
  }
  els.runtimeBadge.textContent = state.running ? 'RUNNING' : 'READY';
  els.runtimeBadge.classList.toggle('ps-pill-running', state.running);
}


function refreshCueQuality() {
  if (!state.cues.length) {
    state.qualitySummary = { total: 0, ok: 0, info: 0, warn: 0, flags: 0 };
    return;
  }
  state.cues = attachCueQuality(state.cues, state.duration);
  state.qualitySummary = state.cues.qualitySummary || { total: state.cues.length, ok: state.cues.length, info: 0, warn: 0, flags: 0 };
}

function qualitySummaryText() {
  const q = state.qualitySummary || { total: 0, ok: 0, info: 0, warn: 0 };
  if (!q.total) return '0 à vérifier';
  const verify = (q.warn || 0) + (q.info || 0);
  if (!verify) return 'Aucun signal';
  return `${q.warn || 0} à vérifier / ${q.info || 0} info`;
}

function updateEngineSummary() {
  const model = modelLabel();
  const runtime = runtimeLabel();
  els.engineModelText.textContent = model;
  els.engineRuntimeText.textContent = runtime;
  els.engineText.textContent = `Worker: ${state.running ? 'running' : 'idle'} - ${model} / ${runtime}`;
  if (!state.running) els.generateBtn.textContent = `Générer - ${model}`;
}

function startElapsedTimer() {
  stopElapsedTimer();
  state.startedAt = performance.now();
  els.elapsedText.textContent = 'Elapsed: 0s';
  state.elapsedTimer = window.setInterval(() => {
    const sec = Math.floor((performance.now() - state.startedAt) / 1000);
    els.elapsedText.textContent = `Elapsed: ${formatClock(sec)}`;
  }, 500);
}

function stopElapsedTimer() {
  if (state.elapsedTimer) window.clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

function canUseModuleWorker() {
  try {
    const blob = new Blob([''], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url, { type: 'module' });
    worker.terminate();
    URL.revokeObjectURL(url);
    return true;
  } catch (_) {
    return false;
  }
}

async function webgpuPreflight() {
  if (!navigator.gpu) return false;
  setStatus('Test WebGPU...', 2, 'Vérification rapide avant chargement du modèle.');
  try {
    const adapter = await Promise.race([
      navigator.gpu.requestAdapter(),
      new Promise((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);
    if (!adapter) return false;
    const device = await Promise.race([
      adapter.requestDevice(),
      new Promise((resolve) => setTimeout(() => resolve(null), 4500)),
    ]);
    if (!device) return false;
    try { device.destroy?.(); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

async function decodeAudioToMono16k(file) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('AudioContext indisponible dans ce navigateur.');
  const ctx = new AudioCtx();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  try { await ctx.close(); } catch (_) {}

  state.duration = audioBuffer.duration;
  const length = Math.ceil(audioBuffer.duration * ASR_SAMPLE_RATE);
  if (window.OfflineAudioContext) {
    const offline = new OfflineAudioContext(1, length, ASR_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  }

  const sourceRate = audioBuffer.sampleRate;
  const channelCount = audioBuffer.numberOfChannels || 1;
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const srcIndex = Math.min(audioBuffer.length - 1, Math.round((i / ASR_SAMPLE_RATE) * sourceRate));
    let sample = 0;
    for (let ch = 0; ch < channelCount; ch += 1) sample += audioBuffer.getChannelData(ch)[srcIndex] || 0;
    output[i] = sample / channelCount;
  }
  return output;
}

function setAudioFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`Fichier trop lourd (${formatBytes(file.size)}). Limite: 100 MB.`, 0, 'Utilise un MP3/WAV plus léger pour garder le traitement navigateur stable.');
    return;
  }
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioFile = file;
  state.audioUrl = URL.createObjectURL(file);
  state.duration = 0;
  els.audioEl.src = state.audioUrl;
  els.audioDropTitle.textContent = file.name;
  els.audioMeta.textContent = `${formatBytes(file.size)} - local only`;
  els.playBtn.disabled = false;
  setStatus('Audio chargé. Durée détectée après lecture des métadonnées.', 0, 'Colle les paroles propres puis génère les sous-titres.');
}

function resetApp() {
  stopGeneration();
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  Object.assign(state, {
    audioFile: null,
    audioUrl: '',
    duration: 0,
    cues: [],
    activeCueIndex: -1,
    activeWordIndex: -1,
    selectedCueIndex: -1,
    cueRows: [],
    currentWordSpans: [],
    worker: null,
    alignWorker: null,
    pcm16kForAlign: null,
    forcedWords: [],
    ctcStats: { status: 'OFF', modelId: '-', requestedWords: 0, alignedWords: 0, substitutedWords: 0, segments: 0, segmentsOk: 0, segmentsFailed: 0, cuesAffected: 0, cuesChanged: 0, avgShiftMs: 0, fallbackReason: '' },
    running: false,
    startedAt: 0,
    transcript: '',
    asrWords: [],
    vocalOnsets: [],
    qualitySummary: { total: 0, ok: 0, info: 0, warn: 0, flags: 0 },
  });
  els.audioInput.value = '';
  els.audioEl.removeAttribute('src');
  els.audioEl.load();
  els.audioDropTitle.textContent = 'Glisse un fichier ici ou clique';
  els.audioMeta.textContent = 'Aucun upload - limite 100 MB';
  els.seekBar.value = '0';
  els.seekBar.disabled = true;
  els.playBtn.disabled = true;
  els.playBtn.textContent = 'Play';
  els.lyricsInput.value = '';
  if (els.transcriptOutput) els.transcriptOutput.value = '';
  setStatus('Audio + paroles requis.', 0, 'Worker ASR prêt. UI fluide pendant la transcription.');
  setPhase('idle');
  resetCtcStats('OFF');
  updateCueSelection(-1);
  renderCueList();
  renderTrack();
  renderCueText(null);
  setMetrics();
  updateEngineSummary();
  els.timeDisplay.textContent = '00:00 / 00:00';
}

function activeCueAt(time) {
  const cues = state.cues;
  if (!cues.length) return -1;
  const current = state.activeCueIndex;
  if (current >= 0 && current < cues.length && time >= cues[current].start && time <= cues[current].end) return current;
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const cue = cues[mid];
    if (time < cue.start) high = mid - 1;
    else if (time > cue.end) low = mid + 1;
    else return mid;
  }
  return -1;
}

function activeWordAt(cue, time) {
  if (!cue?.words?.length) return -1;
  const words = cue.words;
  let low = 0;
  let high = words.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const word = words[mid];
    if (time < word.start) high = mid - 1;
    else if (time > word.end) low = mid + 1;
    else return mid;
  }
  return -1;
}

function renderCueText(cue) {
  state.currentWordSpans = [];
  state.activeWordIndex = -1;
  els.activeLine.textContent = '';
  if (!cue) {
    if (state.cues.length) return;
    els.activeLine.textContent = 'La ligne synchronisée apparaîtra ici.';
    return;
  }
  const words = cue.words?.length ? cue.words : spreadCueWords(cue.text, cue.start, cue.end);
  words.forEach((word, index) => {
    if (index > 0) els.activeLine.append(document.createTextNode(' '));
    const span = document.createElement('span');
    span.className = 'ps-word';
    span.textContent = word.text;
    span.dataset.norm = word.norm || normalizeWord(word.text);
    els.activeLine.append(span);
    state.currentWordSpans.push(span);
  });
}

function syncPlaybackAnchor() {
  state.playbackAnchorTime = els.audioEl.currentTime || 0;
  state.playbackAnchorPerf = performance.now();
}

function smoothPlaybackTime() {
  const audio = els.audioEl;
  const actual = audio.currentTime || 0;
  if (audio.paused || !state.playbackAnchorPerf) return actual;
  const elapsed = Math.max(0, (performance.now() - state.playbackAnchorPerf) / 1000);
  const predicted = state.playbackAnchorTime + elapsed;
  const duration = state.duration || audio.duration || Infinity;
  const drift = Math.abs(predicted - actual);
  if (drift > 0.35) syncPlaybackAnchor();
  return Math.max(0, Math.min(duration, drift > 0.35 ? actual : predicted));
}

function updatePreviewFrame() {
  state.renderRequested = false;
  const audio = els.audioEl;
  const time = smoothPlaybackTime();
  if (state.duration > 0) {
    const ratio = Math.max(0, Math.min(1, time / state.duration));
    els.seekBar.value = String(Math.round(ratio * 100000));
    els.timeDisplay.textContent = `${formatCueTime(time)} / ${formatClock(state.duration)}`;
    els.playhead.style.left = `${(ratio * 100).toFixed(4)}%`;
    els.seekBar.style.setProperty('--ps-range-progress', `${(ratio * 100).toFixed(3)}%`);
  }

  const cueIndex = activeCueAt(time);
  if (cueIndex !== state.activeCueIndex) {
    if (state.cueRows[state.activeCueIndex]) state.cueRows[state.activeCueIndex].classList.remove('ps-is-active');
    state.activeCueIndex = cueIndex;
    if (state.cueRows[cueIndex]) {
      state.cueRows[cueIndex].classList.add('ps-is-active');
      state.cueRows[cueIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const cue = state.cues[cueIndex];
    els.prevLine.textContent = cueIndex > 0 ? state.cues[cueIndex - 1].text : '';
    els.nextLine.textContent = cueIndex >= 0 && cueIndex < state.cues.length - 1 ? state.cues[cueIndex + 1].text : '';
    if (cueIndex < 0) { els.prevLine.textContent = ''; els.nextLine.textContent = ''; }
    renderCueText(cue);
  }

  const cue = state.cues[cueIndex];
  const wordIndex = activeWordAt(cue, time);
  if (wordIndex !== state.activeWordIndex) {
    if (state.currentWordSpans[state.activeWordIndex]) state.currentWordSpans[state.activeWordIndex].classList.remove('ps-active-word');
    state.activeWordIndex = wordIndex;
    if (state.currentWordSpans[wordIndex]) state.currentWordSpans[wordIndex].classList.add('ps-active-word');
  }

  if (!audio.paused) requestRenderFrame();
}

function requestRenderFrame() {
  if (state.renderRequested) return;
  state.renderRequested = true;
  requestAnimationFrame(updatePreviewFrame);
}

function renderCueList() {
  els.cueList.innerHTML = '';
  state.cueRows = [];
  state.cues.forEach((cue, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ps-cue-row';
    row.dataset.index = String(index);
    const source = cue.timingSource === 'forced-ctc' ? 'CTC' : 'ASR';
    const quality = cue.quality || { level: 'ok', flags: [] };
    row.classList.toggle('ps-cue-ctc', source === 'CTC');
    row.classList.toggle('ps-cue-warn', quality.level === 'warn');
    row.classList.toggle('ps-cue-info', quality.level === 'info');
    row.innerHTML = `<span class="ps-cue-time"><b>${formatCueTime(cue.start)}</b><small>${formatCueTime(cue.end)}</small></span><span class="ps-cue-main"><span class="ps-cue-text"></span><span class="ps-cue-badges"></span></span><span class="ps-cue-conf"><b>${source}</b><small>${Math.round((cue.confidence || 0) * 100)}%</small></span>`;
    row.querySelector('.ps-cue-text').textContent = cue.text;
    const badges = row.querySelector('.ps-cue-badges');
    const shownFlags = (quality.flags || []).slice(0, 2);
    shownFlags.forEach((flag) => {
      const badge = document.createElement('span');
      badge.className = `ps-cue-badge ps-cue-badge-${flag.level || 'info'}`;
      badge.textContent = flag.label;
      badge.title = flag.detail || flag.label;
      badges.append(badge);
    });
    if (!shownFlags.length) {
      const badge = document.createElement('span');
      badge.className = 'ps-cue-badge ps-cue-badge-ok';
      badge.textContent = 'OK';
      badges.append(badge);
    }
    row.addEventListener('click', () => updateCueSelection(index));
    row.addEventListener('dblclick', () => seekToCue(index, true));
    els.cueList.append(row);
    state.cueRows.push(row);
  });
  setMetrics();
}

function renderTrack() {
  els.trackRuler.innerHTML = '';
  els.timeTrack.querySelectorAll('.ps-track-cue').forEach((node) => node.remove());
  const duration = state.duration || Math.max(...state.cues.map((cue) => cue.end), 0) || 0;
  const marks = duration > 0 ? Math.min(8, Math.max(3, Math.ceil(duration / 45))) : 0;
  for (let i = 0; i <= marks; i += 1) {
    const time = marks ? (duration * i) / marks : 0;
    const mark = document.createElement('span');
    mark.style.left = `${marks ? (i / marks) * 100 : 0}%`;
    mark.textContent = formatClock(time);
    els.trackRuler.append(mark);
  }
  state.cues.forEach((cue, index) => {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'ps-track-cue';
    block.classList.toggle('ps-track-warn', cue.quality?.level === 'warn');
    block.classList.toggle('ps-track-info', cue.quality?.level === 'info');
    const left = duration ? (cue.start / duration) * 100 : 0;
    const width = duration ? Math.max(0.4, ((cue.end - cue.start) / duration) * 100) : 0;
    block.style.left = `${Math.max(0, Math.min(100, left))}%`;
    block.style.width = `${Math.max(0.4, Math.min(100 - left, width))}%`;
    block.title = `${formatCueTime(cue.start)} - ${cue.text}`;
    block.addEventListener('click', () => seekToCue(index, true));
    els.timeTrack.append(block);
  });
}

function updateCueSelection(index) {
  state.selectedCueIndex = index;
  state.cueRows.forEach((row, i) => row.classList.toggle('ps-is-selected', i === index));
  const cue = state.cues[index];
  if (cue && state.cueRows[index]) state.cueRows[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
  els.selectedCueLabel.textContent = cue ? `#${index + 1}` : 'Aucune';
  els.startInput.disabled = !cue;
  els.endInput.disabled = !cue;
  els.cueAdjustButtons.forEach((button) => { button.disabled = !cue; });
  if (els.setStartBtn) els.setStartBtn.disabled = !cue;
  if (els.setEndBtn) els.setEndBtn.disabled = !cue;
  if (cue) {
    els.startInput.value = formatCueTime(cue.start);
    els.endInput.value = formatCueTime(cue.end);
  } else {
    els.startInput.value = '';
    els.endInput.value = '';
  }
}

function retimeWords(cue, newStart, newEnd) {
  const oldStart = cue.start;
  const oldEnd = cue.end;
  const oldDuration = Math.max(0.001, oldEnd - oldStart);
  const newDuration = Math.max(0.001, newEnd - newStart);
  cue.words = (cue.words?.length ? cue.words : spreadCueWords(cue.text, oldStart, oldEnd)).map((word) => ({
    ...word,
    start: newStart + (((word.start ?? oldStart) - oldStart) / oldDuration) * newDuration,
    end: newStart + (((word.end ?? oldEnd) - oldStart) / oldDuration) * newDuration,
  }));
}

function applyCueTimes(index, start, end, options = {}) {
  const cue = state.cues[index];
  if (!cue) return -1;
  const minDur = Math.max(MIN_CUE_DURATION, cue.text.length / CPS_MAX);
  const safeStart = Math.max(0, Number(start));
  const safeEnd = Math.max(safeStart + minDur, Number(end));
  retimeWords(cue, safeStart, safeEnd);
  cue.start = safeStart;
  cue.end = safeEnd;
  state.cues.sort((a, b) => a.start - b.start);
  state.cues.forEach((item, i) => { item.id = i + 1; });
  refreshCueQuality();
  const newIndex = state.cues.indexOf(cue);
  const selectedIndex = options.selectNext ? Math.min(newIndex + 1, state.cues.length - 1) : newIndex;
  renderCueList();
  renderTrack();
  updateCueSelection(selectedIndex);
  state.activeCueIndex = -1;
  requestRenderFrame();
  return newIndex;
}

function adjustSelectedCue(kind, delta) {
  const cue = state.cues[state.selectedCueIndex];
  if (!cue) return;
  let start = cue.start;
  let end = cue.end;
  if (kind === 'start') start += delta;
  if (kind === 'end') end += delta;
  if (kind === 'cue') { start += delta; end += delta; }
  applyCueTimes(state.selectedCueIndex, start, end);
}

function setSelectedCueEdge(edge, options = {}) {
  const index = state.selectedCueIndex;
  const cue = state.cues[index];
  if (!cue || !state.audioUrl) return;
  const marker = Math.max(0, Math.min(state.duration || cue.end, els.audioEl.currentTime || 0));
  const minDur = Math.max(MIN_CUE_DURATION, String(cue.text || '').length / CPS_MAX);
  if (edge === 'start') {
    applyCueTimes(index, marker, cue.end);
    setStatus(`Début calé à ${formatCueTime(marker)}.`, null, 'Cue sélectionnée conservée.');
  } else if (edge === 'end') {
    const end = Math.max(marker, cue.start + minDur);
    applyCueTimes(index, cue.start, end, { selectNext: Boolean(options.selectNext) });
    setStatus(`Fin calée à ${formatCueTime(end)}${options.selectNext ? ' - cue suivante sélectionnée' : ''}.`, null, 'Workflow rapide Q/S/D actif.');
  }
}

function isEditableShortcutTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function togglePlayback() {
  if (!state.audioUrl) return;
  if (els.audioEl.paused) els.audioEl.play().catch(() => {});
  else els.audioEl.pause();
}

function handleKeyboardShortcuts(event) {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (isEditableShortcutTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === ' ' || key === 's') {
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (key === 'q') {
    event.preventDefault();
    setSelectedCueEdge('start');
    return;
  }
  if (key === 'd') {
    event.preventDefault();
    setSelectedCueEdge('end', { selectNext: true });
  }
}

function seekToCue(index, play = false) {
  const cue = state.cues[index];
  if (!cue || !state.audioUrl) return;
  updateCueSelection(index);
  els.audioEl.currentTime = Math.max(0, cue.start + 0.01);
  requestRenderFrame();
  if (play) els.audioEl.play().catch(() => {});
}

async function resolveRuntime() {
  let runtime = els.runtimeSelect.value;
  if (runtime === 'auto') runtime = 'wasm';
  if (runtime === 'webgpu') {
    const ok = await webgpuPreflight();
    if (!ok) {
      setStatus('WebGPU non utilisable ici. Bascule WASM CPU.', 5, 'Runtime fiable conservé. WebGPU reste expérimental.');
      runtime = 'wasm';
    }
  }
  return runtime;
}

function createWorker() {
  if (!canUseModuleWorker()) throw new Error('Worker module indisponible dans ce navigateur.');
  return new Worker('./src/asr.worker.js', { type: 'module' });
}

function createAlignWorker() {
  if (!canUseModuleWorker()) throw new Error('Worker module indisponible dans ce navigateur.');
  return new Worker('./src/align.worker.js', { type: 'module' });
}

function buildLyricsPrompt(lines) {
  const unique = [];
  const seen = new Set();
  for (const line of lines) {
    const compact = String(line || '').replace(/\s+/g, ' ').trim();
    const key = normalizeWord(compact).slice(0, 80);
    if (!compact || seen.has(key)) continue;
    seen.add(key);
    unique.push(compact);
  }
  const words = unique.join(', ').split(/\s+/).filter(Boolean);
  return words.slice(0, 200).join(' ');
}

function vocalOnsets(pcm, sr = ASR_SAMPLE_RATE) {
  if (!(pcm instanceof Float32Array) || !pcm.length) return [];
  const frame = Math.max(160, Math.round(sr * 0.02));
  const hop = Math.max(80, Math.round(sr * 0.01));
  const energies = [];
  let hpPrevX = 0;
  let hpPrevY = 0;
  const hpAlpha = Math.exp((-2 * Math.PI * 150) / sr);
  const lpAlpha = Math.exp((-2 * Math.PI * 5500) / sr);
  let lpY = 0;
  const filtered = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) {
    const x = pcm[i] || 0;
    const hp = hpAlpha * (hpPrevY + x - hpPrevX);
    hpPrevX = x;
    hpPrevY = hp;
    lpY = (1 - lpAlpha) * hp + lpAlpha * lpY;
    filtered[i] = lpY;
  }
  for (let start = 0; start + frame <= filtered.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + frame; i += 1) sum += filtered[i] * filtered[i];
    energies.push(Math.sqrt(sum / frame));
  }
  if (energies.length < 4) return [];
  const sorted = [...energies].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.35)] || 1e-5;
  const median = sorted[Math.floor(sorted.length * 0.5)] || floor;
  const threshold = Math.max(floor * 2.5, median * 1.65, 1e-4);
  const onsets = [];
  let last = -1;
  for (let i = 2; i < energies.length; i += 1) {
    const prev = Math.max(energies[i - 1], 1e-6);
    const curr = energies[i];
    if (curr > threshold && curr / prev > 1.28 && (last < 0 || (i - last) * hop / sr > 0.18)) {
      onsets.push((i * hop) / sr);
      last = i;
    }
  }
  return onsets;
}

function snapStart(start, onsets, lo, hi) {
  let best = null;
  let bestD = Infinity;
  for (const t of onsets) {
    if (t < lo || t > hi) continue;
    const d = Math.abs(t - start);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function applyVocalOnsetSnapping(cues, onsets, duration) {
  if (!Array.isArray(onsets) || !onsets.length || !Array.isArray(cues) || !cues.length) return cues;
  let prevEnd = 0;
  let changed = 0;
  for (const cue of cues) {
    const minDur = Math.max(MIN_CUE_DURATION, String(cue.text || '').length / CPS_MAX);
    const lo = Math.max(prevEnd + 0.03, cue.start - 0.35);
    const hi = Math.min(cue.end - minDur, cue.start + 0.12);
    const snapped = hi > lo ? snapStart(cue.start, onsets, lo, hi) : null;
    if (Number.isFinite(snapped)) {
      cue.start = snapped;
      changed += 1;
    }
    prevEnd = cue.end;
  }
  const ordered = enforceCueOrder(cues, duration);
  ordered.snappedCount = changed;
  return ordered;
}

async function generateAutoCaptions() {
  if (state.running) return;
  if (!state.audioFile) { setStatus('Ajoute d’abord un MP3 ou WAV.', 0); return; }
  const lines = splitCleanLyrics(els.lyricsInput.value);
  if (!lines.length) { setStatus('Colle les paroles propres avant de générer.', 0); return; }

  state.running = true;
  state.asrWords = [];
  state.transcript = '';
  state.cues = [];
  state.activeCueIndex = -1;
  state.activeWordIndex = -1;
  renderCueList();
  renderTrack();
  setMetrics();
  updateEngineSummary();
  els.generateBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.generateBtn.textContent = `Génération - ${modelLabel()}...`;
  startElapsedTimer();

  try {
    setStatus('Préparation audio 16 kHz mono...', 8, 'Décodage local puis transfert zero-copy vers le Worker ASR.');
    setPhase('préparation audio');
    const pcm = await decodeAudioToMono16k(state.audioFile);
    state.pcm16kForAlign = els.forcedAlignToggle?.checked ? pcm.slice() : null;
    state.forcedWords = [];
    state.vocalOnsets = [];
    if (els.onsetToggle?.checked) {
      setStatus('Analyse locale des attaques vocales...', 18, 'Calcul VAD léger sur le PCM 16 kHz, sans upload.');
      setPhase('analyse attaques');
      state.vocalOnsets = vocalOnsets(pcm, ASR_SAMPLE_RATE);
    }
    els.seekBar.max = '100000';
    els.seekBar.step = '1';
    els.seekBar.disabled = false;
    els.timeDisplay.textContent = `00:00.00 / ${formatClock(state.duration)}`;

    const runtime = await resolveRuntime();
    const language = els.languageSelect.value === 'auto' ? undefined : (els.languageSelect.value || 'french');
    const lyricsPrompt = els.guideToggle?.checked ? buildLyricsPrompt(lines) : '';
    state.worker = createWorker();
    const progressId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    state.worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.progressId && msg.progressId !== progressId) return;
      if (msg.type === 'status') {
        setStatus(msg.text || 'Worker ASR...', null, 'Transcription via Worker. L’interface reste utilisable.');
      } else if (msg.type === 'progress') {
        setProgress(msg.pct);
        setPhase(msg.phase || 'asr');
      } else if (msg.type === 'partial') {
        if (msg.text && !state.transcript.includes(msg.text)) {
          state.transcript = `${state.transcript}${state.transcript ? ' ' : ''}${msg.text}`.trim();
          if (els.transcriptOutput) els.transcriptOutput.value = state.transcript;
        }
      } else if (msg.type === 'done') {
        onWorkerDone(msg.words || [], msg.text || '', lines);
      } else if (msg.type === 'error') {
        throwWorkerError(msg.message || 'Erreur worker inconnue.');
      }
    };

    state.worker.onerror = (error) => {
      throwWorkerError(error.message || 'Erreur worker ASR.');
    };

    setStatus('Transcription française en Worker...', 58, 'Un seul appel Whisper avec chunking natif 30s / stride 5s.');
    setPhase('worker asr');
    state.worker.postMessage({
      type: 'run',
      pcm,
      sampleRate: ASR_SAMPLE_RATE,
      model: els.modelSelect.value,
      device: runtime,
      language,
      lyricsPrompt,
      progressId,
    }, [pcm.buffer]);
  } catch (error) {
    finishGeneration(false, error.message || String(error));
  }
}

function throwWorkerError(message) {
  finishGeneration(false, message);
}

function onWorkerDone(words, text, lines) {
  state.asrWords = words;
  state.transcript = text;
  if (els.transcriptOutput) els.transcriptOutput.value = text;
  setMetrics();
  setStatus(`Alignement global avec les paroles propres (${words.length} mots ASR)...`, 88, 'Needleman-Wunsch global, texte exporté inchangé.');
  setPhase('alignement global');
  if (!words.length) {
    finishGeneration(false, 'Aucun timestamp mot renvoyé par Whisper. Essaie un autre modèle ou runtime.');
    return;
  }
  try {
    state.cues = buildCuesFromLyricsAndAsr(lines, words, state.duration);
    if (els.forcedAlignToggle?.checked && state.pcm16kForAlign) {
      startForcedAlignment(lines);
      return;
    }
    finalizeGeneratedCues(words.length, 0, 'ASR');
  } catch (error) {
    finishGeneration(false, error.message || String(error));
  }
}

function startForcedAlignment(lines) {
  const segments = buildForcedAlignSegments(lines, state.cues, state.duration);
  if (!segments.length) {
    mergeCtcDiagnostic({ status: 'CTC ignoré', fallbackReason: 'aucun segment alignable' });
    finalizeGeneratedCues(state.asrWords.length, 0, 'ASR fallback');
    return;
  }
  let alignPcm = state.pcm16kForAlign;
  state.pcm16kForAlign = null;
  const language = els.languageSelect.value === 'auto' ? 'french' : (els.languageSelect.value || 'french');
  const runtime = els.runtimeSelect.value === 'webgpu' ? 'webgpu' : 'wasm';
  mergeCtcDiagnostic({ status: 'CTC lancement', segments: segments.length, requestedWords: segments.reduce((sum, segment) => sum + (segment.words?.length || 0), 0) });
  setStatus(`Alignement forcé CTC (${segments.length} segments)...`, 92, 'Option précision max: wav2vec2 CTC sur les paroles connues.');
  setPhase('forced alignment');
  try {
    state.alignWorker = createAlignWorker();
    state.alignWorker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'status') {
        setStatus(msg.text || 'Alignement forcé...', null, 'Repli transparent sur les timestamps ASR si un segment échoue.');
      } else if (msg.type === 'progress') {
        setProgress(90 + Math.max(0, Math.min(9, (Number(msg.pct) || 0) * 0.09)));
      } else if (msg.type === 'diagnostic') {
        mergeCtcDiagnostic(msg);
      } else if (msg.type === 'aligned') {
        mergeCtcDiagnostic(msg.diagnostics || {});
        onForcedAlignmentDone(msg.words || [], msg.modelId || 'CTC', msg.diagnostics || {});
      } else if (msg.type === 'error') {
        mergeCtcDiagnostic({ status: 'CTC erreur', fallbackReason: msg.message || 'erreur inconnue' });
        setStatus(`Alignement forcé indisponible: ${msg.message || 'erreur inconnue'}`, 96, 'Repli automatique sur les timestamps Whisper + NW.');
        finalizeGeneratedCues(state.asrWords.length, 0, 'ASR fallback');
      }
    };
    state.alignWorker.onerror = (error) => {
      mergeCtcDiagnostic({ status: 'CTC worker error', fallbackReason: error.message || 'erreur worker' });
      setStatus(`Alignement forcé indisponible: ${error.message || 'erreur worker'}`, 96, 'Repli automatique sur les timestamps Whisper + NW.');
      finalizeGeneratedCues(state.asrWords.length, 0, 'ASR fallback');
    };
    state.alignWorker.postMessage({
      type: 'falign',
      pcm16k: alignPcm,
      sampleRate: ASR_SAMPLE_RATE,
      language,
      segments,
      device: runtime,
    }, [alignPcm.buffer]);
    alignPcm = null;
  } catch (error) {
    state.pcm16kForAlign = null;
    mergeCtcDiagnostic({ status: 'CTC non lancé', fallbackReason: error.message || String(error) });
    setStatus(`Alignement forcé non lancé: ${error.message || error}`, 96, 'Repli automatique sur les timestamps ASR.');
    finalizeGeneratedCues(state.asrWords.length, 0, 'ASR fallback');
  }
}

function onForcedAlignmentDone(forcedWords, modelId, diagnostics = {}) {
  try {
    state.forcedWords = forcedWords;
    const before = state.cues.length;
    state.cues = applyForcedAlignmentToCues(state.cues, forcedWords, state.duration);
    const forcedCount = state.cues.forcedCount || 0;
    const forcedCueCount = state.cues.forcedCueCount || 0;
    const changedCueCount = state.cues.changedCueCount || 0;
    const avgShiftMs = state.cues.avgShiftMs || 0;
    mergeCtcDiagnostic({
      status: forcedCount ? 'CTC appliqué' : 'CTC sans substitution',
      modelId,
      alignedWords: forcedWords.length,
      substitutedWords: forcedCount,
      cuesAffected: forcedCueCount,
      cuesChanged: changedCueCount,
      avgShiftMs,
      fallbackReason: forcedCount ? '' : '0 timestamp substitué',
      ...diagnostics,
    });
    if (!forcedCount) {
      setStatus('CTC terminé mais aucune substitution appliquée.', 98, `Modèle CTC: ${modelId}. ${forcedWords.length} mots renvoyés, 0 utilisé.`);
      finalizeGeneratedCues(state.asrWords.length, 0, 'ASR fallback - CTC 0');
      return;
    }
    setStatus(`Alignement forcé appliqué: ${forcedCount} mots recalés.`, 98, `Modèle CTC: ${modelId}. ${before} cues conservées, ${changedCueCount} modifiées, delta moyen ${Math.round(avgShiftMs)} ms.`);
    finalizeGeneratedCues(state.asrWords.length, forcedCount, 'forced CTC');
  } catch (error) {
    mergeCtcDiagnostic({ status: 'CTC rejeté', fallbackReason: error.message || String(error) });
    setStatus(`Alignement forcé rejeté: ${error.message || error}`, 96, 'Repli automatique sur les timestamps Whisper + NW.');
    finalizeGeneratedCues(state.asrWords.length, 0, 'ASR fallback');
  }
}

function finalizeGeneratedCues(wordCount, forcedCount = 0, source = 'ASR') {
  let snapped = 0;
  if (els.onsetToggle?.checked && state.vocalOnsets.length) {
    state.cues = applyVocalOnsetSnapping(state.cues, state.vocalOnsets, state.duration);
    snapped = state.cues.snappedCount || 0;
  }
  refreshCueQuality();
  const q = state.qualitySummary || {};
  setProgress(100);
  setStatus(`Captions générées: ${state.cues.length} cues, ${wordCount} mots ASR.`, 100, `Source timing: ${source}. CTC: ${forcedCount} mots. Snapping vocal: ${snapped} débuts ajustés. À vérifier: ${q.warn || 0}.`);
  setPhase('terminé');
  renderCueList();
  renderTrack();
  updateCueSelection(-1);
  requestRenderFrame();
  finishGeneration(true);
}

function stopGeneration() {
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  if (state.alignWorker) {
    state.alignWorker.terminate();
    state.alignWorker = null;
  }
  state.pcm16kForAlign = null;
  if (state.running) finishGeneration(false, 'Génération interrompue.');
}

function finishGeneration(success, error = '') {
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  if (state.alignWorker) {
    state.alignWorker.terminate();
    state.alignWorker = null;
  }
  state.pcm16kForAlign = null;
  state.running = false;
  stopElapsedTimer();
  els.generateBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.downloadSrtBtn.disabled = state.cues.length === 0;
  els.downloadVttBtn.disabled = state.cues.length === 0;
  els.downloadJsonBtn.disabled = state.cues.length === 0;
  if (!success && error) {
    setStatus(`Erreur: ${error}`, 0, 'Tu peux relancer avec un autre modèle/runtime.');
    setPhase('erreur');
  }
  updateEngineSummary();
  setMetrics();
}

function cuesToSrt(cues) {
  return cues.map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`).join('\n\n') + '\n';
}

function cuesToVtt(cues) {
  return 'WEBVTT\n\n' + cues.map((cue) => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}`).join('\n\n') + '\n';
}

function cuesToJson(cues) {
  return JSON.stringify({
    app: 'PAXLAB Subs',
    version: APP_VERSION,
    language: els.languageSelect.value === 'auto' ? 'auto' : 'fr-FR',
    model: els.modelSelect.value,
    runtime: els.runtimeSelect.value,
    guidedRecognition: Boolean(els.guideToggle?.checked),
    vocalOnsetSnap: Boolean(els.onsetToggle?.checked),
    forcedAlignment: Boolean(els.forcedAlignToggle?.checked),
    forcedWords: state.forcedWords.length,
    ctcStats: state.ctcStats,
    qualitySummary: state.qualitySummary,
    vocalOnsets: state.vocalOnsets.length,
    sourceAudio: state.audioFile?.name || null,
    duration: state.duration,
    asrWords: state.asrWords.length,
    cues,
  }, null, 2);
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function baseName() {
  const name = state.audioFile?.name || 'paxlab-subs';
  return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'paxlab-subs';
}

function bindEvents() {
  els.audioInput.addEventListener('change', (event) => setAudioFile(event.target.files?.[0]));
  ['dragenter', 'dragover'].forEach((name) => els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.add('ps-is-drag');
  }));
  ['dragleave', 'drop'].forEach((name) => els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('ps-is-drag');
  }));
  els.dropZone.addEventListener('drop', (event) => setAudioFile(event.dataTransfer?.files?.[0]));

  els.audioEl.addEventListener('loadedmetadata', () => {
    state.duration = els.audioEl.duration || state.duration;
    els.timeDisplay.textContent = `00:00.00 / ${formatClock(state.duration)}`;
    els.seekBar.max = '100000';
    els.seekBar.step = '1';
    els.seekBar.disabled = false;
    syncPlaybackAnchor();
    setStatus(`Audio prêt: ${formatClock(state.duration)}.`, 0, 'Colle les paroles propres puis génère.');
  });
  els.audioEl.addEventListener('play', () => { els.playBtn.textContent = 'Stop'; syncPlaybackAnchor(); requestRenderFrame(); });
  els.audioEl.addEventListener('pause', () => { els.playBtn.textContent = 'Play'; syncPlaybackAnchor(); requestRenderFrame(); });
  els.audioEl.addEventListener('timeupdate', () => { syncPlaybackAnchor(); requestRenderFrame(); });
  els.audioEl.addEventListener('seeked', () => { syncPlaybackAnchor(); requestRenderFrame(); });

  els.seekBar.addEventListener('input', () => {
    if (!state.duration) return;
    els.audioEl.currentTime = (Number(els.seekBar.value) / 100000) * state.duration;
    syncPlaybackAnchor();
    requestRenderFrame();
  });
  els.playBtn.addEventListener('click', togglePlayback);
  document.addEventListener('keydown', handleKeyboardShortcuts);
  els.generateBtn.addEventListener('click', generateAutoCaptions);
  els.stopBtn.addEventListener('click', stopGeneration);
  els.resetBtn.addEventListener('click', resetApp);
  els.testRuntimeBtn.addEventListener('click', async () => {
    const runtime = els.runtimeSelect.value;
    if (runtime === 'webgpu') {
      const ok = await webgpuPreflight();
      setStatus(ok ? 'WebGPU préflight OK.' : 'WebGPU non utilisable ici.', ok ? 10 : 0, ok ? 'Tu peux tester WebGPU, mais WASM reste le défaut stable.' : 'Garde WASM CPU stable.');
    } else {
      setStatus(`Runtime ${runtimeLabel()} prêt. Cross-origin isolated: ${self.crossOriginIsolated ? 'oui' : 'non'}.`, 0, 'Sur Cloudflare, _headers DEV2.10 tente d’activer COEP credentialless.');
    }
  });
  els.modelSelect.addEventListener('change', updateEngineSummary);
  els.runtimeSelect.addEventListener('change', updateEngineSummary);

  els.cueAdjustButtons.forEach((button) => button.addEventListener('click', () => {
    adjustSelectedCue(button.dataset.psAdjust, Number(button.dataset.psDelta));
  }));
  els.startInput.addEventListener('change', () => {
    const cue = state.cues[state.selectedCueIndex];
    const value = parseCueTime(els.startInput.value);
    if (cue && Number.isFinite(value)) applyCueTimes(state.selectedCueIndex, value, cue.end);
    else if (cue) els.startInput.value = formatCueTime(cue.start);
  });
  els.endInput.addEventListener('change', () => {
    const cue = state.cues[state.selectedCueIndex];
    const value = parseCueTime(els.endInput.value);
    if (cue && Number.isFinite(value)) applyCueTimes(state.selectedCueIndex, cue.start, value);
    else if (cue) els.endInput.value = formatCueTime(cue.end);
  });

  if (els.setStartBtn) els.setStartBtn.addEventListener('click', () => setSelectedCueEdge('start'));
  if (els.setEndBtn) els.setEndBtn.addEventListener('click', () => setSelectedCueEdge('end', { selectNext: true }));

  els.downloadSrtBtn.addEventListener('click', () => downloadText(`${baseName()}.srt`, cuesToSrt(state.cues), 'text/plain;charset=utf-8'));
  els.downloadVttBtn.addEventListener('click', () => downloadText(`${baseName()}.vtt`, cuesToVtt(state.cues), 'text/vtt;charset=utf-8'));
  els.downloadJsonBtn.addEventListener('click', () => downloadText(`${baseName()}.json`, cuesToJson(state.cues), 'application/json;charset=utf-8'));
}

bindEvents();
updateEngineSummary();
setMetrics();
requestRenderFrame();
