export const MIN_CUE_DURATION = 0.85;
export const CPS_MAX = 17;

export function maxCueDurationForText(text) {
  const line = String(text || '');
  const words = tokenizeDisplayLine(line).length;
  const chars = line.length;
  if (words <= 2) return 4.8;
  return Math.min(7.2, Math.max(1.8, chars / 13 + 0.75, words * 0.55 + 0.85));
}

function isShortCueText(text) {
  return tokenizeDisplayLine(text).length <= 3 || String(text || '').length <= 18;
}

function cloneCue(cue) {
  return { ...cue, words: Array.isArray(cue.words) ? cue.words.map((word) => ({ ...word })) : [] };
}

export function conservativeGapRepair(cues, duration) {
  if (!Array.isArray(cues) || cues.length < 3) return cues;
  const next = cues.map(cloneCue);
  let repaired = 0;
  for (let i = 1; i < next.length - 1; i += 1) {
    const prev = next[i - 1];
    const cue = next[i];
    const following = next[i + 1];
    if (!prev || !cue || !following) continue;
    const cueDur = cue.end - cue.start;
    const followingDur = following.end - following.start;
    const gapBefore = cue.start - prev.end;
    const gapAfter = following.start - cue.end;
    const cueWords = tokenizeDisplayLine(cue.text).length;
    const followingWords = tokenizeDisplayLine(following.text).length;

    // Cas typique detecte sur Rocroi : ligne longue placee juste apres un cri court,
    // puis trou enorme avant la ligne suivante deja proche de la vraie reprise vocale.
    // On ne touche qu'a ce pattern tres restrictif pour eviter les derives globales.
    const isolatedEarlyLine =
      gapBefore >= -0.05 && gapBefore < 1.75 &&
      gapAfter > 8 &&
      cueWords >= 5 &&
      followingWords >= 5 &&
      isShortCueText(prev.text) &&
      followingDur > 3.2 &&
      cueDur < 6.0;

    if (!isolatedEarlyLine) continue;
    const cueMax = maxCueDurationForText(cue.text);
    const cueTargetDur = Math.min(cueMax, Math.max(cueDur, Math.max(1.55, String(cue.text || '').length / 18)));
    const followingMin = Math.max(MIN_CUE_DURATION, String(following.text || '').length / CPS_MAX);
    const gap = 0.15;
    const blockStart = Math.max(prev.end + 0.12, following.start + 0.12);
    const proposedCueEnd = blockStart + cueTargetDur;
    const proposedFollowingStart = proposedCueEnd + gap;

    if (proposedFollowingStart + followingMin <= following.end + 0.15) {
      cue.start = blockStart;
      cue.end = proposedCueEnd;
      cue.repairSource = 'conservative-gap';
      cue.words = retimeCueWords(cue.words, cue.start, cue.end, cue.text);
      following.start = Math.max(following.start, proposedFollowingStart);
      following.repairSource = following.repairSource || 'conservative-gap-neighbor';
      following.words = retimeCueWords(following.words, following.start, following.end, following.text);
      repaired += 1;
    }
  }
  const ordered = enforceCueOrder(next, duration);
  ordered.gapRepairCount = repaired;
  return ordered;
}


const STRUCTURE_MARKERS = /\((?:intro|outro|verse|couplet|chorus|refrain|bridge|pont|hook|pre[-\s]?chorus|pré[-\s]?refrain|pre[-\s]?refrain|break|solo|instrumental)\)/gi;
const STRUCTURE_LINE = /^(?:intro|outro|verse|couplet|chorus|refrain|bridge|pont|hook|pre[-\s]?chorus|pré[-\s]?refrain|pre[-\s]?refrain|break|solo|instrumental)(?:\s*\d+)?$/i;
const ELISION_PREFIXES = new Set(['l', 'd', 'j', 'm', 't', 's', 'n', 'c', 'qu', 'lorsqu', 'jusqu', 'puisqu', 'quoiqu']);

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

export function phoneticKey(norm) {
  if (!norm) return '';
  let s = String(norm || '')
    .replace(/'/g, '')
    .replace(/ph/g, 'f')
    .replace(/ch/g, 'sh')
    .replace(/gu(?=[ei])/g, 'g')
    .replace(/qu/g, 'k')
    .replace(/q/g, 'k')
    .replace(/(^|[^s])c(?=[eiy])/g, '$1s')
    .replace(/ç/g, 's')
    .replace(/c/g, 'k')
    .replace(/[èéêë]/g, 'e')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
  // Terminaisons muettes fréquentes FR, mais conservatrices pour éviter les faux positifs.
  s = s.replace(/(ent|es)$/g, '');
  s = s.replace(/[zxdp]$/g, '');
  if (s.length >= 4) s = s.replace(/e$/g, '');
  s = s.replace(/[aeiouy]+/g, 'a');
  return s;
}

export function tokenizeDisplayLine(text) {
  return String(text || '').match(/\S+/g) || [];
}

function stripStructureMarkers(line) {
  const withoutBrackets = String(line || '').replace(/\[[^\]]+\]/g, ' ');
  const withoutParens = withoutBrackets.replace(STRUCTURE_MARKERS, ' ');
  const cleaned = withoutParens.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (STRUCTURE_LINE.test(cleaned)) return '';
  return cleaned;
}

export function splitCleanLyrics(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => stripStructureMarkers(line))
    .filter(Boolean);
}

function alignmentTokensFromDisplayToken(text, lineIndex, wordIndex) {
  const norm = normalizeWord(text);
  if (!norm) return [{ text, norm, phon: '', lineIndex, wordIndex, start: null, end: null, score: 0, matched: false, displayText: text }];
  const apostrophe = norm.match(/^([a-z]{1,7})'([a-z0-9]+)$/i);
  if (apostrophe && ELISION_PREFIXES.has(apostrophe[1])) {
    const left = apostrophe[1];
    const right = apostrophe[2];
    return [left, right].filter(Boolean).map((part, subIndex) => ({
      text: part,
      norm: part,
      phon: phoneticKey(part),
      lineIndex,
      wordIndex,
      subIndex,
      start: null,
      end: null,
      score: 0,
      matched: false,
      displayText: text,
    }));
  }
  return [{ text, norm, phon: phoneticKey(norm), lineIndex, wordIndex, start: null, end: null, score: 0, matched: false, displayText: text }];
}

export function flattenLyrics(lines) {
  const words = [];
  lines.forEach((line, lineIndex) => {
    tokenizeDisplayLine(line).forEach((text, wordIndex) => {
      words.push(...alignmentTokensFromDisplayToken(text, lineIndex, wordIndex));
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

export function ratioSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length <= 2 || b.length <= 2) return 0;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function pairScore(aNorm, aPhon, bNorm, bPhon) {
  if (!aNorm || !bNorm) return -1.15;
  if (aNorm === bNorm) return 2.2;
  const sim = ratioSimilarity(aNorm, bNorm);
  if (sim >= 0.88) return 1.25;
  if (aPhon && aPhon === bPhon && Math.min(aNorm.length, bNorm.length) >= 3) return 1.4;
  if (sim >= 0.76 && Math.max(aNorm.length, bNorm.length) >= 5) return 0.45;
  if ((aNorm.startsWith(bNorm) || bNorm.startsWith(aNorm)) && Math.min(aNorm.length, bNorm.length) >= 4) return 0.25;
  return -0.85;
}

export function matchScore(a, b) {
  return pairScore(a, phoneticKey(a), b, phoneticKey(b));
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
  const lyricIndexed = lyricsWords.map((word, index) => ({ ...word, phon: word.phon ?? phoneticKey(word.norm), globalIndex: index }));
  const A = lyricIndexed.filter((word) => word.norm);
  const B = (asrWords || [])
    .filter((word) => word?.norm && Number.isFinite(word.start))
    .map((word) => ({ ...word, phon: word.phon ?? phoneticKey(word.norm) }));
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
    const a = A[i - 1];
    for (let j = 1; j <= n; j += 1) {
      const b = B[j - 1];
      const diag = dp[i - 1][j - 1] + pairScore(a.norm, a.phon, b.norm, b.phon);
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
      const score = pairScore(lyric.norm, lyric.phon, asr.norm, asr.phon);
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
    const end = Math.min(safeDuration + 0.5, start + weighted);
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
      phon: phoneticKey(normalizeWord(token)),
      start: cursor,
      end: index === tokens.length - 1 ? safeEnd : cursor + duration,
    };
    cursor = word.end;
    return word;
  });
}

function retimeCueWords(words, start, end, line) {
  const displayTokens = tokenizeDisplayLine(line);
  const display = (words || []).filter((word) => word?.text);
  const wordTextMatchesDisplay = display.length === displayTokens.length && display.every((word, index) => word.displayText ? word.displayText === displayTokens[index] : word.text === displayTokens[index]);
  if (!display.length || !wordTextMatchesDisplay) return spreadCueWords(line, start, end);
  if (display.some((word) => word.forced)) {
    return display.map((word) => ({ ...word, text: word.displayText || word.text }));
  }
  const oldStart = Math.min(...display.map((word) => Number.isFinite(word.start) ? word.start : start));
  const oldEnd = Math.max(...display.map((word) => Number.isFinite(word.end) ? word.end : end));
  const oldDuration = Math.max(0.001, oldEnd - oldStart);
  const newDuration = Math.max(0.001, end - start);
  return display.map((word) => ({
    ...word,
    text: word.displayText || word.text,
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


export function buildForcedAlignSegments(lines, cues, duration, padding = 0.45) {
  if (!Array.isArray(lines) || !Array.isArray(cues)) return [];
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Math.max(...cues.map((cue) => cue?.end || 0), 0);
  return cues.map((cue, lineIndex) => {
    const text = String(lines[lineIndex] || cue?.text || '').trim();
    const displayWords = tokenizeDisplayLine(text).map((wordText, wordIndex) => ({
      text: wordText,
      norm: normalizeWord(wordText),
      phon: phoneticKey(normalizeWord(wordText)),
      lineIndex,
      wordIndex,
    })).filter((word) => word.norm);
    const cueStart = Number.isFinite(cue?.start) ? cue.start : 0;
    const cueEnd = Number.isFinite(cue?.end) ? cue.end : cueStart + Math.max(MIN_CUE_DURATION, text.length / CPS_MAX);
    return {
      lineIndex,
      text,
      words: displayWords,
      start: Math.max(0, cueStart - padding),
      end: Math.min(safeDuration || cueEnd + padding, cueEnd + padding),
    };
  }).filter((segment) => segment.text && segment.words.length && segment.end > segment.start + 0.25);
}

export function applyForcedAlignmentToCues(cues, forcedWords, duration) {
  if (!Array.isArray(cues) || !cues.length) return cues;
  if (!Array.isArray(forcedWords) || !forcedWords.length) {
    cues.forcedCount = 0;
    cues.forcedCueCount = 0;
    cues.changedCueCount = 0;
    cues.avgShiftMs = 0;
    return cues;
  }
  const forcedMap = new Map();
  for (const word of forcedWords) {
    if (!Number.isInteger(word?.lineIndex) || !Number.isInteger(word?.wordIndex)) continue;
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) continue;
    const key = `${word.lineIndex}:${word.wordIndex}`;
    const current = forcedMap.get(key);
    if (!current || (word.score || 0) > (current.score || 0)) {
      forcedMap.set(key, word);
    }
  }
  if (!forcedMap.size) {
    cues.forcedCount = 0;
    cues.forcedCueCount = 0;
    cues.changedCueCount = 0;
    cues.avgShiftMs = 0;
    return cues;
  }

  let substituted = 0;
  let forcedCueCount = 0;
  let changedCueCount = 0;
  let shiftSumMs = 0;
  let shiftMeasures = 0;
  const next = cues.map((cue, lineIndex) => {
    const beforeStart = cue.start;
    const beforeEnd = cue.end;
    const displayTokens = tokenizeDisplayLine(cue.text);
    const baseWords = spreadCueWords(cue.text, cue.start, cue.end).map((word, wordIndex) => {
      const forced = forcedMap.get(`${lineIndex}:${wordIndex}`);
      if (!forced) return { ...word, lineIndex, wordIndex, forced: false, timingSource: 'asr' };
      substituted += 1;
      return {
        ...word,
        lineIndex,
        wordIndex,
        start: forced.start,
        end: Math.max(forced.end, forced.start + 0.05),
        score: forced.score ?? 0.75,
        matched: true,
        forced: true,
        timingSource: 'forced-ctc',
      };
    });
    const forcedTimed = baseWords.filter((word) => word.forced && Number.isFinite(word.start) && Number.isFinite(word.end));
    if (!forcedTimed.length) return { ...cue, timingSource: cue.timingSource || 'asr', words: cue.words?.length ? cue.words : baseWords };

    forcedCueCount += 1;
    const timedWords = interpolateMissingWords(baseWords.map((word) => ({ ...word })), duration);
    const allTimed = timedWords.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end));
    const first = Math.min(...allTimed.map((word) => word.start));
    const last = Math.max(...allTimed.map((word) => word.end));
    const nextStart = Math.max(0, first - 0.04);
    const nextEnd = last + 0.1;
    const forcedRatio = forcedTimed.length / Math.max(1, displayTokens.length);
    const nextDuration = nextEnd - nextStart;
    const maxDuration = maxCueDurationForText(cue.text);
    const largeShift = Math.max(Math.abs(nextStart - beforeStart), Math.abs(nextEnd - beforeEnd));
    const veryShortAmbiguous = isShortCueText(cue.text) && forcedRatio < 1;

    // Le CTC est un raffineur, pas une autorisation a etirer une ligne sur un trou instrumental.
    // Si le resultat est trop long, trop deplace, ou base sur une ligne courte ambigue, on garde l'ASR.
    if (nextDuration > maxDuration || (largeShift > 3.0 && forcedRatio < 0.9) || veryShortAmbiguous) {
      return {
        ...cue,
        timingSource: cue.timingSource || 'asr',
        ctcRejected: true,
        ctcRejectReason: nextDuration > maxDuration ? 'duration-cap' : (veryShortAmbiguous ? 'short-ambiguous' : 'large-shift'),
        words: cue.words?.length ? cue.words : baseWords,
      };
    }

    const shiftMs = (Math.abs(nextStart - beforeStart) + Math.abs(nextEnd - beforeEnd)) * 500;
    shiftSumMs += shiftMs;
    shiftMeasures += 1;
    if (Math.abs(nextStart - beforeStart) > 0.015 || Math.abs(nextEnd - beforeEnd) > 0.015) changedCueCount += 1;
    return {
      ...cue,
      start: nextStart,
      end: nextEnd,
      confidence: Math.max(cue.confidence || 0, Math.min(1, 0.55 + forcedRatio * 0.45)),
      timingSource: 'forced-ctc',
      forcedWords: forcedTimed.length,
      timingShiftMs: shiftMs,
      words: timedWords,
    };
  });
  const ordered = enforceCueOrder(next, duration);
  ordered.forcedCount = substituted;
  ordered.forcedCueCount = forcedCueCount;
  ordered.changedCueCount = changedCueCount;
  ordered.avgShiftMs = shiftMeasures ? shiftSumMs / shiftMeasures : 0;
  return ordered;
}

export function buildCuesFromLyricsAndAsr(lines, asrWords, duration) {
  const lyricWords = flattenLyrics(lines);
  const aligned = alignWordsNW(lyricWords, asrWords, duration);
  const cues = buildCuesFromAlignedLines(lines, aligned, duration);
  if (!cues.some((cue) => cue.confidence > 0)) return proportionalCueFallback(lines, duration);
  return conservativeGapRepair(cues, duration);
}
