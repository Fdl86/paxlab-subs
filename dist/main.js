import { activeWordIndex, exportJson, exportSrt, exportVtt, findActiveCue, parseCaptions } from './core/captions.js';
import { downloadText, fetchSample, fetchSampleBlob, readTextFile } from './core/files.js';
import { AUDIO_LANGUAGE } from './core/language.js';
import { formatClock } from './core/time.js';
const state = {
    cues: [],
    audioName: 'paxlab-audio',
    captionsName: 'captions',
    lyricsName: 'lyrics',
    activeIndex: -1,
    offset: 0,
    highlightMode: 'weighted',
    rafId: null,
};
const els = {
    audio: byId('audio'),
    audioFile: byId('audio-file'),
    captionFile: byId('caption-file'),
    lyricsFile: byId('lyrics-file'),
    lyrics: byId('lyrics'),
    lyricsCount: byId('lyrics-count'),
    captionCount: byId('caption-count'),
    playBtn: byId('play-btn'),
    seek: byId('seek'),
    currentTime: byId('current-time'),
    duration: byId('duration'),
    volume: byId('volume'),
    prevLine: byId('prev-line'),
    activeLine: byId('active-line'),
    nextLine: byId('next-line'),
    timeline: byId('timeline'),
    activeCue: byId('active-cue'),
    sampleBtn: byId('sample-btn'),
    offset: byId('offset'),
    offsetMinus: byId('offset-minus'),
    offsetPlus: byId('offset-plus'),
    highlightMode: byId('highlight-mode'),
    exportSrt: byId('export-srt'),
    exportVtt: byId('export-vtt'),
    exportJson: byId('export-json'),
};
init();
function init() {
    document.documentElement.dataset.audioLanguage = AUDIO_LANGUAGE.code;
    els.audio.volume = Number(els.volume.value);
    bindEvents();
    updateLyricsCount();
    renderTimeline();
    renderCaptions();
    tick();
}
function bindEvents() {
    els.audioFile.addEventListener('change', handleAudioFile);
    els.captionFile.addEventListener('change', handleCaptionFile);
    els.lyricsFile.addEventListener('change', handleLyricsFile);
    els.lyrics.addEventListener('input', updateLyricsCount);
    els.playBtn.addEventListener('click', togglePlayback);
    els.volume.addEventListener('input', () => {
        els.audio.volume = Number(els.volume.value);
    });
    els.seek.addEventListener('input', () => {
        if (!Number.isFinite(els.audio.duration) || els.audio.duration <= 0)
            return;
        els.audio.currentTime = (Number(els.seek.value) / 1000) * els.audio.duration;
        renderCaptions();
    });
    els.audio.addEventListener('loadedmetadata', () => {
        els.duration.textContent = formatClock(els.audio.duration);
        renderCaptions();
    });
    els.audio.addEventListener('play', () => {
        els.playBtn.textContent = 'Ⅱ';
    });
    els.audio.addEventListener('pause', () => {
        els.playBtn.textContent = '▶';
    });
    els.sampleBtn.addEventListener('click', loadSample);
    els.offset.addEventListener('input', () => {
        state.offset = sanitizeOffset(els.offset.value);
        renderTimeline();
        renderCaptions();
    });
    els.offsetMinus.addEventListener('click', () => nudgeOffset(-0.1));
    els.offsetPlus.addEventListener('click', () => nudgeOffset(0.1));
    els.highlightMode.addEventListener('change', () => {
        state.highlightMode = els.highlightMode.value;
        renderCaptions();
    });
    els.exportSrt.addEventListener('click', () => exportCurrent('srt'));
    els.exportVtt.addEventListener('click', () => exportCurrent('vtt'));
    els.exportJson.addEventListener('click', () => exportCurrent('json'));
    window.addEventListener('keydown', (event) => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
            return;
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
async function handleAudioFile() {
    const file = els.audioFile.files?.[0];
    if (!file)
        return;
    state.audioName = stripExtension(file.name);
    const url = URL.createObjectURL(file);
    els.audio.src = url;
    els.audio.load();
}
async function handleCaptionFile() {
    const file = els.captionFile.files?.[0];
    if (!file)
        return;
    state.captionsName = stripExtension(file.name);
    const raw = await readTextFile(file);
    state.cues = parseCaptions(raw, file.name);
    state.activeIndex = -1;
    renderTimeline();
    renderCaptions();
}
async function handleLyricsFile() {
    const file = els.lyricsFile.files?.[0];
    if (!file)
        return;
    state.lyricsName = stripExtension(file.name);
    els.lyrics.value = await readTextFile(file);
    updateLyricsCount();
}
async function loadSample() {
    try {
        els.sampleBtn.disabled = true;
        els.sampleBtn.textContent = 'Chargement...';
        const [lyrics, captions, audioBlob] = await Promise.all([
            fetchSample('./public/samples/vercingetorix.txt'),
            fetchSample('./public/samples/vercingetorix.vtt'),
            fetchSampleBlob('./public/samples/vercingetorix.mp3'),
        ]);
        els.lyrics.value = lyrics;
        state.cues = parseCaptions(captions, 'vercingetorix.vtt');
        state.audioName = 'vercingetorix';
        state.captionsName = 'vercingetorix';
        state.lyricsName = 'vercingetorix';
        els.audio.src = URL.createObjectURL(audioBlob);
        els.audio.load();
        updateLyricsCount();
        renderTimeline();
        renderCaptions();
    }
    catch (error) {
        alert(error instanceof Error ? error.message : 'Erreur pendant le chargement de l’exemple. Lance le projet via un petit serveur local.');
    }
    finally {
        els.sampleBtn.disabled = false;
        els.sampleBtn.textContent = 'Charger l’exemple Vercingétorix';
    }
}
function togglePlayback() {
    if (!els.audio.src)
        return;
    if (els.audio.paused)
        void els.audio.play();
    else
        els.audio.pause();
}
function tick() {
    renderTransport();
    renderCaptions();
    state.rafId = window.requestAnimationFrame(tick);
}
function renderTransport() {
    const duration = Number.isFinite(els.audio.duration) ? els.audio.duration : 0;
    const current = Number.isFinite(els.audio.currentTime) ? els.audio.currentTime : 0;
    els.currentTime.textContent = formatClock(current);
    els.duration.textContent = formatClock(duration);
    els.seek.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
}
function renderCaptions() {
    const index = findActiveCue(state.cues, els.audio.currentTime, state.offset);
    if (index !== state.activeIndex) {
        state.activeIndex = index;
        updateTimelineSelection();
    }
    const cue = index >= 0 ? state.cues[index] : null;
    const previous = index > 0 ? state.cues[index - 1] : null;
    const next = index >= 0 && index < state.cues.length - 1 ? state.cues[index + 1] : null;
    els.prevLine.textContent = previous?.text ?? '';
    els.nextLine.textContent = next?.text ?? '';
    els.activeCue.textContent = cue ? `#${cue.id}` : '--';
    if (!cue) {
        els.activeLine.textContent = state.cues.length ? '...' : 'Charge un audio et un SRT/VTT';
        return;
    }
    renderActiveLine(cue);
}
function renderActiveLine(cue) {
    const words = cue.text.split(/(\s+)/);
    const compactWords = cue.text.split(/\s+/).filter(Boolean);
    const activeWord = activeWordIndex(cue, els.audio.currentTime, state.highlightMode, state.offset);
    let wordCursor = -1;
    els.activeLine.replaceChildren();
    for (const token of words) {
        if (/^\s+$/.test(token)) {
            els.activeLine.append(document.createTextNode(token));
            continue;
        }
        if (!token)
            continue;
        wordCursor += 1;
        const span = document.createElement('span');
        span.textContent = token;
        span.className = wordCursor === activeWord && state.highlightMode !== 'none' ? 'word active-word' : 'word';
        span.dataset.wordIndex = String(wordCursor);
        span.dataset.totalWords = String(compactWords.length);
        els.activeLine.append(span);
    }
}
function renderTimeline() {
    els.captionCount.textContent = `${state.cues.length} cue${state.cues.length > 1 ? 's' : ''}`;
    els.timeline.replaceChildren();
    if (state.cues.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'timeline-empty';
        empty.textContent = 'Aucune cue importée.';
        els.timeline.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    for (const cue of state.cues) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'timeline-row';
        row.dataset.index = String(cue.id - 1);
        row.innerHTML = `<span class="timeline-time">${formatClock(cue.start + state.offset)} - ${formatClock(cue.end + state.offset)}</span><span class="timeline-text"></span>`;
        row.querySelector('.timeline-text').textContent = cue.text;
        row.addEventListener('click', () => {
            els.audio.currentTime = Math.max(0, cue.start + state.offset);
            renderCaptions();
        });
        fragment.append(row);
    }
    els.timeline.append(fragment);
    updateTimelineSelection();
}
function updateTimelineSelection() {
    const rows = els.timeline.querySelectorAll('.timeline-row');
    rows.forEach((row) => {
        row.classList.toggle('is-active', Number(row.dataset.index) === state.activeIndex);
    });
    const active = els.timeline.querySelector('.timeline-row.is-active');
    if (active)
        active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function updateLyricsCount() {
    const count = els.lyrics.value.split('\n').filter((line) => line.trim().length > 0).length;
    els.lyricsCount.textContent = `${count} ligne${count > 1 ? 's' : ''}`;
}
function nudgeOffset(delta) {
    const next = Math.round((state.offset + delta) * 10) / 10;
    state.offset = next;
    els.offset.value = String(next);
    renderTimeline();
    renderCaptions();
}
function sanitizeOffset(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return 0;
    return Math.max(-60, Math.min(60, parsed));
}
function exportCurrent(kind) {
    if (!state.cues.length)
        return;
    const baseName = `${state.audioName || state.captionsName || 'paxlab-lyrics-sync'}-paxlab`;
    if (kind === 'srt') {
        downloadText(`${baseName}.srt`, exportSrt(state.cues, state.offset), 'application/x-subrip;charset=utf-8');
    }
    if (kind === 'vtt') {
        downloadText(`${baseName}.vtt`, exportVtt(state.cues, state.offset), 'text/vtt;charset=utf-8');
    }
    if (kind === 'json') {
        downloadText(`${baseName}.json`, exportJson(state.cues, state.offset, state.highlightMode), 'application/json;charset=utf-8');
    }
}
function stripExtension(filename) {
    return filename.replace(/\.[^.]+$/, '');
}
function byId(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error(`Element introuvable: ${id}`);
    return element;
}
