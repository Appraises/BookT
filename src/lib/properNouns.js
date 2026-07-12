import { tokenizeText, normalizeWord } from './normalizer.js';

// Languages where common nouns are capitalized — the heuristic is unsafe there.
const CASE_INSENSITIVE_LANGS = new Set(['de']);

// Structural / front-matter words that recur capitalized (headings, credits,
// tables of contents) but are ordinary vocabulary — never treat them as names.
const NON_NAME_WORDS = {
    fr: new Set(['chapitre', 'chapitres', 'tome', 'partie', 'parties', 'livre', 'page',
        'pages', 'titre', 'table', 'traduit', 'traduction', 'roman', 'prologue',
        'epilogue', 'sommaire', 'note', 'notes', 'fin']),
    pl: new Set(['rozdział', 'rozdziału', 'część', 'części', 'tom', 'spis', 'treści',
        'strona', 'strony', 'przypis', 'przypisy', 'wesprzyj', 'początek', 'koniec',
        'tytuł', 'księga', 'wstęp']),
    pt: new Set(['capítulo', 'capítulos', 'parte', 'partes', 'livro', 'página',
        'páginas', 'título', 'sumário', 'nota', 'notas', 'prólogo', 'epílogo', 'fim']),
    en: new Set(['chapter', 'chapters', 'part', 'volume', 'page', 'title', 'contents',
        'prologue', 'epilogue', 'note', 'notes', 'the', 'end']),
};

// A separator that resets "sentence-initial" state: after these, a following
// capital is grammatically forced, so it carries no proper-noun signal. Kept
// liberal (colons, dashes, quotes, brackets) to bias toward NOT flagging —
// a missed name is cheaper than a common word wrongly excluded from study.
const BOUNDARY = /[.!?…:;»«"“”'‘’()\[\]—–\n]/u;

function firstLetter(text) {
    for (const ch of text) {
        if (/\p{L}/u.test(ch)) return ch;
    }
    return '';
}

function startsLower(text) {
    const f = firstLetter(text);
    return f !== '' && f === f.toLowerCase() && f !== f.toUpperCase();
}

// Titlecase = capital first letter with at least one lowercase letter after,
// so ALL-CAPS headings ("CHAPITRE", "MAISON") don't count as evidence.
function isTitlecase(text) {
    const f = firstLetter(text);
    if (f === '' || f !== f.toUpperCase() || f === f.toLowerCase()) return false;
    return /\p{Ll}/u.test(text);
}

/**
 * Detect likely proper nouns (names) from a block of ORIGINAL-CASE text using
 * capitalization statistics: a word is a name when it is never seen lowercase
 * and appears titlecased at least once away from a sentence start.
 *
 * @param {string} text - original text with casing preserved
 * @param {string} language
 * @param {{ minTitleMid?: number }} [options] - how many mid-sentence titlecase
 *   occurrences are required. 1 for a single page (aggressive), higher for a
 *   whole book (precise — real names recur, incidental capitals don't).
 * @returns {Set<string>} normalized proper-noun forms
 */
export function detectProperNouns(text, language, { minTitleMid = 1 } = {}) {
    const result = new Set();
    if (!text || CASE_INSENSITIVE_LANGS.has(language)) return result;
    const stoplist = NON_NAME_WORDS[language] || new Set();

    const stats = new Map(); // norm -> { lower, titleMid }
    let sentenceStart = true;

    for (const tok of tokenizeText(text)) {
        if (!tok.isWord) {
            if (BOUNDARY.test(tok.text)) sentenceStart = true;
            continue;
        }
        const norm = normalizeWord(tok.text);
        if (norm) {
            let s = stats.get(norm);
            if (!s) { s = { lower: 0, titleMid: 0 }; stats.set(norm, s); }
            if (startsLower(tok.text)) s.lower += 1;
            else if (!sentenceStart && isTitlecase(tok.text)) s.titleMid += 1;
        }
        sentenceStart = false;
    }

    for (const [norm, s] of stats) {
        if (s.lower === 0 && s.titleMid >= minTitleMid && !stoplist.has(norm)) result.add(norm);
    }
    return result;
}
