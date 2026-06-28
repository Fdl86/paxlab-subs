import assert from 'node:assert/strict';
import {
  aggregateTokenPathToWords,
  buildSyntheticEmissions,
  ctcTrellisAlign,
  logSoftmaxRows,
} from '../src/forced-align.js';
import {
  applyForcedAlignmentToCues,
  buildCuesFromLyricsAndAsr,
  buildForcedAlignSegments,
  normalizeWord,
  phoneticKey,
} from '../src/align.js';

function asr(tokens, start = 0) {
  let cursor = start;
  return tokens.map((text) => {
    const norm = normalizeWord(text);
    const word = { text, norm, phon: phoneticKey(norm), start: cursor, end: cursor + 0.3 };
    cursor += 0.5;
    return word;
  });
}

{
  const frames = 12;
  const vocab = 6;
  const blank = 0;
  const tokenIds = [1, 2, 3];
  const logits = buildSyntheticEmissions(frames, vocab, blank, [
    { frame: 2, id: 1 },
    { frame: 5, id: 2 },
    { frame: 8, id: 3 },
  ]);
  const emissions = logSoftmaxRows(logits, [frames, vocab], [blank, ...tokenIds]);
  const path = ctcTrellisAlign(emissions, tokenIds, blank);
  assert.equal(path.length, 3);
  assert.equal(path[0].frame, 2);
  assert.equal(path[1].frame, 5);
  assert.equal(path[2].frame, 8);
}

{
  const path = [
    { tokenIndex: 0, frame: 2, score: -0.1 },
    { tokenIndex: 1, frame: 3, score: -0.1 },
    { tokenIndex: 2, frame: 7, score: -0.1 },
  ];
  const words = aggregateTokenPathToWords(path, [0, 0, 1], 0.02, 10);
  assert.equal(words.length, 2);
  assert.ok(Math.abs(words[0].start - 10.04) < 0.001);
  assert.ok(Math.abs(words[0].end - 10.08) < 0.001);
  assert.ok(Math.abs(words[1].start - 10.14) < 0.001);
}

{
  const lines = ['Debout dans notre mémoire'];
  const cues = buildCuesFromLyricsAndAsr(lines, asr(['Debout', 'dans', 'notre', 'mémoire'], 1), 20);
  const forced = [
    { lineIndex: 0, wordIndex: 0, start: 2, end: 2.2, score: 0.9 },
    { lineIndex: 0, wordIndex: 1, start: 2.35, end: 2.55, score: 0.9 },
    { lineIndex: 0, wordIndex: 2, start: 2.72, end: 2.9, score: 0.9 },
    { lineIndex: 0, wordIndex: 3, start: 3.05, end: 3.35, score: 0.9 },
  ];
  const aligned = applyForcedAlignmentToCues(cues, forced, 20);
  assert.equal(aligned[0].timingSource, 'forced-ctc');
  assert.ok(aligned[0].start >= 1.9 && aligned[0].start < 2.05);
  assert.ok(aligned[0].end > 3.3);
  assert.equal(aligned.forcedCount, 4);
}

{
  const lines = ['Debout dans notre mémoire'];
  const cues = buildCuesFromLyricsAndAsr(lines, asr(['Debout', 'dans', 'notre', 'mémoire'], 1), 20);
  const segments = buildForcedAlignSegments(lines, cues, 20);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].lineIndex, 0);
  assert.equal(segments[0].words.length, 4);
  assert.ok(segments[0].start < cues[0].start);
}

console.log('forced-align.test.mjs OK');
