export function normalizeCtc(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getVocab(tokenizer) {
  const t2i = tokenizer?.model?.tokens_to_ids;
  if (t2i instanceof Map) return Object.fromEntries(t2i);
  if (t2i && typeof t2i === 'object') return t2i;

  let vocab = tokenizer?.vocab;
  if (!vocab && typeof tokenizer?.get_vocab === 'function') {
    try { vocab = tokenizer.get_vocab(); } catch (_) { vocab = null; }
  }
  if (!vocab) vocab = tokenizer?.model?.vocab;

  if (Array.isArray(vocab)) {
    const obj = {};
    vocab.forEach((token, id) => {
      if (token !== null && token !== undefined) obj[token] = id;
    });
    return obj;
  }
  if (vocab && typeof vocab === 'object') return vocab;
  throw new Error('Vocabulaire CTC inaccessible.');
}

export function blankId(tokenizer, vocab) {
  return tokenizer?.pad_token_id
    ?? tokenizer?.config?.pad_token_id
    ?? vocab?.['<pad>']
    ?? vocab?.['[PAD]']
    ?? vocab?.['<PAD>']
    ?? 0;
}

export function delimiterToken(tokenizer, vocab) {
  const candidates = [tokenizer?.word_delimiter_token, '|', ' ', '<s>', '</s>'].filter(Boolean);
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(vocab, candidate)) return candidate;
  }
  return null;
}

export function tokenForChar(char, vocab, delimiter) {
  if (char === ' ') {
    return delimiter && Object.prototype.hasOwnProperty.call(vocab, delimiter) ? vocab[delimiter] : null;
  }
  const variants = [char, char.toUpperCase(), char.toLowerCase()];
  for (const variant of variants) {
    if (Object.prototype.hasOwnProperty.call(vocab, variant)) return vocab[variant];
  }
  return null;
}

export function buildTokenIds(words, tokenizer) {
  const vocab = getVocab(tokenizer);
  const delimiter = delimiterToken(tokenizer, vocab);
  const tokenIds = [];
  const tokenToWord = [];
  const skipped = [];

  words.forEach((word, wordIndex) => {
    const text = normalizeCtc(word?.text || word?.norm || '');
    if (!text) return;
    if (tokenIds.length && delimiter) {
      tokenIds.push(vocab[delimiter]);
      tokenToWord.push(null);
    }
    for (const char of text.replace(/\s+/g, '')) {
      const id = tokenForChar(char, vocab, delimiter);
      if (id === null || id === undefined) {
        skipped.push(char);
        continue;
      }
      tokenIds.push(id);
      tokenToWord.push(wordIndex);
    }
  });

  return {
    tokenIds,
    tokenToWord,
    blank: blankId(tokenizer, vocab),
    delimiter: delimiter ? vocab[delimiter] : null,
    skipped,
    vocabSize: Object.keys(vocab).length,
  };
}
