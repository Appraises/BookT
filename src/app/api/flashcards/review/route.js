import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import {
    cardToMemoryData,
    memoryKey,
    scheduleReview,
    SKILL,
    statusFromSkillMemories,
} from '@/lib/fsrs';

async function resolveMemory(body) {
    if (body.memoryKey) {
        return prisma.skillMemory.findUnique({ where: { key: body.memoryKey } });
    }
    if (body.lexemeId && body.skill) {
        return prisma.skillMemory.findUnique({
            where: { key: memoryKey(body.lexemeId, body.skill) },
        });
    }
    if (body.word && body.language) {
        const form = await prisma.userWord.findUnique({
            where: { word_language: { word: body.word, language: body.language } },
        });
        if (!form?.lexemeId) return null;
        return prisma.skillMemory.findUnique({
            where: { key: memoryKey(form.lexemeId, body.skill || SKILL.RECOGNITION) },
        });
    }
    return null;
}

// POST /api/flashcards/review
// Body: { memoryKey, quality: 1..4 }
export async function POST(request) {
    try {
        const body = await request.json();
        const quality = body.quality;
        if (!Number.isInteger(quality) || quality < 1 || quality > 4) {
            return NextResponse.json({ error: 'quality (1..4) is required' }, { status: 400 });
        }

        const memory = await resolveMemory(body);
        if (!memory) {
            return NextResponse.json({ error: 'Skill memory not found' }, { status: 404 });
        }

        const now = new Date();
        const scheduled = scheduleReview(memory, quality, now);
        const data = cardToMemoryData(scheduled.card);
        const isCorrect = quality >= 3;
        const updated = await prisma.$transaction(async (tx) => {
            const next = await tx.skillMemory.update({
                where: { id: memory.id },
                data: {
                    ...data,
                    correctCount: isCorrect ? { increment: 1 } : undefined,
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

        let status = null;
        if (updated.lexemeId && updated.skill !== SKILL.GRAMMAR) {
            const skills = await prisma.skillMemory.findMany({
                where: { lexemeId: updated.lexemeId, skill: { in: [SKILL.RECOGNITION, SKILL.PRODUCTION] } },
            });
            status = statusFromSkillMemories(skills);
            await prisma.$transaction([
                prisma.lexeme.update({ where: { id: updated.lexemeId }, data: { status } }),
                prisma.userWord.updateMany({
                    where: { lexemeId: updated.lexemeId },
                    data: { status, lastReviewed: now },
                }),
            ]);
        }

        return NextResponse.json({
            memoryKey: updated.key,
            skill: updated.skill,
            status,
            due: updated.due,
            stability: updated.stability,
            difficulty: updated.difficulty,
            reps: updated.reps,
            lapses: updated.lapses,
        });
    } catch (error) {
        console.error('Review error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
