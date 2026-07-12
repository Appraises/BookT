import { normalizeWord, isLearnableWord } from '@/lib/normalizer';
import { lookupWord } from '@/lib/wordLookup';
import { NextResponse } from 'next/server';

const MAX_WORDS = 40;

// POST /api/words/lookup/batch — warm translations for a set of words.
// Body: { words: string[], language, cacheOnly? }
// Returns { translations: { [word]: {translation, meanings, ipa} } }.
// Used by the reader to prefetch so clicking a word feels instant. Defaults to
// cache-only to avoid hammering the local translator on every page turn.
export async function POST(request) {
    try {
        const { words, language, cacheOnly = true } = await request.json();
        if (!Array.isArray(words) || !language) {
            return NextResponse.json({ error: 'words[] and language are required' }, { status: 400 });
        }

        const unique = [...new Set(words.map(normalizeWord).filter(isLearnableWord))].slice(0, MAX_WORDS);

        const results = await Promise.all(
            unique.map(async (w) => [w, await lookupWord(w, language, { cacheOnly }).catch(() => null)])
        );

        const translations = {};
        for (const [word, result] of results) {
            if (result) translations[word] = result;
        }
        return NextResponse.json({ translations });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
