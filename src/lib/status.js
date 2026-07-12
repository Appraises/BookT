/**
 * Vocabulary knowledge levels — single source of truth.
 * Stored as an integer 0..4 on UserWord.status (SQLite Int).
 */
export const LEVEL = {
    IGNORED: 0,    // user chose to exclude this word
    NEW: 1,        // seen, not yet learned
    RECOGNIZED: 2, // starting to recall
    FAMILIAR: 3,   // usually recalls
    KNOWN: 4,      // mastered — out of the review queue
};

// Words counted as "still being learned" (everything except Known/Ignored).
export const LEARNING_LEVELS = [LEVEL.NEW, LEVEL.RECOGNIZED, LEVEL.FAMILIAR];

// Levels whose words are pulled into the SRS review deck. New words are now
// studyable too (you learn them via review), not only after auto-promotion.
export const REVIEW_LEVELS = [LEVEL.NEW, LEVEL.RECOGNIZED, LEVEL.FAMILIAR];

// A New word auto-promotes to Recognized only after being shown on this many
// distinct page-views — so merely turning a page no longer claims recognition.

export const LEVEL_LABELS = {
    0: 'Ignored',
    1: 'New',
    2: 'Recognized',
    3: 'Familiar',
    4: 'Known',
};

/**
 * Coerce any legacy/loose status value to an integer level.
 * Accepts numbers, numeric strings, and the old 'NEW'/'KNOWN' sentinels.
 */
export function toLevel(value, fallback = LEVEL.NEW) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (value === 'NEW') return LEVEL.NEW;
    if (value === 'KNOWN') return LEVEL.KNOWN;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? fallback : n;
}
