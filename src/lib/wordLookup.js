import prisma from '@/lib/prisma';
import { aiFetch } from '@/lib/aiService';

async function translateWithLocalService(word, language, context = null) {
    try {
        const res = await aiFetch('/translate', {
            body: { word, language, context },
            timeoutMs: context ? 20000 : 12000,
        });
        return await res.json();
    } catch {
        return null; // caller falls through to other sources
    }
}

async function translateWithDictionaryAPI(word, language) {
    try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${language}/${word}`);
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
    } catch {
        // Dictionary API failed
    }
    return null;
}

function fromCache(cached) {
    return {
        word: cached.word,
        translation: cached.translation,
        meanings: JSON.parse(cached.meanings),
        ipa: cached.ipa,
    };
}

async function saveTranslation(normalized, language, result) {
    if (!result?.translation || result.error) return null;
    return prisma.word.upsert({
        where: { word_language: { word: normalized, language } },
        update: {
            translation: result.translation,
            meanings: JSON.stringify(result.meanings || []),
            ipa: result.ipa || null,
            cachedAt: new Date(),
        },
        create: {
            word: normalized,
            language,
            translation: result.translation,
            meanings: JSON.stringify(result.meanings || []),
            ipa: result.ipa || null,
        },
    });
}

const isUsableCache = (cached, normalized) =>
    cached && cached.translation !== normalized && !cached.meanings.includes('unavailable');

/**
 * Look up a single normalized word (cache-first). When `cacheOnly` is true it
 * never calls external services — used by prefetch/batch to stay cheap.
 * Returns the translation object, or null when nothing is available.
 */
export async function lookupWord(normalized, language, { cacheOnly = false, context = null } = {}) {
    if (!normalized) return null;

    // Contextual results include morphology and a sentence translation, so
    // they cannot be served from the word-only cache.
    if (context && !cacheOnly) {
        const contextual = await translateWithLocalService(normalized, language, context);
        if (contextual?.translation && !contextual.error) {
            await saveTranslation(normalized, language, contextual);
            return contextual;
        }
    }

    const cached = await prisma.word.findUnique({
        where: { word_language: { word: normalized, language } },
    });
    if (isUsableCache(cached, normalized)) return fromCache(cached);
    if (cacheOnly) return null;

    const result =
        await translateWithLocalService(normalized, language) ||
        await translateWithDictionaryAPI(normalized, language);
    if (!result) return null;

    const saved = await saveTranslation(normalized, language, result);
    if (!saved) return null;
    return fromCache(saved);
}
