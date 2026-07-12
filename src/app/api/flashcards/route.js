import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { previewSchedule, SKILL } from '@/lib/fsrs';
import { LEVEL } from '@/lib/status';

const LEXICAL_SKILLS = [SKILL.RECOGNITION, SKILL.PRODUCTION, SKILL.LISTENING];

function selectSurfaceForm(lexeme) {
    const contextual = lexeme.forms.find((form) =>
        form.contextSentence && form.contextSentence === lexeme.contextSentence
    );
    return contextual || lexeme.forms.find((form) => form.isStudyable) || lexeme.forms[0];
}

// GET /api/flashcards?language=pl&limit=50
// Returns due FSRS cards. Recognition, production and listening are separate
// memories, so success in one direction cannot advance another.
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
        if (!language) {
            return NextResponse.json({ error: 'language is required' }, { status: 400 });
        }

        const now = new Date();
        const memories = await prisma.skillMemory.findMany({
            where: {
                skill: { in: LEXICAL_SKILLS },
                due: { lte: now },
                lexeme: {
                    language,
                    status: { not: LEVEL.IGNORED },
                    forms: { some: { isStudyable: true } },
                },
            },
            include: {
                lexeme: { include: { forms: { orderBy: { lastSeen: 'desc' } } } },
            },
            orderBy: [{ due: 'asc' }, { reps: 'desc' }],
            take: limit,
        });

        const cards = memories
            .filter((memory) => memory.skill !== SKILL.LISTENING || memory.lexeme.contextAudioUrl)
            .map((memory) => {
                const lexeme = memory.lexeme;
                const form = selectSurfaceForm(lexeme);
                return {
                    id: memory.id,
                    memoryKey: memory.key,
                    lexemeId: lexeme.id,
                    skill: memory.skill,
                    word: lexeme.lemma,
                    surfaceForm: form?.word || lexeme.lemma,
                    lemma: lexeme.lemma,
                    partOfSpeech: lexeme.partOfSpeech || null,
                    language: lexeme.language,
                    status: lexeme.status,
                    translation: lexeme.translation || '',
                    meanings: JSON.parse(lexeme.meanings || '[]'),
                    ipa: lexeme.ipa || '',
                    forms: lexeme.forms.filter((item) => item.isStudyable).map((item) => ({
                        word: item.word,
                        morphology: item.morphology,
                    })),
                    context: lexeme.contextSentence
                        ? {
                            sentence: lexeme.contextSentence,
                            audioUrl: lexeme.contextAudioUrl,
                            start: lexeme.contextStart,
                            end: lexeme.contextEnd,
                            surfaceForm: form?.word || lexeme.lemma,
                        }
                        : null,
                    memory: {
                        reps: memory.reps,
                        lapses: memory.lapses,
                        stability: memory.stability,
                        difficulty: memory.difficulty,
                        due: memory.due,
                        preview: previewSchedule(memory, now),
                    },
                };
            });

        const [due, newAvailable, reviewed, lexemeTotal] = await Promise.all([
            prisma.skillMemory.count({
                where: { skill: { in: LEXICAL_SKILLS }, due: { lte: now }, lexeme: { language } },
            }),
            prisma.skillMemory.count({
                where: { skill: { in: LEXICAL_SKILLS }, reps: 0, lexeme: { language } },
            }),
            prisma.skillMemory.count({
                where: { skill: { in: LEXICAL_SKILLS }, reps: { gt: 0 }, lexeme: { language } },
            }),
            prisma.lexeme.count({ where: { language, status: { not: LEVEL.IGNORED } } }),
        ]);

        return NextResponse.json({
            cards,
            stats: { due, new: newAvailable, reviewed, total: lexemeTotal },
        });
    } catch (error) {
        console.error('Flashcard fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
