/**
 * Normalize a word for lookup: lowercase, strip punctuation
 */
export function normalizeWord(word) {
    if (!word) return '';
    return word
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\-']/gu, '') // keep letters, numbers, hyphens, apostrophes
        .trim();
}

/**
 * Split text content into an array of tokens (words + punctuation/spaces)
 * Each token has: { text, isWord }
 */
export function tokenizeText(text) {
    if (!text) return [];
    const tokens = [];
    // Match words (letter sequences with hyphens/apostrophes) or non-word characters
    const regex = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
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
            isWord: true
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
