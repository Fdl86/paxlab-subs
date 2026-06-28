export function logSoftmaxRows(logits, dims, tokenIds) {
  if (!logits || !dims || dims.length < 2) throw new Error('Logits CTC invalides.');
  const frames = dims[dims.length - 2];
  const vocab = dims[dims.length - 1];
  const wanted = Array.from(new Set(tokenIds)).filter((id) => Number.isInteger(id) && id >= 0 && id < vocab);
  const out = Array.from({ length: frames }, () => new Map());
  for (let t = 0; t < frames; t += 1) {
    const offset = t * vocab;
    let max = -Infinity;
    for (let v = 0; v < vocab; v += 1) {
      const value = logits[offset + v];
      if (value > max) max = value;
    }
    let sum = 0;
    for (let v = 0; v < vocab; v += 1) sum += Math.exp(logits[offset + v] - max);
    const logDen = max + Math.log(sum || 1);
    for (const id of wanted) out[t].set(id, logits[offset + id] - logDen);
  }
  return out;
}

export function ctcTrellisAlign(emissions, tokenIds, blankId = 0) {
  const T = emissions?.length || 0;
  const L = tokenIds?.length || 0;
  if (!T || !L) return [];
  const cols = L + 1;
  const NEG = -1e20;
  const trellis = new Float32Array((T + 1) * cols);
  const back = new Uint8Array((T + 1) * cols);
  trellis.fill(NEG);
  trellis[0] = 0;
  for (let t = 1; t <= T; t += 1) {
    const blankScore = emissions[t - 1].get(blankId) ?? -30;
    trellis[t * cols] = trellis[(t - 1) * cols] + blankScore;
  }
  for (let t = 1; t <= T; t += 1) {
    const blankScore = emissions[t - 1].get(blankId) ?? -30;
    for (let j = 1; j <= L; j += 1) {
      const tokenScore = emissions[t - 1].get(tokenIds[j - 1]) ?? -30;
      const stay = trellis[(t - 1) * cols + j] + blankScore;
      const change = trellis[(t - 1) * cols + j - 1] + tokenScore;
      if (change > stay) {
        trellis[t * cols + j] = change;
        back[t * cols + j] = 1;
      } else {
        trellis[t * cols + j] = stay;
        back[t * cols + j] = 0;
      }
    }
  }

  let bestT = L;
  let best = NEG;
  for (let t = Math.max(1, L); t <= T; t += 1) {
    const score = trellis[t * cols + L];
    if (score > best) { best = score; bestT = t; }
  }

  const path = Array(L).fill(null);
  let t = bestT;
  let j = L;
  while (t > 0 && j > 0) {
    const dir = back[t * cols + j];
    if (dir === 1) {
      path[j - 1] = { tokenIndex: j - 1, frame: t - 1, score: emissions[t - 1].get(tokenIds[j - 1]) ?? -30 };
      j -= 1;
      t -= 1;
    } else {
      t -= 1;
    }
  }
  return path;
}

export function aggregateTokenPathToWords(path, tokenToWord, frameSeconds, segmentStart = 0) {
  const byWord = new Map();
  for (let i = 0; i < path.length; i += 1) {
    const hit = path[i];
    const wordIndex = tokenToWord[i];
    if (!hit || !Number.isInteger(wordIndex)) continue;
    const entry = byWord.get(wordIndex) || { wordIndex, startFrame: hit.frame, endFrame: hit.frame, scoreSum: 0, count: 0 };
    entry.startFrame = Math.min(entry.startFrame, hit.frame);
    entry.endFrame = Math.max(entry.endFrame, hit.frame);
    entry.scoreSum += Number.isFinite(hit.score) ? hit.score : -10;
    entry.count += 1;
    byWord.set(wordIndex, entry);
  }
  return [...byWord.values()].map((entry) => ({
    wordIndex: entry.wordIndex,
    start: segmentStart + entry.startFrame * frameSeconds,
    end: segmentStart + (entry.endFrame + 1) * frameSeconds,
    score: Math.max(0, Math.min(1, 1 + (entry.scoreSum / Math.max(1, entry.count)) / 12)),
  })).sort((a, b) => a.wordIndex - b.wordIndex);
}

export function buildSyntheticEmissions(frames, vocabSize, blankId, peaks) {
  const logits = new Float32Array(frames * vocabSize).fill(-8);
  for (let t = 0; t < frames; t += 1) logits[t * vocabSize + blankId] = 2;
  for (const peak of peaks) {
    logits[peak.frame * vocabSize + peak.id] = 8;
    logits[peak.frame * vocabSize + blankId] = -6;
  }
  return logits;
}
