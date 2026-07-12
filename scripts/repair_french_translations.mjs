import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const AI_URL = process.env.BOOKT_AI_URL || 'http://127.0.0.1:8000';
const CORE_PRONOUNS = new Set(['elle', 'elles']);

function normalizeWord(word) {
    return (word || '')
        .toLocaleLowerCase('fr')
        .replace(/[\u2018\u2019\u02bc]/gu, "'")
        .replace(/[^\p{L}\p{N}\-']/gu, '');
}

function sentencesFrom(text) {
    return (text || '').split(/(?<=[.!?\u2026\u00bb"])(?:\s+|\n+)|\n{2,}/u).map((item) => item.trim()).filter(Boolean);
}

function sentenceContains(sentence, target) {
    const words = sentence.match(/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu) || [];
    return words.some((word) => normalizeWord(word) === target);
}

async function translate(word, context = '') {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const response = await fetch(`${AI_URL}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word, language: 'fr', context }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
    }
    throw lastError;
}

async function saveResult(form, result, context) {
    const lemma = normalizeWord(result.lemma || form.word);
    const lexemeTranslation = result.lemmaTranslation || (
        lemma === normalizeWord(form.word) ? result.translation : null
    );

    await prisma.word.upsert({
        where: { word_language: { word: form.word, language: 'fr' } },
        update: {
            translation: result.translation,
            meanings: JSON.stringify(result.meanings || []),
            ipa: result.ipa || null,
            cachedAt: new Date(),
        },
        create: {
            word: form.word,
            language: 'fr',
            translation: result.translation,
            meanings: JSON.stringify(result.meanings || []),
            ipa: result.ipa || null,
        },
    });

    const lexeme = await prisma.lexeme.upsert({
        where: { lemma_language: { lemma, language: 'fr' } },
        update: {
            translation: lexemeTranslation || undefined,
            partOfSpeech: result.partOfSpeech || undefined,
            contextSentence: context || undefined,
            lastSeen: new Date(),
        },
        create: {
            lemma,
            language: 'fr',
            translation: lexemeTranslation,
            partOfSpeech: result.partOfSpeech || null,
            status: form.status,
            exposureCount: form.exposureCount,
            contextSentence: context || null,
            firstSeen: form.firstSeen,
            lastSeen: form.lastSeen,
        },
    });

    await prisma.userWord.update({
        where: { id: form.id },
        data: {
            lemma,
            lexemeId: lexeme.id,
            partOfSpeech: result.partOfSpeech || null,
            morphology: result.morphology || null,
        },
    });
    for (const skill of ['recognition', 'production']) {
        const key = `${lexeme.id}:${skill}`;
        await prisma.skillMemory.upsert({
            where: { key },
            update: {},
            create: { key, skill, lexemeId: lexeme.id },
        });
    }
    return { lemma, lexemeTranslation };
}

async function main() {
    const [forms, pages] = await Promise.all([
        prisma.userWord.findMany({ where: { language: 'fr' } }),
        prisma.page.findMany({
            where: { book: { language: 'fr' } },
            select: { content: true },
            orderBy: { pageNumber: 'asc' },
        }),
    ]);
    const targetForms = forms.filter((form) => {
        const word = normalizeWord(form.word);
        return word.includes("'") || CORE_PRONOUNS.has(word);
    });
    const sentences = pages.flatMap((page) => sentencesFrom(page.content));
    const pendingAuxLemmas = new Set();
    let repaired = 0;

    for (const form of targetForms) {
        const word = normalizeWord(form.word);
        const context = sentences.find((sentence) => sentenceContains(sentence, word)) || '';
        try {
            const result = await translate(word, context);
            const saved = await saveResult(form, result, context);
            if (!saved.lexemeTranslation && result.partOfSpeech === 'AUX' && saved.lemma !== word) {
                pendingAuxLemmas.add(saved.lemma);
            }
            console.log(`${word} -> ${result.translation} (${saved.lemma})`);
            repaired += 1;
        } catch (error) {
            console.warn(`Skipped ${word}: ${error.message}`);
        }
    }

    for (const lemma of pendingAuxLemmas) {
        const base = await translate(lemma);
        await prisma.lexeme.update({
            where: { lemma_language: { lemma, language: 'fr' } },
            data: { translation: base.translation },
        });
        console.log(`${lemma} (base) -> ${base.translation}`);
    }

    const orphaned = await prisma.lexeme.deleteMany({
        where: { language: 'fr', forms: { none: {} } },
    });
    console.log(`Repaired ${repaired}/${targetForms.length}; removed ${orphaned.count} orphan lexemes.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
