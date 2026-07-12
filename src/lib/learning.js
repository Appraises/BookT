import prisma from '@/lib/prisma';
import { aiFetch } from '@/lib/aiService';
import { LEVEL } from '@/lib/status';
import { grammarMemoryKey, memoryKey, SKILL } from '@/lib/fsrs';

export function isStudyableToken(word, partOfSpeech = null) {
    if (!word || word.length > 40 || /\d/u.test(word)) return false;
    if (partOfSpeech === 'PROPN') return false;
    return /\p{L}/u.test(word);
}

export async function lemmatizeWords(words, language) {
    const unique = [...new Set(words)].filter(Boolean);
    if (unique.length === 0) return [];
    try {
        const response = await aiFetch('/lemmatize', {
            body: { words: unique, language },
            // Bulk stanza handles a whole page in a few seconds, but leave
            // headroom for cold model loads.
            timeoutMs: 60000,
        });
        const payload = await response.json();
        if (response.ok && Array.isArray(payload.words)) return payload.words;
    } catch {
        // The reader remains usable when the local service is offline.
    }
    return unique.map((word) => ({
        word,
        lemma: word,
        partOfSpeech: null,
        morphology: null,
        isStudyable: isStudyableToken(word),
    }));
}

async function ensureBaseSkills(lexemeId, hasAudio = false) {
    const skills = [SKILL.RECOGNITION, SKILL.PRODUCTION];
    if (hasAudio) skills.push(SKILL.LISTENING);
    await Promise.all(skills.map((skill) => {
        const key = memoryKey(lexemeId, skill);
        return prisma.skillMemory.upsert({
            where: { key },
            update: {},
            create: { key, lexemeId, skill },
        });
    }));
}

export async function ensureLexemesForWords(words, language, properNouns = new Set()) {
    const forms = await prisma.userWord.findMany({
        where: { language, word: { in: words } },
    });
    if (forms.length === 0) return;

    const analyses = await lemmatizeWords(forms.map((form) => form.word), language);
    const analysisByWord = new Map(analyses.map((analysis) => [analysis.word, analysis]));
    const cachedWords = await prisma.word.findMany({
        where: { language, word: { in: [...new Set(forms.map((form) => form.word))] } },
    });
    const cacheByWord = new Map(cachedWords.map((cached) => [cached.word, cached]));

    for (const form of forms) {
        const analysis = analysisByWord.get(form.word) || { word: form.word, lemma: form.word };
        const lemma = analysis.lemma || form.word;
        const cached = cacheByWord.get(lemma) || cacheByWord.get(form.word);
        const studyable = analysis.isStudyable !== false
            && isStudyableToken(form.word, analysis.partOfSpeech)
            && !properNouns.has(form.word);
        const lexeme = await prisma.lexeme.upsert({
            where: { lemma_language: { lemma, language } },
            update: {
                lastSeen: form.lastSeen || undefined,
                translation: cached?.translation || undefined,
                meanings: cached?.meanings || undefined,
                ipa: cached?.ipa || undefined,
                partOfSpeech: analysis.partOfSpeech || undefined,
            },
            create: {
                lemma,
                language,
                status: form.status,
                exposureCount: form.exposureCount,
                firstSeen: form.firstSeen,
                lastSeen: form.lastSeen,
                translation: cached?.translation || null,
                meanings: cached?.meanings || '[]',
                ipa: cached?.ipa || null,
                partOfSpeech: analysis.partOfSpeech || null,
                contextSentence: form.contextSentence,
                contextAudioUrl: form.contextAudioUrl,
                contextStart: form.contextStart,
                contextEnd: form.contextEnd,
            },
        });

        await prisma.userWord.update({
            where: { id: form.id },
            data: {
                lemma,
                lexemeId: lexeme.id,
                partOfSpeech: analysis.partOfSpeech || null,
                morphology: analysis.morphology || null,
                isStudyable: studyable,
            },
        });
        if (studyable) await ensureBaseSkills(lexeme.id, Boolean(form.contextAudioUrl));
    }
}

export async function recordContextualLearning({ word, language, context, result }) {
    if (!word || !language || !result?.lemma) return null;
    const form = await prisma.userWord.findUnique({
        where: { word_language: { word, language } },
    });
    const lemma = result.lemma || word;
    const lexemeTranslation = result.lemmaTranslation || (
        lemma === word ? result.translation : null
    );
    const studyable = isStudyableToken(word, result.partOfSpeech);
    const lexeme = await prisma.lexeme.upsert({
        where: { lemma_language: { lemma, language } },
        update: {
            translation: lexemeTranslation || undefined,
            meanings: result.meanings ? JSON.stringify(result.meanings) : undefined,
            ipa: result.ipa || undefined,
            partOfSpeech: result.partOfSpeech || undefined,
            contextSentence: context?.slice(0, 600) || undefined,
            contextAudioUrl: form?.contextAudioUrl || undefined,
            contextStart: form?.contextStart ?? undefined,
            contextEnd: form?.contextEnd ?? undefined,
            lastSeen: new Date(),
        },
        create: {
            lemma,
            language,
            status: form?.status ?? LEVEL.NEW,
            exposureCount: form?.exposureCount || 0,
            translation: lexemeTranslation || null,
            meanings: JSON.stringify(result.meanings || []),
            ipa: result.ipa || null,
            partOfSpeech: result.partOfSpeech || null,
            contextSentence: context?.slice(0, 600) || null,
            contextAudioUrl: form?.contextAudioUrl || null,
            contextStart: form?.contextStart ?? null,
            contextEnd: form?.contextEnd ?? null,
        },
    });

    if (form) {
        await prisma.userWord.update({
            where: { id: form.id },
            data: {
                lemma,
                lexemeId: lexeme.id,
                partOfSpeech: result.partOfSpeech || null,
                morphology: result.morphology || null,
                isStudyable: studyable,
            },
        });
    }
    if (studyable) await ensureBaseSkills(lexeme.id, Boolean(form?.contextAudioUrl));

    const explanation = result.caseExplanation;
    if (
        !studyable || !context || !explanation?.case || !explanation?.reason ||
        explanation.confidence === 'low'
    ) return lexeme;
    const grammar = await prisma.grammarEncounter.upsert({
        where: {
            grammar_language_word_sentence: { language, word, sentence: context.slice(0, 600) },
        },
        update: {
            lemma,
            lexemeId: lexeme.id,
            caseCode: explanation.case,
            caseLabel: explanation.caseLabel,
            pattern: explanation.pattern || null,
            reason: explanation.reason,
            source: explanation.source,
            confidence: explanation.confidence || 'medium',
            seenCount: { increment: 1 },
            lastSeen: new Date(),
        },
        create: {
            lexemeId: lexeme.id,
            language,
            word,
            lemma,
            sentence: context.slice(0, 600),
            caseCode: explanation.case,
            caseLabel: explanation.caseLabel,
            pattern: explanation.pattern || null,
            reason: explanation.reason,
            source: explanation.source,
            confidence: explanation.confidence || 'medium',
        },
    });
    await prisma.skillMemory.upsert({
        where: { key: grammarMemoryKey(grammar.id) },
        update: {},
        create: {
            key: grammarMemoryKey(grammar.id),
            skill: SKILL.GRAMMAR,
            lexemeId: lexeme.id,
            grammarEncounterId: grammar.id,
        },
    });
    return lexeme;
}

export async function setLexemeStatusForForm(word, language, status) {
    const form = await prisma.userWord.findUnique({
        where: { word_language: { word, language } },
    });
    if (!form?.lexemeId) return null;
    await prisma.$transaction([
        prisma.lexeme.update({ where: { id: form.lexemeId }, data: { status } }),
        prisma.userWord.updateMany({ where: { lexemeId: form.lexemeId }, data: { status } }),
    ]);
    return form.lexemeId;
}
