import assert from 'node:assert/strict';
import { buildCuesFromLyricsAndAsr, flattenLyrics, alignWordsNW, splitCleanLyrics, normalizeWord } from '../src/align.js';

function asr(tokens, start = 0) {
  let cursor = start;
  return tokens.map((text) => {
    const word = { text, norm: normalizeWord(text), start: cursor, end: cursor + 0.28 };
    cursor += 0.36;
    return word;
  });
}

function alignedTexts(lines, words) {
  return alignWordsNW(flattenLyrics(lines), words, 120).filter((w) => w.matched).map((w) => w.text);
}

{
  const lines = ['Hello from the other side'];
  const cues = buildCuesFromLyricsAndAsr(lines, asr(['Hello', 'from', 'the', 'other', 'side']), 20);
  assert.equal(cues.length, 1);
  assert.ok(cues[0].start < 0.1);
  assert.ok(cues[0].end > 1.3);
  assert.equal(cues[0].text, lines[0]);
}

{
  const lines = ['Hello world again'];
  const words = asr(['Hello', 'word', 'again']);
  const matched = alignedTexts(lines, words);
  assert.deepEqual(matched, ['Hello', 'world', 'again']);
}

{
  const lines = ['Debout dans notre mémoire'];
  const words = asr(['Debout', 'oh', 'dans', 'notre', 'mémoire']);
  const cues = buildCuesFromLyricsAndAsr(lines, words, 20);
  assert.ok(cues[0].confidence >= 0.75);
  assert.equal(cues[0].text, lines[0]);
}

{
  const lines = ['Gloire à toi', 'Gloire à toi'];
  const words = asr(['Gloire', 'à', 'toi', 'silence', 'Gloire', 'à', 'toi']);
  const cues = buildCuesFromLyricsAndAsr(lines, words, 20);
  assert.equal(cues.length, 2);
  assert.ok(cues[1].start > cues[0].end, 'second repeated refrain must align later');
}

{
  const lines = ['Le roi marche dans la nuit'];
  const words = asr(['Le', 'roi', 'nuit']);
  const cues = buildCuesFromLyricsAndAsr(lines, words, 20);
  assert.ok(cues[0].words.every((w, i, arr) => i === 0 || w.start >= arr[i - 1].start), 'word timings are monotone');
  assert.ok(cues[0].end > cues[0].start);
}

{
  const lines = splitCleanLyrics('Alpha beta\nGamma delta');
  const cues = buildCuesFromLyricsAndAsr(lines, [], 10);
  assert.equal(cues.length, 2);
  assert.ok(cues[1].start > cues[0].start);
}

console.log('align.test.mjs OK');
