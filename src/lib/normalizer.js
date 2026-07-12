/**
 * Normalize a word for lookup: lowercase, strip punctuation
 */
export function normalizeWord(word) {
    if (!word) return '';
    return word
        .toLowerCase()
        .replace(/[\u2018\u2019\u02bc]/gu, "'")
        .replace(/[^\p{L}\p{N}\-']/gu, '') // keep letters, numbers, hyphens, apostrophes
        .trim();
}

/**
 * Whether a token is worth tracking as vocabulary. Filters pure-number and
 * letterless tokens (e.g. "1872", "7", "—") that pollute the deck. Single
 * letters are kept — in many languages ("i", "o", "w", "a") they are real words.
 */
export function isLearnableWord(word) {
    return typeof word === 'string'
        && word.length <= 40
        && /\p{L}/u.test(word)
        && !/\d/u.test(word);
}

/**
 * Split text content into an array of tokens (words + punctuation/spaces)
 * Each token has: { text, isWord }
 */
export function tokenizeText(text) {
    if (!text) return [];
    const tokens = [];
    // Match words (letter sequences with hyphens/apostrophes) or non-word characters
    const regex = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;
    let lastIndex = 0;

    for (const match of text.matchAll(regex)) {
        // Add any non-word text before this word
        if (match.index > lastIndex) {
            tokens.push({
                text: text.slice(lastIndex, match.index),
                isWord: false
            });
        }
        tokens.push({
            text: match[0],
            // Pure-number tokens (1872, 7) flow as plain text — not vocabulary.
            isWord: isLearnableWord(match[0])
        });
        lastIndex = match.index + match[0].length;
    }

    // Add remaining non-word text
    if (lastIndex < text.length) {
        tokens.push({
            text: text.slice(lastIndex),
            isWord: false
        });
    }

    return tokens;
}
