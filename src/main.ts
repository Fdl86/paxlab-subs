import {
  activeWordIndex,
  CaptionCue,
  exportJson,
  exportSrt,
  exportVtt,
  findActiveCue,
  HighlightMode,
  parseCaptions,
} from './core/captions.js';
import { downloadText, fetchSample, fetchSampleBlob } from './core/files.js';
import { AUDIO_LANGUAGE } from './core/language.js';
import { formatClock } from './core/time.js';

type SegmentationMode = 'phrase' | 'line';
type LanguageMode = 'fr-FR' | 'auto';

interface AppState {
  cues: CaptionCue[];
  audioName: string;
  activeIndex: number;
  offset: number;
  highlightMode: HighlightMode;
  language: LanguageMode;
  segmentation: SegmentationMode;
  pendingSampleCaptions: string | null;
  pendingSampleCaptionFormat: 'srt' | 'vtt' | null;
  rafId: number | null;
}

const state: AppState = {
  cues: [],
  audioName: 'paxlab-subs',
  activeIndex: -1,
  offset: 0,
  highlightMode: 'weighted',
  language: AUDIO_LANGUAGE.code,
  segmentation: 'phrase',
  pendingSampleCaptions: null,
  pendingSampleCaptionFormat: null,
  rafId: null,
};

const els = {
  audio: byId<HTMLAudioElement>('audio'),
  audioFile: byId<HTMLInputElement>('audio-file'),
  dropzone: byId<HTMLLabelElement>('dropzone'),
  dropTitle: byId<HTMLSpanElement>('drop-title'),
  dropSubtitle: byId<HTMLSpanElement>('drop-subtitle'),
  languageSelect: byId<HTMLSelectElement>('language-select'),
  segmentationSelect: byId<HTMLSelectElement>('segmentation-select'),
  languageLabel: byId<HTMLSpanElement>('language-label'),
  lyrics: byId<HTMLTextAreaElement>('lyrics'),
  lyricsCount: byId<HTMLSpanElement>('lyrics-count'),
  generateBtn: byId<HTMLButtonElement>('generate-btn'),
  sampleBtn: byId<HTMLButtonElement>('sample-btn'),
  statusMsg: byId<HTMLSpanElement>('status-msg'),
  previewPanel: byId<HTMLElement>('preview-panel'),
  playBtn: byId<HTMLButtonElement>('play-btn'),
  seek: byId<HTMLInputElement>('seek'),
  currentTime: byId<HTMLSpanElement>('current-time'),
  duration: byId<HTMLSpanElement>('duration'),
  volume: byId<HTMLInputElement>('volume'),
  muteBtn: byId<HTMLButtonElement>('mute-btn'),
  activeLine: byId<HTMLDivElement>('active-line'),
  cueList: byId<HTMLDivElement>('cue-list'),
  cueCount: byId<HTMLSpanElement>('cue-count'),
  exportSrt: byId<HTMLButtonElement>('export-srt'),
  exportVtt: byId<HTMLButtonElement>('export-vtt'),
  exportJson: byId<HTMLButtonElement>('export-json'),
};

init();

function init(): void {
  document.documentElement.dataset.audioLanguage = AUDIO_LANGUAGE.code;
  els.audio.volume = Number(els.volume.value);
  bindEvents();
  updateLyricsCount();
  updateLanguageLabel();
  updateExportsState();
  renderCueList();
  tick();
}

function bindEvents(): void {
  els.audioFile.addEventListener('change', handleAudioFile);
  els.dropzone.addEventListener('dragenter', handleDragEnter);
  els.dropzone.addEventListener('dragover', handleDragOver);
  els.dropzone.addEventListener('dragleave', handleDragLeave);
  els.dropzone.addEventListener('drop', handleDrop);
  els.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.audioFile.click();
    }
  });

  els.languageSelect.addEventListener('change', () => {
    state.language = els.languageSelect.value as LanguageMode;
    updateLanguageLabel();
  });

  els.segmentationSelect.addEventListener('change', () => {
    state.segmentation = els.segmentationSelect.value as SegmentationMode;
  });

  els.lyrics.addEventListener('input', () => {
    state.pendingSampleCaptions = null;
    state.pendingSampleCaptionFormat = null;
    updateLyricsCount();
  });

  els.generateBtn.addEventListener('click', generateCaptions);
  els.sampleBtn.addEventListener('click', loadSample);
  els.playBtn.addEventListener('click', togglePlayback);

  els.volume.addEventListener('input', () => {
    els.audio.volume = Number(els.volume.value);
    els.audio.muted = false;
  });

  els.muteBtn.addEventListener('click', () => {
    els.audio.muted = !els.audio.muted;
    els.muteBtn.textContent = els.audio.muted ? '×' : '♪';
  });

  els.seek.addEventListener('input', () => {
    if (!hasDuration()) return;
    els.audio.currentTime = (Number(els.seek.value) / 1000) * els.audio.duration;
    renderCaption();
  });

  els.audio.addEventListener('loadedmetadata', () => {
    els.duration.textContent = formatClock(els.audio.duration);
    updateGenerateState();
  });

  els.audio.addEventListener('play', () => {
    els.playBtn.textContent = 'Ⅱ';
  });

  els.audio.addEventListener('pause', () => {
    els.playBtn.textContent = '▶';
  });

  els.exportSrt.addEventListener('click', () => exportCurrent('srt'));
  els.exportVtt.addEventListener('click', () => exportCurrent('vtt'));
  els.exportJson.addEventListener('click', () => exportCurrent('json'));

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlayback();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      els.audio.currentTime = Math.max(0, els.audio.currentTime - 2);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      els.audio.currentTime = Math.min(els.audio.duration || Infinity, els.audio.currentTime + 2);
    }
  });
}

function handleAudioFile(): void {
  const file = els.audioFile.files?.[0];
  if (!file) return;
  loadAudioFile(file);
}

function handleDragEnter(event: DragEvent): void {
  event.preventDefault();
  els.dropzone.classList.add('is-dragging');
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function handleDragLeave(event: DragEvent): void {
  if (event.currentTarget === event.target) els.dropzone.classList.remove('is-dragging');
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  els.dropzone.classList.remove('is-dragging');
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  loadAudioFile(file);
}

function loadAudioFile(file: File): void {
  if (file.size > 50 * 1024 * 1024) {
    setStatus('File too large. Max file size: 50MB.', true);
    return;
  }

  state.audioName = stripExtension(file.name);
  state.pendingSampleCaptions = null;
  state.pendingSampleCaptionFormat = null;
  state.cues = [];
  state.activeIndex = -1;
  els.audio.src = URL.createObjectURL(file);
  els.audio.load();
  els.dropTitle.textContent = file.name;
  els.dropSubtitle.textContent = `${formatFileSize(file.size)} · local only`;
  els.previewPanel.classList.add('is-empty');
  updateExportsState();
  renderCueList();
  setStatus(`Audio loaded · ${state.language === 'fr-FR' ? 'French engine hint: fr-FR' : 'Auto detect selected'}`);
  renderCaption();
}

async function loadSample(): Promise<void> {
  try {
    els.sampleBtn.disabled = true;
    els.sampleBtn.textContent = 'Loading...';

    const [lyrics, captions, audioBlob] = await Promise.all([
      fetchSample('./public/samples/vercingetorix.txt'),
      fetchSample('./public/samples/vercingetorix.srt'),
      fetchSampleBlob('./public/samples/vercingetorix.mp3'),
    ]);

    state.audioName = 'figure-46-vercingetorix-v2-paxlab-preview';
    state.pendingSampleCaptions = captions;
    state.pendingSampleCaptionFormat = 'srt';
    state.cues = [];
    state.activeIndex = -1;
    state.language = AUDIO_LANGUAGE.code;
    els.languageSelect.value = AUDIO_LANGUAGE.code;
    els.lyrics.value = lyrics;
    els.audio.src = URL.createObjectURL(audioBlob);
    els.audio.load();
    els.dropTitle.textContent = 'figure-46-vercingetorix-v2-paxlab-preview-1-16bit.mp3';
    els.dropSubtitle.textContent = 'Demo loaded · local sample';
    updateLyricsCount();
    updateLanguageLabel();
    updateExportsState();
    renderCueList();
    els.previewPanel.classList.add('is-empty');
    setStatus('Demo loaded. Click Generate Lyrics to create the preview.');
    renderCaption();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Demo loading failed.', true);
  } finally {
    els.sampleBtn.disabled = false;
    els.sampleBtn.textContent = 'Load Vercingétorix demo';
  }
}

function generateCaptions(): void {
  const lyrics = els.lyrics.value;
  const lines = extractLyricLines(lyrics, state.segmentation);

  if (!els.audio.src) {
    setStatus('Upload an MP3/WAV before generating captions.', true);
    return;
  }

  if (lines.length === 0) {
    setStatus('Paste lyrics before generating captions.', true);
    return;
  }

  if (state.pendingSampleCaptions) {
    state.cues = parseCaptions(state.pendingSampleCaptions, `vercingetorix.${state.pendingSampleCaptionFormat ?? 'srt'}`);
    setStatus(`Reference captions generated · ${state.cues.length} cues · language ${state.language === 'fr-FR' ? 'fr-FR' : 'auto'}.`);
  } else {
    state.cues = buildLightweightCaptions(lines, hasDuration() ? els.audio.duration : 0);
    setStatus(`Prototype captions generated · ${state.cues.length} cues · language ${state.language === 'fr-FR' ? 'fr-FR' : 'auto'}.`);
  }

  state.activeIndex = -1;
  els.previewPanel.classList.remove('is-empty');
  updateExportsState();
  renderCueList();
  renderCaption();
}

function extractLyricLines(raw: string, mode: SegmentationMode): Array<{ text: string; gapBefore: number }> {
  const result: Array<{ text: string; gapBefore: number }> = [];
  let emptyRun = 0;

  for (const original of raw.replace(/\r/g, '').split('\n')) {
    const text = original.trim();
    if (!text) {
      emptyRun += 1;
      continue;
    }

    if (mode === 'phrase') {
      result.push({ text, gapBefore: emptyRun });
    } else {
      result.push({ text, gapBefore: emptyRun });
    }
    emptyRun = 0;
  }

  return result;
}

function buildLightweightCaptions(lines: Array<{ text: string; gapBefore: number }>, duration: number): CaptionCue[] {
  const startPad = duration > 20 ? 2 : 0.5;
  const endPad = duration > 20 ? 4 : 0.5;
  const available = Math.max(lines.length * 1.25, duration > 0 ? duration - startPad - endPad : lines.length * 3);
  const weights = lines.map((line) => estimateLineWeight(line.text));
  const gapUnits = lines.map((line) => Math.min(3, line.gapBefore) * 0.75);
  const totalUnits = weights.reduce((sum, weight) => sum + weight, 0) + gapUnits.reduce((sum, gap) => sum + gap, 0);
  let cursor = startPad;

  return lines.map((line, index) => {
    const gap = totalUnits > 0 ? available * (gapUnits[index] / totalUnits) : 0;
    cursor += gap;
    const slice = totalUnits > 0 ? available * (weights[index] / totalUnits) : 3;
    const start = cursor;
    const end = index === lines.length - 1 ? startPad + available : cursor + slice;
    cursor = end;
    return {
      id: index + 1,
      start: round(start),
      end: round(Math.max(start + 0.9, end)),
      text: line.text,
    };
  });
}

function estimateLineWeight(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.replace(/\s/g, '').length;
  const punctuationPause = /[.!?…]$/.test(text) ? 0.65 : /[,;:]$/.test(text) ? 0.35 : 0;
  return Math.max(1.25, Math.min(6.2, 0.9 + words * 0.42 + Math.pow(chars, 0.58) * 0.28 + punctuationPause));
}

function togglePlayback(): void {
  if (!els.audio.src) return;
  if (els.audio.paused) void els.audio.play();
  else els.audio.pause();
}

function tick(): void {
  renderTransport();
  renderCaption();
  state.rafId = window.requestAnimationFrame(tick);
}

function renderTransport(): void {
  const duration = hasDuration() ? els.audio.duration : 0;
  const current = Number.isFinite(els.audio.currentTime) ? els.audio.currentTime : 0;
  els.currentTime.textContent = formatClock(current);
  els.duration.textContent = formatClock(duration);
  els.seek.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
}

function renderCaption(): void {
  const index = findActiveCue(state.cues, els.audio.currentTime, state.offset);
  if (index !== state.activeIndex) {
    state.activeIndex = index;
    updateCueListActive(index);
  }

  const cue = index >= 0 ? state.cues[index] : null;
  if (!cue) {
    els.activeLine.textContent = state.cues.length ? '...' : 'Generate captions to preview them here.';
    return;
  }

  renderActiveLine(cue);
}

function renderActiveLine(cue: CaptionCue): void {
  const tokens = cue.text.split(/(\s+)/);
  const activeWord = activeWordIndex(cue, els.audio.currentTime, state.highlightMode, state.offset);
  let wordCursor = -1;

  els.activeLine.replaceChildren();

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      els.activeLine.append(document.createTextNode(token));
      continue;
    }
    if (!token) continue;

    const highlightable = isHighlightableToken(token);
    if (highlightable) wordCursor += 1;

    const span = document.createElement('span');
    span.textContent = token;
    span.className = highlightable && wordCursor === activeWord ? 'word active-word' : highlightable ? 'word' : 'word punctuation';
    els.activeLine.append(span);
  }
}

function renderCueList(): void {
  els.cueList.replaceChildren();
  els.cueCount.textContent = `${state.cues.length} cue${state.cues.length > 1 ? 's' : ''} generated`;

  if (!state.cues.length) {
    const empty = document.createElement('div');
    empty.className = 'cue-empty';
    empty.textContent = 'Generate captions to see the timeline here.';
    els.cueList.append(empty);
    return;
  }

  for (const [index, cue] of state.cues.entries()) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cue-row';
    row.dataset.index = String(index);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === state.activeIndex));
    row.title = 'Double-click to jump to this cue';

    const time = document.createElement('span');
    time.className = 'cue-time';
    time.textContent = `${formatClock(cue.start)} - ${formatClock(cue.end)}`;

    const text = document.createElement('span');
    text.className = 'cue-text';
    text.textContent = cue.text.replace(/\n/g, ' / ');

    row.append(time, text);
    row.addEventListener('dblclick', (event) => {
      event.preventDefault();
      seekToCue(index);
      row.blur();
    });

    els.cueList.append(row);
  }

  updateCueListActive(state.activeIndex);
}

function updateCueListActive(index: number): void {
  const rows = els.cueList.querySelectorAll<HTMLButtonElement>('.cue-row');
  rows.forEach((row) => {
    const active = Number(row.dataset.index) === index;
    row.classList.toggle('is-active', active);
    row.setAttribute('aria-selected', String(active));
  });

  if (index >= 0) scrollCueListInsidePanel(index);
}

function scrollCueListInsidePanel(index: number): void {
  const row = els.cueList.querySelector<HTMLElement>(`.cue-row[data-index="${index}"]`);
  if (!row) return;

  const rowTop = row.offsetTop;
  const rowBottom = rowTop + row.offsetHeight;
  const viewTop = els.cueList.scrollTop;
  const viewBottom = viewTop + els.cueList.clientHeight;

  if (rowTop >= viewTop && rowBottom <= viewBottom) return;

  const target = rowTop - els.cueList.clientHeight * 0.42 + row.offsetHeight * 0.5;
  els.cueList.scrollTop = Math.max(0, target);
}

function seekToCue(index: number): void {
  const cue = state.cues[index];
  if (!cue || !els.audio.src) return;

  els.audio.currentTime = Math.max(0, cue.start + state.offset + 0.015);
  renderTransport();
  renderCaption();
  setStatus(`Cue ${index + 1} selected · ${formatClock(cue.start)}.`);
}

function isHighlightableToken(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token);
}

function updateLyricsCount(): void {
  const count = els.lyrics.value.split('\n').filter((line) => line.trim().length > 0).length;
  els.lyricsCount.textContent = `${count} line${count > 1 ? 's' : ''}`;
  updateGenerateState();
}

function updateLanguageLabel(): void {
  els.languageLabel.textContent = state.language === 'fr-FR' ? 'French' : 'Auto detect';
  setStatus(state.language === 'fr-FR' ? 'French engine hint: fr-FR' : 'Auto detect selected. French is recommended for PAX VI songs.');
}

function updateGenerateState(): void {
  const hasLyrics = els.lyrics.value.split('\n').some((line) => line.trim());
  els.generateBtn.disabled = !hasLyrics || !els.audio.src;
}

function updateExportsState(): void {
  const disabled = state.cues.length === 0;
  els.exportSrt.disabled = disabled;
  els.exportVtt.disabled = disabled;
  els.exportJson.disabled = disabled;
}

function exportCurrent(kind: 'srt' | 'vtt' | 'json'): void {
  if (!state.cues.length) return;
  const baseName = `${state.audioName || 'paxlab-subs'}-paxlab`;
  if (kind === 'srt') downloadText(`${baseName}.srt`, exportSrt(state.cues, state.offset), 'application/x-subrip;charset=utf-8');
  if (kind === 'vtt') downloadText(`${baseName}.vtt`, exportVtt(state.cues, state.offset), 'text/vtt;charset=utf-8');
  if (kind === 'json') downloadText(`${baseName}.json`, exportJson(state.cues, state.offset, state.highlightMode), 'application/json;charset=utf-8');
}

function setStatus(message: string, isError = false): void {
  els.statusMsg.textContent = message;
  els.statusMsg.dataset.error = String(isError);
}

function hasDuration(): boolean {
  return Number.isFinite(els.audio.duration) && els.audio.duration > 0;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element introuvable: ${id}`);
  return element as T;
}
