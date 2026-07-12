import { normalizeWord } from '@/lib/normalizer';
import { lookupWord } from '@/lib/wordLookup';
import { NextResponse } from 'next/server';
import { recordContextualLearning } from '@/lib/learning';

// POST /api/words/lookup — translate a single word (cache-first).
export async function POST(request) {
    try {
        const { word, language, context } = await request.json();
        const normalized = normalizeWord(word);
        if (!normalized) {
            return NextResponse.json({ error: 'Invalid word' }, { status: 400 });
        }

        const result = await lookupWord(normalized, language, { context });
        if (!result) {
            return NextResponse.json({
                word: normalized,
                translation: normalized,
                meanings: [{ meaning: 'Translation unavailable — check if the local AI service is running', partOfSpeech: '' }],
                ipa: null,
            });
        }
        if (context && language) {
            await recordContextualLearning({ word: normalized, language, context, result });
        }
        return NextResponse.json(result);
    } catch (error) {
        console.error('Word lookup error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
