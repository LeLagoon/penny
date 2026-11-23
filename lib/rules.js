// Rule-based expense categoriser: whole-word keyword scoring + user-taught rules.
// This is the fallback used when the ML service is unavailable, and a baseline the ML model is
// compared against.
import { STUDENT_LEXICON } from './lexicon.js';

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[_/|\\@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text) {
  return normalizeText(text).split(/[^a-z0-9]+/).filter(Boolean);
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = new Map();

// A keyword matches only as a whole word/phrase (optional plural "s"/"es" on single words).
function keywordPattern(keyword) {
  let re = patternCache.get(keyword);
  if (!re) {
    const isSingleWord = !/\s/.test(keyword);
    const plural = isSingleWord && !/s$/.test(keyword) && /[a-z]$/.test(keyword) ? '(?:s|es)?' : '';
    re = new RegExp(`(?<![a-z0-9])${escapeRegex(keyword)}${plural}(?![a-z0-9])`);
    patternCache.set(keyword, re);
  }
  return re;
}

// Longer, multi-word keywords are more specific, so they carry more weight.
function keywordWeight(keyword) {
  const words = keyword.split(/\s+/).length;
  return words * 2 + 1;
}

function scoreKeywords(text, categories) {
  // categories: { id: [keywords] }
  const scores = [];
  for (const [id, keywords] of Object.entries(categories)) {
    let score = 0;
    const matched = [];
    for (const raw of keywords) {
      const kw = normalizeText(raw);
      if (!kw) continue;
      if (keywordPattern(kw).test(text)) {
        score += keywordWeight(kw);
        matched.push(kw);
      }
    }
    if (score > 0) scores.push({ id, score, matched });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function lexiconConfidence(best, second) {
  const s2 = second ? second.score : 0;
  const margin = 1 - s2 / best.score;
  const conf = 0.55 + 0.25 * margin + 0.12 * Math.min(best.score / 6, 1);
  return Math.round(Math.min(conf, 0.92) * 100) / 100;
}

/**
 * @param {string} rawText
 * @param {{learned?: Record<string,string>, custom?: Array<{id:string,keywords:string[]}>}} ctx
 * @returns {{category:string, confidence:number, source:string, matched?:string[], alternatives?:Array}}
 */
export function predictByRules(rawText, ctx = {}) {
  const text = normalizeText(rawText);
  if (!text) return { category: 'miscellaneous', confidence: 0, source: 'empty' };

  const learned = ctx.learned || {};
  const custom = ctx.custom || [];

  // 1. A rule the user taught for exactly this text always wins.
  if (learned[text]) {
    return { category: learned[text], confidence: 1, source: 'user_rule_exact' };
  }

  // 2. Built-in lexicon (and custom categories) scored by whole-word matches.
  const customMap = {};
  for (const c of custom) if (Array.isArray(c.keywords)) customMap[c.id] = c.keywords;
  const customScores = scoreKeywords(text, customMap);
  const lexScores = scoreKeywords(text, STUDENT_LEXICON);

  // 3. A learned rule matches when all of its words appear in the text. Prefer the most specific
  //    rule, and let a more specific built-in phrase ("uber eats") beat a broader rule ("uber").
  const tokens = new Set(tokenize(text));
  let bestRule = null;
  for (const [phrase, category] of Object.entries(learned)) {
    const pt = tokenize(phrase);
    if (pt.length && pt.every(t => tokens.has(t))) {
      if (!bestRule || pt.length > bestRule.words || (pt.length === bestRule.words && phrase.length > bestRule.phrase.length)) {
        bestRule = { phrase, category, words: pt.length };
      }
    }
  }
  const topWords = scores => (scores.length ? Math.max(...scores[0].matched.map(k => k.split(/\s+/).length)) : 0);
  const bestKeywordWords = Math.max(topWords(lexScores), topWords(customScores));
  if (bestRule && bestRule.words >= bestKeywordWords) {
    return { category: bestRule.category, confidence: 0.95, source: 'user_rule_partial', matched: [bestRule.phrase] };
  }

  // 4. Custom categories beat built-in ones (the user defined them on purpose).
  if (customScores.length) {
    const best = customScores[0];
    return { category: best.id, confidence: 0.9, source: 'custom_category', matched: best.matched };
  }

  if (lexScores.length) {
    const [best, second] = lexScores;
    return {
      category: best.id,
      confidence: lexiconConfidence(best, second),
      source: 'lexicon',
      matched: best.matched,
      alternatives: lexScores.slice(1, 3).map(s => ({ category: s.id, score: s.score }))
    };
  }

  // 5. Nothing matched: we do not know.
  return { category: 'miscellaneous', confidence: 0.3, source: 'default' };
}
