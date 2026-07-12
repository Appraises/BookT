import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();
const AI_URL = process.env.BOOKT_AI_URL || 'http://127.0.0.1:8000';

const isStudyable = (word, partOfSpeech) =>
    Boolean(word) && word.length <= 40 && !/\d/u.test(word) && partOfSpeech !== 'PROPN' && /\p{L}/u.test(word);

async function lemmatize(words, language) {
    try {
        const response = await fetch(`${AI_URL}/lemmatize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words, language }),
        });
        if (response.ok) return (await response.json()).words || [];
    } catch {
        // Fall through to identity lemmas when the local service is offline.
    }
    return words.map((word) => ({ word, lemma: word, isStudyable: isStudyable(word) }));
}

function latestContext(forms) {
    return [...forms]
        .filter((form) => form.contextSentence)
        .sort((a, b) => new Date(b.lastSeen || b.firstSeen) - new Date(a.lastSeen || a.firstSeen))[0];
}

function aggregateStatus(forms) {
    const active = forms.filter((form) => form.status > 0);
    return active.length ? Math.max(...active.map((form) => form.status)) : 0;
}

function importedRecognition(forms) {
    const reviewed = forms.reduce((best, form) =>
        (form.reviewCount || 0) > (best.reviewCount || 0) ? form : best, forms[0]);
    const reps = forms.reduce((sum, form) => sum + (form.reviewCount || 0), 0);
    const correctCount = forms.reduce((sum, form) => sum + (form.correctCount || 0), 0);
    const stability = reps > 0
        ? Math.max(0.001, ...forms.map((form) => form.interval || 0))
        : 0;
    return {
        due: reviewed.nextReview || new Date(),
        stability,
        difficulty: reps > 0 ? 5 : 0,
        elapsedDays: 0,
        scheduledDays: Math.max(0, Math.round(stability)),
        reps,
        lapses: Math.max(0, reps - correctCount),
        learningSteps: 0,
        state: reps > 0 ? 2 : 0,
        lastReview: reviewed.lastReviewed,
        correctCount,
    };
}

async function main() {
    const forms = await prisma.userWord.findMany({ orderBy: { firstSeen: 'asc' } });
    const cached = await prisma.word.findMany();
    const cache = new Map(cached.map((word) => [`${word.language}:${word.word}`, word]));
    const analyses = new Map();

    for (const language of [...new Set(forms.map((form) => form.language))]) {
        const languageForms = forms.filter((form) => form.language === language);
        for (let offset = 0; offset < languageForms.length; offset += 400) {
            const batch = languageForms.slice(offset, offset + 400).map((form) => form.word);
            for (const analysis of await lemmatize(batch, language)) {
                analyses.set(`${language}:${analysis.word}`, analysis);
            }
        }
    }

    const groups = new Map();
    for (const form of forms) {
        const analysis = analyses.get(`${form.language}:${form.word}`) || { word: form.word, lemma: form.word };
        const lemma = analysis.lemma || form.word;
        const key = `${form.language}:${lemma}`;
        if (!groups.has(key)) groups.set(key, { language: form.language, lemma, forms: [], analyses: [] });
        groups.get(key).forms.push(form);
        groups.get(key).analyses.push(analysis);
    }

    let linkedForms = 0;
    let skillCount = 0;
    for (const group of groups.values()) {
        const context = latestContext(group.forms);
        const status = aggregateStatus(group.forms);
        const firstSeen = group.forms.reduce(
            (earliest, form) => form.firstSeen < earliest ? form.firstSeen : earliest,
            group.forms[0].firstSeen,
        );
        const lastSeenDates = group.forms.map((form) => form.lastSeen).filter(Boolean);
        const lastSeen = lastSeenDates.length
            ? lastSeenDates.reduce((latest, date) => date > latest ? date : latest, lastSeenDates[0])
            : null;
        const analysis = group.analyses.find((item) => item.partOfSpeech) || group.analyses[0];
        const cachedWord = cache.get(`${group.language}:${group.lemma}`)
            || group.forms.map((form) => cache.get(`${group.language}:${form.word}`)).find(Boolean);

        const lexeme = await prisma.lexeme.upsert({
            where: { lemma_language: { lemma: group.lemma, language: group.language } },
            update: {},
            create: {
                lemma: group.lemma,
                language: group.language,
                status,
                exposureCount: group.forms.reduce((sum, form) => sum + form.exposureCount, 0),
                translation: cachedWord?.translation || null,
                meanings: cachedWord?.meanings || '[]',
                ipa: cachedWord?.ipa || null,
                partOfSpeech: analysis?.partOfSpeech || null,
                contextSentence: context?.contextSentence || null,
                contextAudioUrl: context?.contextAudioUrl || null,
                contextStart: context?.contextStart ?? null,
                contextEnd: context?.contextEnd ?? null,
                firstSeen,
                lastSeen,
            },
        });

        for (let index = 0; index < group.forms.length; index += 1) {
            const form = group.forms[index];
            const formAnalysis = group.analyses[index];
            await prisma.userWord.update({
                where: { id: form.id },
                data: {
                    lemma: group.lemma,
                    lexemeId: lexeme.id,
                    status,
                    partOfSpeech: formAnalysis?.partOfSpeech || null,
                    morphology: formAnalysis?.morphology || null,
                    isStudyable: formAnalysis?.isStudyable !== false
                        && isStudyable(form.word, formAnalysis?.partOfSpeech),
                },
            });
            linkedForms += 1;
        }

        if (!group.forms.some((form, index) => {
            const item = group.analyses[index];
            return item?.isStudyable !== false && isStudyable(form.word, item?.partOfSpeech);
        })) continue;

        const recognition = importedRecognition(group.forms);
        const skills = [
            { key: `${lexeme.id}:recognition`, lexemeId: lexeme.id, skill: 'recognition', ...recognition },
            { key: `${lexeme.id}:production`, lexemeId: lexeme.id, skill: 'production' },
        ];
        if (context?.contextAudioUrl) {
            skills.push({ key: `${lexeme.id}:listening`, lexemeId: lexeme.id, skill: 'listening' });
        }
        for (const skill of skills) {
            await prisma.skillMemory.upsert({
                where: { key: skill.key },
                update: {},
                create: skill,
            });
            skillCount += 1;
        }
    }

    console.log(`Migrated ${groups.size} lexemes, linked ${linkedForms} forms, ensured ${skillCount} skill memories.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
