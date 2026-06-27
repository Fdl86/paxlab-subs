import { AUDIO_LANGUAGE } from './language.js';
import { formatSrtTime, formatVttTime, parseTimestamp } from './time.js';

export type CaptionFormat = 'srt' | 'vtt';
export type HighlightMode = 'weighted' | 'linear' | 'none';

export interface CaptionCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
  index: number;
}

export function parseCaptions(raw: string, filename = ''): CaptionCue[] {
  const normalized = raw.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const isVtt = filename.toLowerCase().endsWith('.vtt') || normalized.startsWith('WEBVTT');
  return isVtt ? parseVtt(normalized) : parseSrt(normalized);
}

function parseSrt(raw: string): CaptionCue[] {
  const blocks = raw.split(/\n\s*\n/g);
  const cues: CaptionCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join('\n').trim();
    if (!text) continue;

    cues.push({
      id: cues.length + 1,
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      text,
    });
  }

  return normalizeCueOrder(cues);
}

function parseVtt(raw: string): CaptionCue[] {
  const withoutHeader = raw.replace(/^WEBVTT[^\n]*(\n|$)/, '').trim();
  const blocks = withoutHeader.split(/\n\s*\n/g);
  const cues: CaptionCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
    const text = lines.slice(timingIndex + 1).join('\n').trim();
    if (!text) continue;

    cues.push({
      id: cues.length + 1,
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      text,
    });
  }

  return normalizeCueOrder(cues);
}

function normalizeCueOrder(cues: CaptionCue[]): CaptionCue[] {
  return cues
    .filter((cue) => cue.end > cue.start)
    .sort((a, b) => a.start - b.start)
    .map((cue, index) => ({ ...cue, id: index + 1 }));
}

export function findActiveCue(cues: CaptionCue[], time: number, offset = 0): number {
  const adjusted = time - offset;
  let low = 0;
  let high = cues.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cue = cues[mid];
    if (adjusted < cue.start) high = mid - 1;
    else if (adjusted > cue.end) low = mid + 1;
    else return mid;
  }

  return -1;
}

export function estimateWordTimings(cue: CaptionCue, mode: HighlightMode): WordTiming[] {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (mode === 'none') {
    return words.map((word, index) => ({ text: word, start: cue.start, end: cue.end, index }));
  }

  const duration = Math.max(0.1, cue.end - cue.start);
  const weights = words.map((word) => {
    if (mode === 'linear') return 1;
    const clean = word.replace(/[’'.,;:!?…\-]/g, '');
    const lengthWeight = Math.max(1, Math.pow(clean.length || word.length || 1, 0.72));
    const commaPause = /[,;:]$/.test(word) ? 0.35 : 0;
    const endPause = /[.!?…]$/.test(word) ? 0.5 : 0;
    return lengthWeight + commaPause + endPause;
  });

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = cue.start;

  return words.map((word, index) => {
    const slice = duration * (weights[index] / totalWeight);
    const start = cursor;
    const end = index === words.length - 1 ? cue.end : cursor + slice;
    cursor = end;
    return { text: word, start, end, index };
  });
}

export function activeWordIndex(cue: CaptionCue, time: number, mode: HighlightMode, offset = 0): number {
  if (mode === 'none') return -1;
  const timings = estimateWordTimings(cue, mode);
  const adjusted = time - offset;
  const index = timings.findIndex((word) => adjusted >= word.start && adjusted <= word.end);
  return index;
}

export function exportSrt(cues: CaptionCue[], offset = 0): string {
  return cues.map((cue, index) => {
    const start = formatSrtTime(cue.start + offset);
    const end = formatSrtTime(cue.end + offset);
    return `${index + 1}\n${start} --> ${end}\n${cue.text}`;
  }).join('\n\n') + '\n';
}

export function exportVtt(cues: CaptionCue[], offset = 0): string {
  const body = cues.map((cue) => {
    const start = formatVttTime(cue.start + offset);
    const end = formatVttTime(cue.end + offset);
    return `${start} --> ${end}\n${cue.text}`;
  }).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function exportJson(cues: CaptionCue[], offset = 0, highlightMode: HighlightMode = 'weighted'): string {
  const payload = {
    app: 'PAXLAB Lyrics Sync',
    version: '0.0.1-dev0',
    language: AUDIO_LANGUAGE,
    offset,
    cueCount: cues.length,
    cues: cues.map((cue) => ({
      id: cue.id,
      start: round(cue.start + offset),
      end: round(cue.end + offset),
      text: cue.text,
      words: estimateWordTimings(cue, highlightMode).map((word) => ({
        text: word.text,
        start: round(word.start + offset),
        end: round(word.end + offset),
        index: word.index,
      })),
    })),
  };

  return JSON.stringify(payload, null, 2);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
