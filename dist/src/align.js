export const MIN_CUE_DURATION = 0.85;
export const CPS_MAX = 17;

export function normalizeWord(text) {
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

export function tokenizeDisplayLine(text) {
  return String(text || '').match(/\S+/g) || [];
}

export function splitCleanLyrics(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function flattenLyrics(lines) {
  const words = [];
  lines.forEach((line, lineIndex) => {
    tokenizeDisplayLine(line).forEach((text, wordIndex) => {
      const norm = normalizeWord(text);
      words.push({ text, norm, lineIndex, wordIndex, start: null, end: null, score: 0, matched: false });
    });
  });
  return words;
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

function ratioSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length <= 2 || b.length <= 2) return 0;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export function matchScore(a, b) {
  if (!a || !b) return -1.15;
  if (a === b) return 2.2;
  const sim = ratioSimilarity(a, b);
  if (sim >= 0.88) return 1.25;
  if (sim >= 0.76 && Math.max(a.length, b.length) >= 5) return 0.45;
  if ((a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 4) return 0.25;
  return -0.85;
}

function averageWordDuration(anchors) {
  const durations = anchors
    .map((word) => Number(word?.end) - Number(word?.start))
    .filter((duration) => Number.isFinite(duration) && duration > 0.06 && duration < 1.2);
  if (!durations.length) return 0.28;
  durations.sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)] || 0.28;
}

function interpolateMissingWords(words, duration) {
  const anchors = words.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
  const avg = averageWordDuration(anchors);
  if (!anchors.length) return words;

  let index = 0;
  while (index < words.length) {
    if (Number.isFinite(words[index].start) && Number.isFinite(words[index].end)) {
      index += 1;
      continue;
    }

    const gapStart = index;
    while (index < words.length && !(Number.isFinite(words[index].start) && Number.isFinite(words[index].end))) index += 1;
    const gapEnd = index - 1;
    const prev = gapStart > 0 ? words[gapStart - 1] : null;
    const next = index < words.length ? words[index] : null;
    const count = gapEnd - gapStart + 1;

    if (prev && next && Number.isFinite(prev.end) && Number.isFinite(next.start) && next.start > prev.end) {
      const available = next.start - prev.end;
      const step = available / (count + 1);
      for (let k = 0; k < count; k += 1) {
        const start = prev.end + step * (k + 0.35);
        const end = Math.min(next.start - 0.02, start + Math.max(0.08, step * 0.55));
        words[gapStart + k] = { ...words[gapStart + k], start, end, score: 0.15 };
      }
    } else if (prev && Number.isFinite(prev.end)) {
      let cursor = prev.end + 0.08;
      for (let k = 0; k < count; k += 1) {
        const start = cursor;
        const end = start + avg;
        words[gapStart + k] = { ...words[gapStart + k], start, end, score: 0.1 };
        cursor = end + 0.05;
      }
    } else if (next && Number.isFinite(next.start)) {
      let cursor = Math.max(0, next.start - (avg + 0.05) * count);
      for (let k = 0; k < count; k += 1) {
        const start = cursor;
        const end = Math.min(next.start - 0.02, start + avg);
        words[gapStart + k] = { ...words[gapStart + k], start, end, score: 0.1 };
        cursor = end + 0.05;
      }
    }
  }

  if (Number.isFinite(duration) && duration > 0) {
    words.forEach((word) => {
      if (Number.isFinite(word.start)) word.start = Math.max(0, Math.min(duration, word.start));
      if (Number.isFinite(word.end)) word.end = Math.max(word.start + 0.05, Math.min(duration, word.end));
    });
  }
  return words;
}

export function alignWordsNW(lyricsWords, asrWords, duration = 0) {
  const lyricIndexed = lyricsWords.map((word, index) => ({ ...word, globalIndex: index }));
  const A = lyricIndexed.filter((word) => word.norm);
  const B = (asrWords || []).filter((word) => word?.norm && Number.isFinite(word.start));
  if (!A.length) return lyricIndexed;
  if (!B.length) return lyricIndexed;

  const m = A.length;
  const n = B.length;
  const GAP = -1;
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  const tb = Array.from({ length: m + 1 }, () => new Int8Array(n + 1));

  for (let i = 1; i <= m; i += 1) { dp[i][0] = i * GAP; tb[i][0] = 1; }
  for (let j = 1; j <= n; j += 1) { dp[0][j] = j * GAP; tb[0][j] = 2; }

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const diag = dp[i - 1][j - 1] + matchScore(A[i - 1].norm, B[j - 1].norm);
      const up = dp[i - 1][j] + GAP;
      const left = dp[i][j - 1] + GAP;
      let best = diag;
      let dir = 0;
      if (up > best) { best = up; dir = 1; }
      if (left > best) { best = left; dir = 2; }
      dp[i][j] = best;
      tb[i][j] = dir;
    }
  }

  const aligned = lyricIndexed.map((word) => ({ ...word }));
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const dir = tb[i]?.[j];
    if (i > 0 && j > 0 && dir === 0) {
      const lyric = A[i - 1];
      const asr = B[j - 1];
      const score = matchScore(lyric.norm, asr.norm);
      if (score >= 0) {
        const target = aligned[lyric.globalIndex];
        target.start = asr.start;
        target.end = Math.max(asr.end, asr.start + 0.05);
        target.score = Math.min(1, Math.max(0.05, score / 2.2));
        target.matched = true;
        target.asrText = asr.text;
      }
      i -= 1;
      j -= 1;
    } else if (i > 0 && (dir === 1 || j === 0)) {
      i -= 1;
    } else if (j > 0) {
      j -= 1;
    } else {
      break;
    }
  }

  return interpolateMissingWords(aligned, duration);
}

function proportionalCueFallback(lines, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Math.max(8, lines.length * 2.2);
  const totalChars = lines.reduce((sum, line) => sum + Math.max(1, line.length), 0) || 1;
  let cursor = Math.min(1, safeDuration * 0.03);
  return lines.map((line, index) => {
    const minDur = Math.max(MIN_CUE_DURATION, line.length / CPS_MAX);
    const weighted = Math.max(minDur, safeDuration * 0.88 * (Math.max(1, line.length) / totalChars));
    const start = cursor;
    const end = index === lines.length - 1 ? Math.min(safeDuration, start + weighted) : Math.min(safeDuration, start + weighted);
    cursor = end + 0.12;
    return { id: index + 1, start, end, text: line, confidence: 0, words: spreadCueWords(line, start, end) };
  });
}

export function spreadCueWords(line, start, end) {
  const tokens = tokenizeDisplayLine(line);
  if (!tokens.length) return [];
  const safeStart = Number.isFinite(start) ? start : 0;
  const safeEnd = Number.isFinite(end) && end > safeStart ? end : safeStart + Math.max(MIN_CUE_DURATION, line.length / CPS_MAX);
  const weights = tokens.map((token) => Math.max(1, normalizeWord(token).length || 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = safeStart;
  return tokens.map((token, index) => {
    const duration = (safeEnd - safeStart) * weights[index] / total;
    const word = {
      text: token,
      norm: normalizeWord(token),
      start: cursor,
      end: index === tokens.length - 1 ? safeEnd : cursor + duration,
    };
    cursor = word.end;
    return word;
  });
}

function retimeCueWords(words, start, end, line) {
  const display = (words || []).filter((word) => word?.text);
  if (!display.length) return spreadCueWords(line, start, end);
  const oldStart = Math.min(...display.map((word) => Number.isFinite(word.start) ? word.start : start));
  const oldEnd = Math.max(...display.map((word) => Number.isFinite(word.end) ? word.end : end));
  const oldDuration = Math.max(0.001, oldEnd - oldStart);
  const newDuration = Math.max(0.001, end - start);
  return display.map((word) => ({
    ...word,
    start: start + (((Number.isFinite(word.start) ? word.start : oldStart) - oldStart) / oldDuration) * newDuration,
    end: start + (((Number.isFinite(word.end) ? word.end : oldEnd) - oldStart) / oldDuration) * newDuration,
  }));
}

function fillMissingCueEntries(entries, lines, duration) {
  const fallback = proportionalCueFallback(lines, duration);
  for (let i = 0; i < entries.length; i += 1) {
    if (Number.isFinite(entries[i].start) && Number.isFinite(entries[i].end)) continue;
    let prev = null;
    let next = null;
    for (let p = i - 1; p >= 0; p -= 1) if (Number.isFinite(entries[p].end)) { prev = p; break; }
    for (let n = i + 1; n < entries.length; n += 1) if (Number.isFinite(entries[n].start)) { next = n; break; }
    if (prev !== null && next !== null && entries[next].start > entries[prev].end) {
      const count = next - prev - 1;
      const gapStart = entries[prev].end + 0.08;
      const gapEnd = entries[next].start - 0.08;
      const slot = Math.max(0.1, (gapEnd - gapStart) / Math.max(1, count));
      for (let k = prev + 1; k < next; k += 1) {
        const local = k - prev - 1;
        entries[k].start = gapStart + slot * local;
        entries[k].end = Math.min(gapEnd, entries[k].start + Math.max(MIN_CUE_DURATION, entries[k].text.length / CPS_MAX));
        entries[k].confidence = 0;
      }
      i = next;
    } else {
      entries[i].start = fallback[i].start;
      entries[i].end = fallback[i].end;
      entries[i].confidence = 0;
    }
  }
}

export function enforceCueOrder(cues, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
  let prevEnd = 0;
  for (const cue of cues) {
    const minDur = Math.max(MIN_CUE_DURATION, String(cue.text || '').length / CPS_MAX);
    cue.start = Number.isFinite(cue.start) ? cue.start : prevEnd + 0.08;
    cue.end = Number.isFinite(cue.end) ? cue.end : cue.start + minDur;
    cue.start = Math.max(0, cue.start);
    if (cue.start < prevEnd + 0.03) cue.start = prevEnd + 0.03;
    if (cue.end < cue.start + minDur) cue.end = cue.start + minDur;
    if (safeDuration && cue.end > safeDuration + 0.5) {
      cue.end = Math.max(cue.start + MIN_CUE_DURATION, safeDuration + 0.5);
    }
    cue.words = retimeCueWords(cue.words, cue.start, cue.end, cue.text);
    prevEnd = cue.end;
  }
  return cues;
}

export function buildCuesFromAlignedLines(lines, alignedWords, duration) {
  if (!lines.length) return [];
  const byLine = lines.map((line, lineIndex) => ({ line, lineIndex, words: [] }));
  for (const word of alignedWords) {
    if (byLine[word.lineIndex]) byLine[word.lineIndex].words.push(word);
  }

  const entries = byLine.map((entry) => {
    const timed = entry.words.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
    if (!timed.length) return { text: entry.line, start: null, end: null, confidence: 0, words: [] };
    const matchedCount = entry.words.filter((word) => word.matched).length;
    const normCount = entry.words.filter((word) => word.norm).length || 1;
    const start = Math.min(...timed.map((word) => word.start));
    const end = Math.max(...timed.map((word) => word.end));
    return {
      text: entry.line,
      start: Math.max(0, start - 0.03),
      end: end + 0.08,
      confidence: matchedCount / normCount,
      words: timed,
    };
  });

  fillMissingCueEntries(entries, lines, duration);
  const cues = entries.map((entry, index) => ({ id: index + 1, ...entry }));
  return enforceCueOrder(cues, duration);
}

export function buildCuesFromLyricsAndAsr(lines, asrWords, duration) {
  const lyricWords = flattenLyrics(lines);
  const aligned = alignWordsNW(lyricWords, asrWords, duration);
  const cues = buildCuesFromAlignedLines(lines, aligned, duration);
  if (!cues.some((cue) => cue.confidence > 0)) return proportionalCueFallback(lines, duration);
  return cues;
}
