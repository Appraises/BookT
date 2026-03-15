import prisma from '@/lib/prisma';
import { normalizeWord } from '@/lib/normalizer';
import { NextResponse } from 'next/server';

// HuggingFace Inference API (free, no key required for popular models)
const HF_MODELS = {
    fr: 'Helsinki-NLP/opus-mt-fr-en',
    es: 'Helsinki-NLP/opus-mt-es-en',
    de: 'Helsinki-NLP/opus-mt-de-en',
    it: 'Helsinki-NLP/opus-mt-it-en',
    pt: 'Helsinki-NLP/opus-mt-tc-big-pt-en',
    ja: 'Helsinki-NLP/opus-mt-ja-en',
    zh: 'Helsinki-NLP/opus-mt-zh-en',
    ru: 'Helsinki-NLP/opus-mt-ru-en',
    ko: 'Helsinki-NLP/opus-mt-ko-en',
    nl: 'Helsinki-NLP/opus-mt-nl-en',
};

async function translateWithHuggingFace(word, language) {
    const model = HF_MODELS[language];
    if (!model) return null;

    try {
        const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: word }),
        });

        if (!res.ok) {
            console.warn(`HuggingFace API returned ${res.status}`);
            return null;
        }

        const data = await res.json();

        // HF returns [{translation_text: "..."}]
        if (Array.isArray(data) && data[0]?.translation_text) {
            const translation = data[0].translation_text;
            return {
                word,
                translation,
                meanings: [{ meaning: translation, partOfSpeech: '' }],
                ipa: null,
            };
        }
    } catch (e) {
        console.warn('HuggingFace translation failed:', e.message);
    }
    return null;
}

async function translateWithLocalService(word, language) {
    try {
        const res = await fetch('http://localhost:8000/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, language }),
        });
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        // Local service not available
    }
    return null;
}

async function translateWithDictionaryAPI(word, language) {
    try {
        const res = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/${language}/${word}`
        );
        if (res.ok) {
            const data = await res.json();
            const entry = data[0];
            return {
                word,
                translation: entry.meanings?.[0]?.definitions?.[0]?.definition || word,
                meanings: entry.meanings?.map((m) => ({
                    meaning: m.definitions?.[0]?.definition || '',
                    partOfSpeech: m.partOfSpeech || '',
                })) || [],
                ipa: entry.phonetic || entry.phonetics?.[0]?.text || null,
            };
        }
    } catch (e) {
        // Dictionary API failed
    }
    return null;
}

// POST /api/words/lookup
export async function POST(request) {
    try {
        const { word, language } = await request.json();
        const normalized = normalizeWord(word);

        if (!normalized) {
            return NextResponse.json({ error: 'Invalid word' }, { status: 400 });
        }

        // Check cache first (skip entries with "Translation unavailable")
        const cached = await prisma.word.findUnique({
            where: { word_language: { word: normalized, language } },
        });

        if (cached && cached.translation !== normalized && !cached.meanings.includes('unavailable')) {
            return NextResponse.json({
                word: cached.word,
                translation: cached.translation,
                meanings: JSON.parse(cached.meanings),
                ipa: cached.ipa,
            });
        }

        // Try translation sources in order:
        // 1. Local Python service (OPUS-MT)
        // 2. HuggingFace Inference API (free, remote)
        // 3. Free Dictionary API
        let result =
            await translateWithLocalService(normalized, language) ||
            await translateWithHuggingFace(normalized, language) ||
            await translateWithDictionaryAPI(normalized, language);

        if (!result) {
            // Don't cache failures — return without saving
            return NextResponse.json({
                word: normalized,
                translation: normalized,
                meanings: [{ meaning: 'Translation unavailable — check if Python service is running', partOfSpeech: '' }],
                ipa: null,
            });
        }

        // Save/update cache
        const saved = await prisma.word.upsert({
            where: { word_language: { word: normalized, language } },
            update: {
                translation: result.translation,
                meanings: JSON.stringify(result.meanings),
                ipa: result.ipa,
                cachedAt: new Date(),
            },
            create: {
                word: normalized,
                language,
                translation: result.translation,
                meanings: JSON.stringify(result.meanings),
                ipa: result.ipa,
            },
        });

        return NextResponse.json({
            word: saved.word,
            translation: saved.translation,
            meanings: JSON.parse(saved.meanings),
            ipa: saved.ipa,
        });
    } catch (error) {
        console.error('Word lookup error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
