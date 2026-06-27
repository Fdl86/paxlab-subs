const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0';
const PAXLAB_LANGUAGE = 'french';
const MIN_CUE_DURATION = 0.85;
const MAX_LOOKAHEAD_WORDS = 34;
const ASR_SAMPLE_RATE = 16000;
const ASR_CHUNK_SECONDS = 12;
const ASR_CHUNK_OVERLAP_SECONDS = 1.2;

const state = {
  audioFile: null,
  audioUrl: '',
  duration: 0,
  cues: [],
  activeCueIndex: -1,
  transcriberCache: new Map(),
  wordCount: 0,
  transcript: '',
  running: false,
  jobStartedAt: 0,
  progressTimer: null,
  progressBase: 0,
  progressMax: 0,
  asrWords: [],
  progressiveCues: [],
  cancelRequested: false,
};

const $ = (id) => document.getElementById(id);

const els = {
  audioInput: $('psAudioInput'),
  dropZone: $('psDropZone'),
  audioDropTitle: $('psAudioDropTitle'),
  audioMeta: $('psAudioMeta'),
  languageSelect: $('psLanguageSelect'),
  segmentationSelect: $('psSegmentationSelect'),
  modelSelect: $('psModelSelect'),
  runtimeSelect: $('psRuntimeSelect'),
  lyricsInput: $('psLyricsInput'),
  generateBtn: $('psGenerateBtn'),
  playBtn: $('psPlayBtn'),
  resetBtn: $('psResetBtn'),
  statusText: $('psStatusText'),
  progressFill: $('psProgressFill'),
  phaseText: $('psPhaseText'),
  elapsedText: $('psElapsedText'),
  engineText: $('psEngineText'),
  progressHint: $('psProgressHint'),
  previewCard: $('psPreviewCard'),
  previewLanguage: $('psPreviewLanguage'),
  prevLine: $('psPrevLine'),
  activeLine: $('psActiveLine'),
  nextLine: $('psNextLine'),
  audioEl: $('psAudioEl'),
  playerToggle: $('psPlayerToggle'),
  seekBar: $('psSeekBar'),
  timeDisplay: $('psTimeDisplay'),
  resultsGrid: $('psResultsGrid'),
  cueList: $('psCueList'),
  cueCount: $('psCueCount'),
  asrCount: $('psAsrCount'),
  transcriptOutput: $('psTranscriptOutput'),
  downloadSrtBtn: $('psDownloadSrtBtn'),
  downloadVttBtn: $('psDownloadVttBtn'),
  downloadJsonBtn: $('psDownloadJsonBtn'),
  stopBtn: $('psStopBtn'),
  testRuntimeBtn: $('psTestRuntimeBtn'),
  chunkText: $('psChunkText'),
  liveCueMetric: $('psLiveCueMetric'),
  liveWordMetric: $('psLiveWordMetric'),
  runtimeBadge: $('psRuntimeBadge'),
};

function setLiveMetrics() {
  if (els.liveCueMetric) els.liveCueMetric.textContent = String(state.cues.length || state.progressiveCues.length || 0);
  if (els.liveWordMetric) els.liveWordMetric.textContent = String(state.wordCount || state.asrWords.length || 0);
  if (els.runtimeBadge) els.runtimeBadge.textContent = state.running ? 'RUNNING' : 'READY';
}

function setStatus(text, progress = null, hint = null) {
  els.statusText.textContent = text;
  if (typeof progress === 'number') {
    els.progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
  if (hint !== null && els.progressHint) els.progressHint.textContent = hint;
  if (els.runtimeBadge && text) els.runtimeBadge.textContent = state.running ? 'RUNNING' : 'READY';
}


function setPhase(phase, progress = null, hint = null) {
  if (els.phaseText) els.phaseText.textContent = `Phase: ${phase}`;
  if (typeof progress === 'number') {
    els.progressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
  if (hint !== null && els.progressHint) els.progressHint.textContent = hint;
  if (els.chunkText) els.chunkText.textContent = phase.startsWith('chunk') ? phase : els.chunkText.textContent || 'Chunk: idle';
}


function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return m > 0 ? `${m}:${s}` : `${total}s`;
}

function startProgressHeartbeat(phase, base, max, hint) {
  stopProgressHeartbeat();
  state.jobStartedAt = performance.now();
  state.progressBase = base;
  state.progressMax = max;
  setPhase(phase, base, hint);

  state.progressTimer = window.setInterval(() => {
    const elapsedMs = performance.now() - state.jobStartedAt;
    if (els.elapsedText) els.elapsedText.textContent = `Elapsed: ${formatElapsed(elapsedMs)}`;

    const elapsedSec = elapsedMs / 1000;
    const softProgress = base + (max - base) * (1 - Math.exp(-elapsedSec / 85));
    els.progressFill.style.width = `${Math.min(max, softProgress).toFixed(1)}%`;

    if (elapsedSec > 180 && els.progressHint) {
      els.progressHint.textContent = 'Toujours en cours. Sur WASM CPU, Whisper peut être très lent sur un morceau complet. Pour tester vite, utilise Fast test - Whisper tiny FR.';
    } else if (elapsedSec > 60 && els.progressHint) {
      els.progressHint.textContent = 'Toujours en cours. Le navigateur ne donne pas de pourcentage exact pendant la transcription, mais le job est actif.';
    }
  }, 1000);
}

function stopProgressHeartbeat() {
  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
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
  if (!Number.isFinite(seconds)) seconds = 0;
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}

function formatSrtTime(seconds) {
  const msTotal = Math.max(0, Math.round(seconds * 1000));
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

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length <= 2 || b.length <= 2) return 0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function splitCleanLyrics(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function tokenizeDisplayLine(text) {
  return String(text || '').match(/\S+/g) || [];
}

function flattenLyrics(lines) {
  const words = [];
  lines.forEach((line, lineIndex) => {
    tokenizeDisplayLine(line).forEach((text, wordIndex) => {
      const norm = normalizeWord(text);
      words.push({ text, norm, lineIndex, wordIndex, start: null, end: null, score: 0 });
    });
  });
  return words;
}

function extractAsrWords(output, offsetSeconds = 0) {
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const words = [];
  for (const chunk of chunks) {
    const text = String(chunk?.text || '').trim();
    const ts = chunk?.timestamp || chunk?.timestamps;
    if (!text || !Array.isArray(ts)) continue;
    const start = Number(ts[0]);
    const end = Number(ts[1]);
    const norm = normalizeWord(text);
    if (!norm || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    words.push({ text, norm, start: start + offsetSeconds, end: (end > start ? end : start + 0.18) + offsetSeconds });
  }
  return words.sort((a, b) => a.start - b.start);
}

function alignWords(lyricsWords, asrWords) {
  let cursor = 0;
  const validLyricWords = lyricsWords.filter((word) => word.norm);

  for (const lyric of validLyricWords) {
    let bestIndex = -1;
    let bestScore = 0;
    const searchEnd = Math.min(asrWords.length, cursor + MAX_LOOKAHEAD_WORDS);

    for (let i = cursor; i < searchEnd; i += 1) {
      const rawScore = similarity(lyric.norm, asrWords[i].norm);
      const distancePenalty = Math.max(0, i - cursor) * 0.012;
      const score = rawScore - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const threshold = lyric.norm.length <= 3 ? 0.92 : 0.72;
    if (bestIndex >= 0 && bestScore >= threshold) {
      lyric.start = asrWords[bestIndex].start;
      lyric.end = asrWords[bestIndex].end;
      lyric.score = Math.max(0, Math.min(1, bestScore));
      cursor = bestIndex + 1;
    }
  }

  return lyricsWords;
}

function interpolateCueWords(lineWords, cueStart, cueEnd) {
  const timed = lineWords.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
  const displayWords = lineWords.map((word) => ({ ...word }));

  if (timed.length === 0) {
    return spreadWordsByWeight(displayWords, cueStart, cueEnd);
  }

  displayWords.forEach((word, index) => {
    if (Number.isFinite(word.start) && Number.isFinite(word.end)) return;

    let prev = null;
    let next = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (Number.isFinite(displayWords[i].start) && Number.isFinite(displayWords[i].end)) { prev = displayWords[i]; break; }
    }
    for (let i = index + 1; i < displayWords.length; i += 1) {
      if (Number.isFinite(displayWords[i].start) && Number.isFinite(displayWords[i].end)) { next = displayWords[i]; break; }
    }

    if (prev && next) {
      word.start = prev.end + (next.start - prev.end) * 0.35;
      word.end = prev.end + (next.start - prev.end) * 0.65;
    } else if (prev) {
      const step = Math.max(0.18, (cueEnd - prev.end) / (displayWords.length - index + 1));
      word.start = prev.end + step * 0.2;
      word.end = Math.min(cueEnd, word.start + step * 0.8);
    } else if (next) {
      const step = Math.max(0.18, (next.start - cueStart) / (index + 2));
      word.end = Math.max(cueStart, next.start - step * 0.2);
      word.start = Math.max(cueStart, word.end - step * 0.8);
    }
  });

  return spreadMissingSafely(displayWords, cueStart, cueEnd);
}

function spreadWordsByWeight(words, start, end) {
  const duration = Math.max(MIN_CUE_DURATION, end - start);
  const weights = words.map((word) => Math.max(1, normalizeWord(word.text).length || 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = start;
  return words.map((word, index) => {
    const d = duration * (weights[index] / total);
    const item = { ...word, start: cursor, end: index === words.length - 1 ? end : cursor + d };
    cursor += d;
    return item;
  });
}

function spreadMissingSafely(words, start, end) {
  const fallback = spreadWordsByWeight(words, start, end);
  return words.map((word, index) => {
    const hasValid = Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= start && word.start <= end;
    if (!hasValid) return fallback[index];
    return {
      ...word,
      start: Math.max(start, word.start),
      end: Math.min(end, Math.max(word.end, word.start + 0.08)),
    };
  });
}

function buildCuesFromAlignment(lines, alignedWords, audioDuration) {
  const byLine = lines.map((line, lineIndex) => ({ line, lineIndex, words: [] }));
  for (const word of alignedWords) {
    if (byLine[word.lineIndex]) byLine[word.lineIndex].words.push(word);
  }

  const rough = byLine.map((entry) => {
    const timed = entry.words.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
    if (timed.length === 0) return { ...entry, start: null, end: null, confidence: 0 };
    const start = Math.min(...timed.map((word) => word.start));
    const end = Math.max(...timed.map((word) => word.end));
    const confidence = timed.reduce((sum, word) => sum + (word.score || 0), 0) / Math.max(1, entry.words.filter((w) => w.norm).length);
    return { ...entry, start, end, confidence };
  });

  fillMissingLineTimes(rough, audioDuration);
  enforceCueOrder(rough, audioDuration);

  return rough.map((entry, index) => ({
    id: index + 1,
    start: entry.start,
    end: entry.end,
    text: entry.line,
    confidence: Number(entry.confidence || 0),
    words: interpolateCueWords(entry.words, entry.start, entry.end),
  }));
}

function fillMissingLineTimes(entries, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : entries.length * 2.4;
  const totalWeight = entries.reduce((sum, entry) => sum + Math.max(1, entry.line.length), 0) || 1;
  let proportionalCursor = 0.8;

  entries.forEach((entry) => {
    if (Number.isFinite(entry.start) && Number.isFinite(entry.end)) return;
    const d = Math.max(MIN_CUE_DURATION, (safeDuration * 0.82) * (Math.max(1, entry.line.length) / totalWeight));
    entry.start = proportionalCursor;
    entry.end = Math.min(safeDuration - 0.25, proportionalCursor + d);
    entry.confidence = 0;
    proportionalCursor = entry.end + 0.12;
  });

  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].confidence > 0) continue;
    let prev = null;
    let next = null;
    for (let p = i - 1; p >= 0; p -= 1) {
      if (entries[p].confidence > 0) { prev = p; break; }
    }
    for (let n = i + 1; n < entries.length; n += 1) {
      if (entries[n].confidence > 0) { next = n; break; }
    }
    if (prev !== null && next !== null) {
      const gapStart = entries[prev].end + 0.08;
      const gapEnd = entries[next].start - 0.08;
      const count = next - prev - 1;
      const slot = Math.max(MIN_CUE_DURATION, (gapEnd - gapStart) / Math.max(1, count));
      for (let k = prev + 1; k < next; k += 1) {
        const local = k - prev - 1;
        entries[k].start = gapStart + slot * local;
        entries[k].end = Math.min(gapEnd, entries[k].start + slot * 0.88);
      }
      i = next;
    }
  }
}

function enforceCueOrder(entries, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : entries.length * 2.4;
  let prevEnd = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    entry.start = Number.isFinite(entry.start) ? entry.start : prevEnd + 0.1;
    entry.end = Number.isFinite(entry.end) ? entry.end : entry.start + 1.8;
    entry.start = Math.max(0, entry.start);
    if (entry.start < prevEnd + 0.02) entry.start = prevEnd + 0.02;
    if (entry.end < entry.start + MIN_CUE_DURATION) entry.end = entry.start + MIN_CUE_DURATION;
    if (entry.end > safeDuration) entry.end = Math.max(entry.start + 0.25, safeDuration - 0.05);
    prevEnd = entry.end;
  }
}


function buildPartialCuesFromAlignment(lines, alignedWords, audioDuration) {
  const byLine = lines.map((line, lineIndex) => ({ line, lineIndex, words: [] }));
  for (const word of alignedWords) {
    if (byLine[word.lineIndex]) byLine[word.lineIndex].words.push(word);
  }

  const entries = [];
  for (const entry of byLine) {
    const normWords = entry.words.filter((word) => word.norm);
    const timed = entry.words.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
    if (timed.length === 0) continue;

    const coverage = timed.length / Math.max(1, normWords.length);
    if (normWords.length >= 5 && coverage < 0.2) continue;

    const start = Math.min(...timed.map((word) => word.start));
    let end = Math.max(...timed.map((word) => word.end));
    if (end - start < 0.55) {
      const estimated = Math.max(MIN_CUE_DURATION, Math.min(3.2, entry.line.length / 15));
      end = start + estimated;
    }
    entries.push({
      ...entry,
      start,
      end: Number.isFinite(audioDuration) && audioDuration > 0 ? Math.min(audioDuration, end) : end,
      confidence: timed.reduce((sum, word) => sum + (word.score || 0), 0) / Math.max(1, normWords.length),
    });
  }

  entries.sort((a, b) => a.start - b.start);
  enforceCueOrder(entries, audioDuration);

  return entries.map((entry, index) => ({
    id: index + 1,
    sourceLine: entry.lineIndex + 1,
    start: entry.start,
    end: entry.end,
    text: entry.line,
    confidence: Number(entry.confidence || 0),
    partial: true,
    words: interpolateCueWords(entry.words, entry.start, entry.end),
  }));
}

function dedupeAsrWords(words) {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const deduped = [];
  for (const word of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.start - word.start) < 0.18 && last.norm === word.norm) {
      if ((word.end - word.start) > (last.end - last.start)) deduped[deduped.length - 1] = word;
      continue;
    }
    deduped.push(word);
  }
  return deduped;
}

async function decodeAudioToMono16k(file) {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('AudioContext indisponible dans ce navigateur.');
  const ctx = new AudioContextClass();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const sourceRate = audioBuffer.sampleRate;
  const sourceLength = audioBuffer.length;
  const mono = new Float32Array(sourceLength);

  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch += 1) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < sourceLength; i += 1) mono[i] += data[i] / audioBuffer.numberOfChannels;
  }
  if (typeof ctx.close === 'function') ctx.close().catch(() => {});

  if (sourceRate === ASR_SAMPLE_RATE) return mono;

  const targetLength = Math.max(1, Math.round((mono.length / sourceRate) * ASR_SAMPLE_RATE));
  const resampled = new Float32Array(targetLength);
  const ratio = sourceRate / ASR_SAMPLE_RATE;
  for (let i = 0; i < targetLength; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, mono.length - 1);
    const t = pos - left;
    resampled[i] = mono[left] * (1 - t) + mono[right] * t;
  }
  return resampled;
}

function sliceAudio(audio, startSeconds, endSeconds) {
  const start = Math.max(0, Math.floor(startSeconds * ASR_SAMPLE_RATE));
  const end = Math.min(audio.length, Math.ceil(endSeconds * ASR_SAMPLE_RATE));
  return audio.slice(start, end);
}

function buildChunkPlan(duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const chunks = [];
  let start = 0;
  while (start < safeDuration) {
    const end = Math.min(safeDuration, start + ASR_CHUNK_SECONDS);
    chunks.push({ index: chunks.length + 1, start, end });
    if (end >= safeDuration) break;
    start = Math.max(0, end - ASR_CHUNK_OVERLAP_SECONDS);
  }
  return chunks.length ? chunks : [{ index: 1, start: 0, end: Math.max(ASR_CHUNK_SECONDS, safeDuration) }];
}

function updateProgressiveCues(lines, asrWords, chunkIndex, chunkCount) {
  const lyricWords = flattenLyrics(lines);
  const aligned = alignWords(lyricWords, asrWords);
  const partialCues = buildPartialCuesFromAlignment(lines, aligned, state.duration);
  state.cues = partialCues;
  state.progressiveCues = partialCues;
  state.wordCount = asrWords.length;
  setStatus(`Transcription chunk ${chunkIndex}/${chunkCount}: ${partialCues.length} cues visibles.`, 50 + Math.round((chunkIndex / Math.max(1, chunkCount)) * 35), 'Les cues apparaissent au fur et à mesure des segments audio terminés. Résultat final consolidé à la fin.');
  setPhase('transcription progressive', 50 + Math.round((chunkIndex / Math.max(1, chunkCount)) * 35), `${partialCues.length} cues affichées - ${asrWords.length} mots détectés.`);
  refreshOutputs(true);
  setLiveMetrics();
}

function activeCueAt(time) {
  return state.cues.findIndex((cue) => time >= cue.start && time <= cue.end);
}

function activeWordIndex(cue, time) {
  if (!cue?.words?.length) return -1;
  let fallback = -1;
  for (let i = 0; i < cue.words.length; i += 1) {
    const word = cue.words[i];
    if (!normalizeWord(word.text)) continue;
    if (time >= word.start && time <= word.end) return i;
    if (time >= word.start) fallback = i;
  }
  return fallback;
}

function renderActiveLine(cue, time) {
  els.activeLine.innerHTML = '';
  if (!cue) {
    els.activeLine.textContent = 'La ligne synchronisée apparaîtra ici.';
    return;
  }
  const activeIndex = activeWordIndex(cue, time);
  cue.words.forEach((word, index) => {
    const span = document.createElement('span');
    span.textContent = word.text;
    if (index === activeIndex && normalizeWord(word.text)) span.className = 'ps-active-word';
    els.activeLine.appendChild(span);
  });
}

function renderCueList() {
  els.cueList.innerHTML = '';
  state.cues.forEach((cue, index) => {
    const row = document.createElement('div');
    row.className = 'ps-cue-row';
    row.dataset.index = String(index);
    row.innerHTML = `<span class="ps-cue-time">${formatClock(cue.start)}</span><span>${escapeHtml(cue.text)}</span>`;
    row.addEventListener('dblclick', () => {
      els.audioEl.currentTime = cue.start + 0.02;
      els.audioEl.play().catch(() => {});
    });
    els.cueList.appendChild(row);
  });
  els.cueCount.textContent = `${state.cues.length} cues${state.running ? ' live' : ''}`;
}

function updatePreview() {
  const time = els.audioEl.currentTime || 0;
  if (state.duration > 0) els.seekBar.value = String(Math.round((time / state.duration) * 1000));
  els.timeDisplay.textContent = `${formatClock(time)} / ${formatClock(state.duration)}`;

  const index = activeCueAt(time);
  if (index !== state.activeCueIndex) {
    state.activeCueIndex = index;
    const rows = els.cueList.querySelectorAll('.ps-cue-row');
    rows.forEach((row) => row.classList.toggle('ps-is-active', Number(row.dataset.index) === index));
  }

  const cue = state.cues[index];
  els.prevLine.textContent = index > 0 ? state.cues[index - 1].text : '';
  els.nextLine.textContent = index >= 0 && index < state.cues.length - 1 ? state.cues[index + 1].text : '';
  renderActiveLine(cue, time);

  requestAnimationFrame(updatePreview);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch]));
}


async function webgpuPreflight() {
  if (!navigator.gpu) return false;
  setPhase('test webgpu', 2, 'Vérification rapide WebGPU avant chargement du modèle.');
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

async function getTranscriber() {
  const model = els.modelSelect.value;
  let runtime = els.runtimeSelect.value;
  if (runtime === 'auto') runtime = 'wasm';
  if (runtime === 'webgpu') {
    const ok = await webgpuPreflight();
    if (!ok) {
      setStatus('WebGPU détecté mais non utilisable ici. Bascule WASM CPU stable.', 5, 'PAXLAB Subs privilégie le runtime fiable. WebGPU reste expérimental selon navigateur/GPU/driver.');
      runtime = 'wasm';
    }
  }

  const key = `${model}::${runtime}`;
  if (state.transcriberCache.has(key)) return state.transcriberCache.get(key);

  setStatus(`Chargement moteur ASR ${model} (${runtime})...`, 3, runtime === 'wasm' ? 'Runtime stable WASM CPU. Plus lent mais fiable.' : 'Runtime WebGPU expérimental. Bascule possible vers WASM si non utilisable.');
  setPhase('chargement moteur', 3, 'Modèle chargé depuis le cache navigateur si déjà disponible, sinon téléchargement.');
  if (els.engineText) els.engineText.textContent = `Engine: ${runtime} / ${model}`;
  const { pipeline, env } = await import(TRANSFORMERS_CDN);
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const options = {
    device: runtime,
    progress_callback: (data) => {
      if (data?.status === 'progress' && Number.isFinite(data.progress)) {
        setStatus(`Téléchargement modèle: ${data.file || 'model'} ${Math.round(data.progress)}%`, Math.max(5, Math.min(45, data.progress * 0.45)), 'Téléchargement modèle en cours. Cette étape est mise en cache par le navigateur.');
      } else if (data?.status) {
        setStatus(`Moteur ASR: ${data.status}`, null, 'Initialisation moteur ASR.');
      }
    },
  };

  const transcriber = await pipeline('automatic-speech-recognition', model, options);
  state.transcriberCache.set(key, transcriber);
  setStatus('Moteur ASR chargé. Analyse audio...', 48, 'Le modèle est prêt. Lancement de la transcription française par chunks courts.');
  setPhase('moteur prêt', 48, `Le modèle est chargé en ${runtime}.`);
  return transcriber;
}

async function generateAutoCaptions() {
  if (state.running) return;
  if (!state.audioFile || !state.audioUrl) {
    setStatus('Ajoute d’abord un MP3 ou WAV.', 0);
    return;
  }
  const lines = splitCleanLyrics(els.lyricsInput.value);
  if (!lines.length) {
    setStatus('Colle les paroles propres avant de générer.', 0);
    return;
  }

  state.running = true;
  state.cancelRequested = false;
  setLiveMetrics();
  els.generateBtn.disabled = true;
  if (els.stopBtn) els.stopBtn.disabled = false;
  els.generateBtn.textContent = 'Génération...';

  try {
    const transcriber = await getTranscriber();
    const language = els.languageSelect.value === 'auto' ? undefined : els.languageSelect.value || PAXLAB_LANGUAGE;
    const started = performance.now();

    setStatus('Préparation audio pour transcription progressive...', 49, 'Décodage local, conversion mono 16 kHz, puis analyse par segments courts de 12s.');
    setPhase('préparation audio', 49, 'Préparation du buffer audio local.');
    startProgressHeartbeat('préparation audio', 49, 54, 'Décodage local en cours.');
    const audioData = await decodeAudioToMono16k(state.audioFile);
    const chunks = buildChunkPlan(state.duration || (audioData.length / ASR_SAMPLE_RATE));
    stopProgressHeartbeat();

    state.asrWords = [];
    state.transcript = '';
    state.progressiveCues = [];
    state.cues = [];
    refreshOutputs(true);

    for (let i = 0; i < chunks.length; i += 1) {
      if (state.cancelRequested) throw new Error('Génération interrompue par l’utilisateur.');
      const chunk = chunks[i];
      if (els.chunkText) els.chunkText.textContent = `Chunk: ${i + 1}/${chunks.length}`;
      const pctStart = 54 + Math.round((i / Math.max(1, chunks.length)) * 34);
      setStatus(`Transcription française ${i + 1}/${chunks.length} - ${formatClock(chunk.start)} à ${formatClock(chunk.end)}...`, pctStart, 'Chaque segment terminé ajoute des cues dans la timeline.');
      startProgressHeartbeat(`chunk ${i + 1}/${chunks.length}`, pctStart, Math.min(88, pctStart + 8), `Analyse ${formatClock(chunk.start)} -> ${formatClock(chunk.end)}.`);

      const audioChunk = sliceAudio(audioData, chunk.start, chunk.end);
      const output = await transcriber(audioChunk, {
        language,
        task: 'transcribe',
        return_timestamps: 'word',
      });
      stopProgressHeartbeat();

      if (state.cancelRequested) throw new Error('Génération interrompue par l’utilisateur.');
      const newWords = extractAsrWords(output, chunk.start);
      state.asrWords = dedupeAsrWords(state.asrWords.concat(newWords));
      state.transcript += `${state.transcript ? '\n' : ''}[${formatClock(chunk.start)} - ${formatClock(chunk.end)}] ${String(output?.text || '').trim()}`;
      updateProgressiveCues(lines, state.asrWords, i + 1, chunks.length);
      await new Promise((resolve) => setTimeout(resolve, 35));
    }

    const asrWords = state.asrWords;
    state.wordCount = asrWords.length;

    if (!asrWords.length) {
      throw new Error('Le moteur ASR n’a pas renvoyé de timestamps mot par mot. Essaie le modèle Quality ou un navigateur Chromium/WebGPU.');
    }

    setStatus(`Consolidation finale avec les paroles propres (${asrWords.length} mots détectés)...`, 91, 'Conservation du texte exact collé, alignement uniquement sur les timestamps.');
    setPhase('alignement final', 93, `${asrWords.length} mots détectés par le moteur ASR.`);
    const lyricWords = flattenLyrics(lines);
    const aligned = alignWords(lyricWords, asrWords);
    state.cues = buildCuesFromAlignment(lines, aligned, state.duration);

    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    setStatus(`Captions générées automatiquement en ${elapsed}s.`, 100, 'SRT, VTT et JSON prêts à exporter.');
    setPhase('terminé', 100, 'Prévisualisation et exports disponibles.');
    refreshOutputs(false);
  } catch (error) {
    console.error(error);
    stopProgressHeartbeat();
    setPhase('erreur', 0, 'Le moteur auto a échoué ou a été interrompu.');
    setStatus(`Erreur auto: ${error.message || error}`, 0);
  } finally {
    stopProgressHeartbeat();
    state.running = false;
    els.generateBtn.disabled = false;
    if (els.stopBtn) els.stopBtn.disabled = true;
    els.generateBtn.textContent = 'Générer les sous-titres';
    setLiveMetrics();
  }
}

function refreshOutputs(isPartial = false) {
  els.previewCard.hidden = false;
  els.resultsGrid.hidden = false;
  els.seekBar.disabled = state.duration <= 0;
  els.playBtn.disabled = !state.audioUrl;
  els.downloadSrtBtn.disabled = state.cues.length === 0;
  els.downloadVttBtn.disabled = state.cues.length === 0;
  els.downloadJsonBtn.disabled = state.cues.length === 0;
  els.transcriptOutput.value = state.transcript;
  els.asrCount.textContent = `${state.wordCount} words${isPartial ? ' live' : ''}`;
  els.previewLanguage.textContent = `Langue: ${els.languageSelect.value === 'auto' ? 'Auto' : 'Français'}`;
  renderCueList();
  setLiveMetrics();
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
    version: 'dev2-4-responsive-ui',
    language: els.languageSelect.value === 'auto' ? 'auto' : 'fr-FR',
    model: els.modelSelect.value,
    sourceAudio: state.audioFile?.name || null,
    cues,
  }, null, 2);
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function baseName() {
  const name = state.audioFile?.name || 'paxlab-subs';
  return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'paxlab-subs';
}

function setAudioFile(file) {
  if (!file) return;
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioFile = file;
  state.audioUrl = URL.createObjectURL(file);
  state.duration = 0;
  els.audioEl.src = state.audioUrl;
  els.audioDropTitle.textContent = file.name;
  els.audioMeta.textContent = `${formatBytes(file.size)} - local only`;
  setStatus('Audio chargé. En attente des paroles propres.', 0, 'Colle les paroles propres, puis lance Generate Lyrics.');
  setPhase('audio prêt', 0, 'Audio local chargé.');
}

function resetApp() {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioFile = null;
  state.audioUrl = '';
  state.duration = 0;
  state.cues = [];
  state.activeCueIndex = -1;
  state.wordCount = 0;
  state.transcript = '';
  state.asrWords = [];
  state.progressiveCues = [];
  state.cancelRequested = false;
  if (els.chunkText) els.chunkText.textContent = 'Chunk: idle';
  setLiveMetrics();
  els.audioInput.value = '';
  els.audioEl.removeAttribute('src');
  els.audioEl.load();
  els.lyricsInput.value = '';
  els.audioDropTitle.textContent = 'Glisse un MP3/WAV ici ou clique pour choisir';
  els.audioMeta.textContent = 'Traitement local - aucun upload';
  els.previewCard.hidden = false;
  els.resultsGrid.hidden = false;
  els.cueList.innerHTML = '';
  els.transcriptOutput.value = '';
  els.seekBar.value = '0';
  els.playBtn.disabled = true;
  els.downloadSrtBtn.disabled = true;
  els.downloadVttBtn.disabled = true;
  els.downloadJsonBtn.disabled = true;
  setStatus('Ready. Audio + lyrics required.', 0, 'Les cues apparaissent progressivement pendant la transcription par segments.');
  setPhase('idle', 0, 'Les cues apparaissent progressivement pendant la transcription par segments.');
  if (els.elapsedText) els.elapsedText.textContent = 'Elapsed: 0s';
  if (els.engineText) els.engineText.textContent = 'Engine: not loaded';
}

function bindEvents() {
  els.audioInput.addEventListener('change', (event) => setAudioFile(event.target.files?.[0]));

  ['dragenter', 'dragover'].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.add('is-dragging');
    });
  });
  ['dragleave', 'drop'].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('is-dragging');
    });
  });
  els.dropZone.addEventListener('drop', (event) => setAudioFile(event.dataTransfer?.files?.[0]));

  els.audioEl.addEventListener('loadedmetadata', () => {
    state.duration = els.audioEl.duration || 0;
    els.timeDisplay.textContent = `0:00 / ${formatClock(state.duration)}`;
    setStatus(`Audio prêt: ${formatClock(state.duration)}.`, 0, 'Durée audio détectée.');
  });
  els.audioEl.addEventListener('play', () => { els.playerToggle.textContent = '⏸'; els.playBtn.textContent = 'Pause preview'; });
  els.audioEl.addEventListener('pause', () => { els.playerToggle.textContent = '▶'; els.playBtn.textContent = 'Play preview'; });

  els.generateBtn.addEventListener('click', generateAutoCaptions);
  els.playBtn.addEventListener('click', () => els.audioEl.paused ? els.audioEl.play().catch(() => {}) : els.audioEl.pause());
  els.playerToggle.addEventListener('click', () => els.audioEl.paused ? els.audioEl.play().catch(() => {}) : els.audioEl.pause());
  els.seekBar.addEventListener('input', () => {
    if (state.duration > 0) els.audioEl.currentTime = (Number(els.seekBar.value) / 1000) * state.duration;
  });
  els.resetBtn.addEventListener('click', resetApp);
  if (els.stopBtn) els.stopBtn.addEventListener('click', () => {
    state.cancelRequested = true;
    setStatus('Arrêt demandé. Le chunk en cours doit finir avant interruption.', null, 'Le moteur ASR ne peut pas toujours être stoppé instantanément pendant un chunk.');
  });
  if (els.testRuntimeBtn) els.testRuntimeBtn.addEventListener('click', async () => {
    if (els.runtimeSelect.value === 'webgpu') {
      const ok = await webgpuPreflight();
      setStatus(ok ? 'WebGPU préflight OK.' : 'WebGPU indisponible ou bloqué. WASM recommandé.', ok ? 8 : 0, ok ? 'WebGPU peut être tenté, mais WASM reste le profil stable.' : 'Utilise Stable - WASM CPU pour ce navigateur.');
    } else {
      setStatus('Runtime WASM CPU stable sélectionné.', 0, 'Profil recommandé pour éviter les blocages WebGPU.');
    }
  });
  els.downloadSrtBtn.addEventListener('click', () => downloadText(`${baseName()}.srt`, cuesToSrt(state.cues), 'text/plain;charset=utf-8'));
  els.downloadVttBtn.addEventListener('click', () => downloadText(`${baseName()}.vtt`, cuesToVtt(state.cues), 'text/vtt;charset=utf-8'));
  els.downloadJsonBtn.addEventListener('click', () => downloadText(`${baseName()}.json`, cuesToJson(state.cues), 'application/json;charset=utf-8'));
}

bindEvents();
requestAnimationFrame(updatePreview);
