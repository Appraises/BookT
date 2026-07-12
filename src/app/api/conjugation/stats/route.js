import prisma from '@/lib/prisma';
import { SKILL } from '@/lib/fsrs';
import { NextResponse } from 'next/server';

// Stability of ~21 days marks a tense as "known" (same bar the word status
// model uses), so mastery is how far each practiced tense has climbed.
const KNOWN_STABILITY = 21;

// GET /api/conjugation/stats?language=fr — per-verb conjugation mastery.
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        if (!language) {
            return NextResponse.json({ error: 'language is required' }, { status: 400 });
        }

        const memories = await prisma.skillMemory.findMany({
            where: { skill: SKILL.CONJUGATION, lexeme: { language } },
            include: { lexeme: { select: { id: true, lemma: true, translation: true } } },
            orderBy: { updatedAt: 'desc' },
        });

        const byVerb = new Map();
        for (const memory of memories) {
            if (!memory.lexeme) continue;
            const id = memory.lexeme.id;
            if (!byVerb.has(id)) {
                byVerb.set(id, {
                    lexemeId: id,
                    verb: memory.lexeme.lemma,
                    translation: memory.lexeme.translation || '',
                    tenses: [],
                });
            }
            byVerb.get(id).tenses.push({
                tense: memory.key.split(':').pop(),
                reps: memory.reps,
                lapses: memory.lapses,
                stability: memory.stability,
                correctCount: memory.correctCount,
                due: memory.due,
            });
        }

        const verbs = [...byVerb.values()].map((entry) => {
            const practiced = entry.tenses.filter((t) => t.reps > 0);
            const mastery = practiced.length
                ? practiced.reduce((sum, t) => sum + Math.min(1, t.stability / KNOWN_STABILITY), 0)
                    / practiced.length
                : 0;
            return { ...entry, mastery: Math.round(mastery * 100) };
        }).sort((a, b) => b.mastery - a.mastery || b.tenses.length - a.tenses.length);

        return NextResponse.json({ verbs });
    } catch (error) {
        console.error('Conjugation stats error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
