/**
 * One-shot: re-lemmatize existing vocabulary and merge inflected forms into
 * their lemma's lexeme, so conjugations ("faisait", "faisais") stop being
 * separate flashcards and collapse into the infinitive ("faire").
 *
 * Needs the local AI service running (bulk /lemmatize + /translate).
 * Safe to re-run: already-merged forms resolve to the same lexeme.
 *
 *   node scripts/relemmatize_merge.mjs [language=fr]
 */
import { PrismaClient } from '@prisma/client';

const AI = process.env.BOOKT_AI_URL || 'http://127.0.0.1:8000';
const language = process.argv[2] || 'fr';
const prisma = new PrismaClient();

async function aiPost(path, body, timeoutMs = 120000) {
    const res = await fetch(`${AI}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json();
}

const forms = await prisma.userWord.findMany({ where: { language } });
console.log(`${forms.length} formas em "${language}"`);

// 1. Re-lemmatize everything in batches (bulk stanza — fast).
const analyses = new Map();
for (let i = 0; i < forms.length; i += 200) {
    const batch = forms.slice(i, i + 200).map((f) => f.word);
    const res = await aiPost('/lemmatize', { words: batch, language });
    for (const a of res.words) analyses.set(a.word, a);
}

// 2. Group forms by their (new) lemma.
const groups = new Map(); // lemma -> [{ form, analysis }]
for (const form of forms) {
    const analysis = analyses.get(form.word) || {
        lemma: form.lemma || form.word,
        partOfSpeech: form.partOfSpeech,
        morphology: form.morphology,
    };
    const lemma = analysis.lemma || form.word;
    if (!groups.has(lemma)) groups.set(lemma, []);
    groups.get(lemma).push({ form, analysis });
}

const lexemesBefore = await prisma.lexeme.count({ where: { language } });
let merged = 0;
let repointed = 0;

for (const [lemma, members] of groups) {
    const oldLexemeIds = [...new Set(members.map((m) => m.form.lexemeId).filter(Boolean))];
    const oldLexemes = await prisma.lexeme.findMany({
        where: { id: { in: oldLexemeIds } },
        include: { skills: true },
    });

    // Most common POS across the group names the lexeme's POS.
    const posCounts = new Map();
    for (const m of members) {
        const pos = m.analysis.partOfSpeech;
        if (pos) posCounts.set(pos, (posCounts.get(pos) || 0) + 1);
    }
    const partOfSpeech = [...posCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Target lexeme: the one already named `lemma`, or create it.
    let target = oldLexemes.find((l) => l.lemma === lemma)
        || await prisma.lexeme.findUnique({ where: { lemma_language: { lemma, language } }, include: { skills: true } });
    const donors = oldLexemes.filter((l) => l.id !== target?.id);
    if (!target) {
        const seed = donors[0];
        target = await prisma.lexeme.create({
            data: {
                lemma,
                language,
                status: seed?.status ?? 1,
                exposureCount: 0,
                partOfSpeech,
                contextSentence: seed?.contextSentence,
                contextAudioUrl: seed?.contextAudioUrl,
                contextStart: seed?.contextStart,
                contextEnd: seed?.contextEnd,
                firstSeen: seed?.firstSeen,
                lastSeen: seed?.lastSeen,
            },
            include: { skills: true },
        });
    }

    // Repoint every form of the group to the target.
    for (const m of members) {
        if (m.form.lexemeId === target.id && m.form.lemma === lemma
            && m.form.partOfSpeech === (m.analysis.partOfSpeech || null)) continue;
        await prisma.userWord.update({
            where: { id: m.form.id },
            data: {
                lemma,
                lexemeId: target.id,
                partOfSpeech: m.analysis.partOfSpeech || null,
                morphology: m.analysis.morphology || null,
            },
        });
        repointed += 1;
    }

    // POS on the target even when nothing merges (backfills the null-POS era).
    if (partOfSpeech && target.partOfSpeech !== partOfSpeech) {
        await prisma.lexeme.update({ where: { id: target.id }, data: { partOfSpeech } });
    }

    if (donors.length === 0) continue;

    // Fold donor lexemes (now formless) into the target: keep the strongest
    // FSRS memory per skill, aggregate status/exposure, keep any context.
    const targetSkills = new Map(target.skills.map((s) => [s.skill, s]));
    for (const donor of donors) {
        const remaining = await prisma.userWord.count({ where: { lexemeId: donor.id } });
        if (remaining > 0) continue; // shared with another lemma group — leave it

        for (const memory of donor.skills) {
            const existing = targetSkills.get(memory.skill);
            if (!existing) {
                const moved = await prisma.skillMemory.update({
                    where: { id: memory.id },
                    data: { key: `${target.id}:${memory.skill}`, lexemeId: target.id },
                });
                targetSkills.set(memory.skill, moved);
            } else if (memory.reps > existing.reps) {
                // Donor was reviewed more — its schedule is the real signal.
                await prisma.skillMemory.update({
                    where: { id: existing.id },
                    data: {
                        due: memory.due, stability: memory.stability,
                        difficulty: memory.difficulty, elapsedDays: memory.elapsedDays,
                        scheduledDays: memory.scheduledDays, reps: memory.reps,
                        lapses: memory.lapses, learningSteps: memory.learningSteps,
                        state: memory.state, lastReview: memory.lastReview,
                        correctCount: memory.correctCount,
                    },
                });
            }
        }
        await prisma.grammarEncounter.updateMany({
            where: { lexemeId: donor.id },
            data: { lexemeId: target.id, lemma },
        });

        const data = {
            status: Math.max(target.status, donor.status),
            exposureCount: target.exposureCount + donor.exposureCount,
            partOfSpeech: partOfSpeech || target.partOfSpeech,
            translation: target.translation || undefined,
            contextSentence: target.contextSentence || donor.contextSentence || undefined,
            contextAudioUrl: target.contextAudioUrl || donor.contextAudioUrl || undefined,
            contextStart: target.contextStart ?? donor.contextStart ?? undefined,
            contextEnd: target.contextEnd ?? donor.contextEnd ?? undefined,
            lastSeen: donor.lastSeen && (!target.lastSeen || donor.lastSeen > target.lastSeen)
                ? donor.lastSeen : undefined,
        };
        target = await prisma.lexeme.update({
            where: { id: target.id }, data, include: { skills: true },
        });
        await prisma.lexeme.delete({ where: { id: donor.id } }); // cascades leftover memories
        merged += 1;
    }
}

// Donors skipped mid-run because another group still pointed at them are
// formless by now — sweep them.
const formless = await prisma.lexeme.deleteMany({
    where: { language, forms: { none: {} } },
});
if (formless.count) console.log(`lexemas sem formas removidos: ${formless.count}`);

// 3. Base skills + infinitive translation for every deck-eligible lexeme.
const eligible = await prisma.lexeme.findMany({
    where: { language, forms: { some: { isStudyable: true } } },
    include: { skills: true },
});
let skillsCreated = 0;
let translated = 0;
for (const lexeme of eligible) {
    const skills = new Set(lexeme.skills.map((s) => s.skill));
    const wanted = ['recognition', 'production'];
    if (lexeme.contextAudioUrl) wanted.push('listening');
    for (const skill of wanted) {
        if (skills.has(skill)) continue;
        await prisma.skillMemory.create({
            data: { key: `${lexeme.id}:${skill}`, lexemeId: lexeme.id, skill },
        });
        skillsCreated += 1;
    }

    if (!lexeme.translation) {
        // The lexeme is the lemma now — translate the infinitive, not the form.
        const cached = await prisma.word.findUnique({
            where: { word_language: { word: lexeme.lemma, language } },
        });
        let translation = cached?.translation || null;
        if (!translation) {
            try {
                const res = await aiPost('/translate', { word: lexeme.lemma, language }, 30000);
                translation = res.translation || null;
            } catch { /* service hiccup — deck just shows no translation yet */ }
        }
        if (translation) {
            await prisma.lexeme.update({
                where: { id: lexeme.id },
                data: { translation, ipa: lexeme.ipa || cached?.ipa || undefined },
            });
            translated += 1;
        }
    }
}

const lexemesAfter = await prisma.lexeme.count({ where: { language } });
const verbs = await prisma.lexeme.count({ where: { language, partOfSpeech: 'VERB' } });
console.log(`\nLexemas: ${lexemesBefore} -> ${lexemesAfter} (${merged} fundidos, ${repointed} formas re-apontadas)`);
console.log(`Verbos identificados: ${verbs} | skills criadas: ${skillsCreated} | traduções backfill: ${translated}`);
await prisma.$disconnect();
