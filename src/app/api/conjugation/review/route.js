import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import {
    cardToMemoryData,
    conjugationMemoryKey,
    scheduleReview,
    SKILL,
} from '@/lib/fsrs';

const VALID_TENSES = new Set(['présent', 'imparfait', 'futur-simple', 'passé-composé']);

// Accuracy over the six persons maps onto the FSRS rating: a perfect table is
// Easy, one slip is Good, roughly half is Hard, worse is Again.
function qualityFromScore(correct, total) {
    if (correct >= total) return 4;
    if (correct >= total - 1) return 3;
    if (correct >= Math.ceil(total / 2)) return 2;
    return 1;
}

// POST /api/conjugation/review
// Body: { lexemeId, tense, correct, total }
export async function POST(request) {
    try {
        const { lexemeId, tense, correct, total } = await request.json();
        if (!lexemeId || !VALID_TENSES.has(tense)
            || !Number.isInteger(correct) || !Number.isInteger(total) || total < 1) {
            return NextResponse.json(
                { error: 'lexemeId, valid tense, correct and total are required' },
                { status: 400 }
            );
        }

        const lexeme = await prisma.lexeme.findUnique({ where: { id: lexemeId } });
        if (!lexeme) {
            return NextResponse.json({ error: 'lexeme not found' }, { status: 404 });
        }

        const key = conjugationMemoryKey(lexemeId, tense);
        const memory = await prisma.skillMemory.upsert({
            where: { key },
            update: {},
            create: { key, lexemeId, skill: SKILL.CONJUGATION },
        });

        const now = new Date();
        const quality = qualityFromScore(correct, total);
        const scheduled = scheduleReview(memory, quality, now);
        const data = cardToMemoryData(scheduled.card);

        const updated = await prisma.$transaction(async (tx) => {
            const next = await tx.skillMemory.update({
                where: { id: memory.id },
                data: {
                    ...data,
                    correctCount: quality >= 3 ? { increment: 1 } : undefined,
                },
            });
            await tx.skillReview.create({
                data: {
                    memoryId: memory.id,
                    rating: quality,
                    state: scheduled.log.state,
                    due: new Date(scheduled.log.due),
                    stability: scheduled.log.stability,
                    difficulty: scheduled.log.difficulty,
                    elapsedDays: scheduled.log.elapsed_days,
                    scheduledDays: scheduled.log.scheduled_days,
                    reviewedAt: now,
                },
            });
            return next;
        });

        return NextResponse.json({
            memoryKey: updated.key,
            quality,
            due: updated.due,
            stability: updated.stability,
            reps: updated.reps,
            lapses: updated.lapses,
        });
    } catch (error) {
        console.error('Conjugation review error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
