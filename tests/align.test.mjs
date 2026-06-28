import assert from 'node:assert/strict';
import {
  alignWordsNW,
  analyzeCueQuality,
  attachCueQuality,
  buildCuesFromLyricsAndAsr,
  conservativeGapRepair,
  flattenLyrics,
  matchScore,
  normalizeWord,
  phoneticKey,
  splitCleanLyrics,
} from '../src/align.js';

function asr(tokens, start = 0) {
  let cursor = start;
  return tokens.map((text) => {
    const norm = normalizeWord(text);
    const word = { text, norm, phon: phoneticKey(norm), start: cursor, end: cursor + 0.28 };
    cursor += 0.36;
    return word;
  });
}

function alignedTexts(lines, words) {
  return alignWordsNW(flattenLyrics(lines), words, 120).filter((w) => w.matched).map((w) => w.displayText || w.text);
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

{
  assert.ok(matchScore(normalizeWord('chez'), normalizeWord('ché')) > 0, 'phonetic chez/ché must anchor');
  assert.ok(matchScore(normalizeWord('cette'), normalizeWord('cet')) > 0, 'phonetic cette/cet must anchor');
  const lines = ['chez cette maison'];
  const matched = alignedTexts(lines, asr(['ché', 'cet', 'maison']));
  assert.deepEqual(matched, ['chez', 'cette', 'maison']);
}

{
  const lines = ["l'amour reste là"];
  const lyricsWords = flattenLyrics(lines);
  assert.equal(lyricsWords[0].text, 'l');
  assert.equal(lyricsWords[1].text, 'amour');
  const cues = buildCuesFromLyricsAndAsr(lines, asr(['l', 'amour', 'reste', 'là']), 20);
  assert.equal(cues[0].text, "l'amour reste là");
  assert.deepEqual(cues[0].words.map((w) => w.text), ["l'amour", 'reste', 'là']);
}

{
  const lines = splitCleanLyrics('[Verse 1]\nDebout soldats\n(Chorus)\nVercingétorix !');
  assert.deepEqual(lines, ['Debout soldats', 'Vercingétorix !']);
  const cues = buildCuesFromLyricsAndAsr(lines, asr(['Debout', 'soldats', 'Vercingétorix']), 20);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Debout soldats');
}


{
  const cues = [
    { id: 1, text: 'Le jour se lève…', start: 2.9, end: 7.0, words: [] },
    { id: 2, text: 'Chargez !', start: 9.3, end: 10.2, words: [] },
    { id: 3, text: "À l’aube grise, les chevaux mordent l’air", start: 10.3, end: 12.7, words: [] },
    { id: 4, text: 'Louis de Bourbon fixe la ligne adverse', start: 33.4, end: 38.5, words: [] },
  ];
  const repaired = conservativeGapRepair(cues, 120);
  assert.ok(repaired.gapRepairCount >= 1, 'conservative gap repair should detect the intro-gap pattern');
  assert.ok(repaired[2].start > 30, 'early lyric line should move close to the later vocal block');
  assert.ok(repaired[2].end < repaired[3].start, 'repaired line must stay before following cue');
  assert.ok(repaired[2].end - repaired[2].start < 7.3, 'repaired line must not become absurdly long');
}



{
  const cues = [
    { id: 1, text: 'Le jour se lève…', start: 2.9, end: 7.0, confidence: 0.82, words: [] },
    { id: 2, text: 'Chargez !', start: 9.3, end: 10.2, confidence: 0.78, words: [] },
    { id: 3, text: "À l’aube grise, les chevaux mordent l’air", start: 10.3, end: 12.7, confidence: 0.42, words: [] },
    { id: 4, text: 'Louis de Bourbon fixe la ligne adverse', start: 33.4, end: 38.5, confidence: 0.86, words: [] },
    { id: 5, text: 'Choc de Rocroi !', start: 60, end: 62.2, confidence: 0.71, words: [] },
    { id: 6, text: 'Choc de Rocroi !', start: 74, end: 76.1, confidence: 0.69, words: [] },
  ];
  const analysis = analyzeCueQuality(cues, 120);
  assert.equal(analysis.items.length, cues.length);
  assert.ok(analysis.items[2].flags.some((flag) => flag.code === 'intro-gap'), 'intro gap should be flagged without retiming');
  assert.ok(analysis.items[4].flags.some((flag) => flag.code === 'repeated-line' || flag.code === 'repeated-short'), 'repeated short hook should be flagged');
  const annotated = attachCueQuality(cues, 120);
  assert.ok(annotated[2].quality.level === 'warn');
  assert.equal(annotated[2].start, 10.3, 'quality flags must not alter timing');
}

console.log('align.test.mjs OK');
