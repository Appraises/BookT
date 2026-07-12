/**
 * Fuzzy matching between an aligned audio sentence and the on-screen tokens.
 * Kept framework-free so it can be unit-tested and reused by the reader for
 * both the in-view highlight and the follow-along page-turn.
 */

const EMPTY_SET = new Set();

// Strip case, diacritics and quotes/punctuation so matching is resilient to
// how the aligner tokenized the sentence versus how the text was extracted.
export function normalizeSyncText(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[.,!?;:'"«»“”‘’]/g, '');
}

/**
 * Best contiguous match of a sentence within a token array.
 *
 * @param {string[]} syncWords - normalized words of the playing sentence
 * @param {Array<{text: string, isWord: boolean}>} tokens
 * @returns {{ set: Set<number>, score: number }} matched token indices and the
 *          fraction of the sentence's words that lined up (0..1)
 */
export function matchSentenceInTokens(syncWords, tokens) {
    if (!syncWords?.length || !tokens?.length) return { set: EMPTY_SET, score: 0 };

    const wordTokenIndices = [];
    const normTokens = [];
    tokens.forEach((t, i) => {
        if (t.isWord) {
            wordTokenIndices.push(i);
            normTokens.push(normalizeSyncText(t.text));
        }
    });

    let bestStart = -1;
    let bestScore = 0;
    for (let start = 0; start < wordTokenIndices.length; start++) {
        let matched = 0;
        const compareLen = Math.min(syncWords.length, wordTokenIndices.length - start);
        for (let j = 0; j < compareLen; j++) {
            const tokenText = normTokens[start + j];
            const syncWord = syncWords[j];
            if (tokenText === syncWord ||
                tokenText.startsWith(syncWord) ||
                syncWord.startsWith(tokenText)) {
                matched++;
            }
        }
        const score = matched / syncWords.length;
        if (score > bestScore && matched >= 2) {
            bestScore = score;
            bestStart = start;
        }
        if (bestScore >= 0.6) break; // good enough match
    }

    if (bestStart < 0 || bestScore < 0.3) return { set: EMPTY_SET, score: bestScore };

    const set = new Set();
    for (let j = 0; j < syncWords.length && bestStart + j < wordTokenIndices.length; j++) {
        set.add(wordTokenIndices[bestStart + j]);
    }
    return { set, score: bestScore };
}

/**
 * Given the playing sentence and the sub-pages of the current DB page, decide
 * which sub-page to turn to so the sentence stays visible. Returns -1 when the
 * sentence is already on `currentSubPage` or can't be confidently located.
 *
 * @param {string[]} syncWords
 * @param {Array<Array<{text: string, isWord: boolean}>>} subPages
 * @param {number} currentSubPage
 * @param {number} [threshold=0.3]
 */
export function findSubPageForSentence(syncWords, subPages, currentSubPage, threshold = 0.3) {
    if (!syncWords?.length || !Array.isArray(subPages) || subPages.length <= 1) return -1;

    // Already visible? stay put.
    const current = subPages[currentSubPage];
    if (current && matchSentenceInTokens(syncWords, current).score >= threshold) return -1;

    let bestPage = -1;
    let bestScore = threshold; // require a confident match before turning the page
    for (let p = 0; p < subPages.length; p++) {
        if (p === currentSubPage) continue;
        const { score } = matchSentenceInTokens(syncWords, subPages[p]);
        if (score > bestScore) {
            bestScore = score;
            bestPage = p;
        }
    }
    return bestPage;
}
