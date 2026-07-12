import prisma from '@/lib/prisma';
import { aiFetch, AIServiceError } from '@/lib/aiService';
import { previewSchedule, SKILL } from '@/lib/fsrs';
import { LEVEL } from '@/lib/status';
import { NextResponse } from 'next/server';

// Teaching order — a verb climbs one tense at a time.
const TENSE_LADDER = ['présent', 'imparfait', 'futur-simple', 'passé-composé'];

async function conjugate(verb, language) {
    const res = await aiFetch('/conjugate', {
        body: { verb, language },
        timeoutMs: 30000,
    });
    return res.json();
}

// GET /api/conjugation?language=fr
// Picks the next conjugation drill: due reviews first, then the next tense of
// the most-exposed verb still climbing the ladder. Returns { drill: null }
// when the language has no conjugation support or nothing is available.
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        if (!language) {
            return NextResponse.json({ error: 'language is required' }, { status: 400 });
        }

        const now = new Date();
        const candidates = [];

        // 1. Due conjugation reviews, most overdue first.
        const due = await prisma.skillMemory.findMany({
            where: {
                skill: SKILL.CONJUGATION,
                due: { lte: now },
                lexeme: {
                    language,
                    status: { not: LEVEL.IGNORED },
                    forms: { some: { isStudyable: true } },
                },
            },
            include: { lexeme: true },
            orderBy: { due: 'asc' },
            take: 5,
        });
        for (const memory of due) {
            const tense = memory.key.split(':').pop();
            candidates.push({ lexeme: memory.lexeme, tense, memory });
        }

        // 2. New drills: studyable verbs, most exposure first, next unseen
        // tense in the ladder.
        const verbs = await prisma.lexeme.findMany({
            where: {
                language,
                partOfSpeech: { in: ['VERB', 'AUX'] },
                status: { not: LEVEL.IGNORED },
                forms: { some: { isStudyable: true } },
            },
            include: { skills: { where: { skill: SKILL.CONJUGATION } } },
            orderBy: [{ exposureCount: 'desc' }, { firstSeen: 'asc' }],
            take: 15,
        });
        for (const lexeme of verbs) {
            const practiced = new Set(lexeme.skills.map((s) => s.key.split(':').pop()));
            const tense = TENSE_LADDER.find((t) => !practiced.has(t));
            if (tense) candidates.push({ lexeme, tense, memory: null });
        }

        // First candidate the conjugator actually knows wins ("envahier"-style
        // lemmatizer glitches get skipped instead of blocking the drill).
        for (const candidate of candidates) {
            let tables;
            try {
                tables = await conjugate(candidate.lexeme.lemma, language);
            } catch (error) {
                if (error instanceof AIServiceError && error.status === 400) {
                    // Language has no conjugation support at all.
                    return NextResponse.json({ drill: null });
                }
                if (error instanceof AIServiceError && error.status === 404) continue;
                throw error;
            }
            const entry = tables.tenses.find((t) => t.tense === candidate.tense);
            if (!entry) continue;
            return NextResponse.json({
                drill: {
                    lexemeId: candidate.lexeme.id,
                    verb: candidate.lexeme.lemma,
                    translation: candidate.lexeme.translation || '',
                    tense: entry.tense,
                    tenseLabel: entry.label,
                    mood: entry.mood,
                    forms: entry.forms,
                    isReview: Boolean(candidate.memory),
                    preview: candidate.memory ? previewSchedule(candidate.memory, now) : null,
                },
            });
        }

        return NextResponse.json({ drill: null });
    } catch (error) {
        if (error instanceof AIServiceError) {
            return NextResponse.json({ drill: null, unavailable: true });
        }
        console.error('Conjugation drill error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

