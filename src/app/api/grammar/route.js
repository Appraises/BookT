import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { previewSchedule, SKILL } from '@/lib/fsrs';
import { normalizeWord } from '@/lib/normalizer';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
        if (!language) {
            return NextResponse.json({ error: 'language is required' }, { status: 400 });
        }

        const now = new Date();
        const memories = await prisma.skillMemory.findMany({
            where: {
                skill: SKILL.GRAMMAR,
                due: { lte: now },
                grammarEncounter: { language, confidence: { not: 'low' } },
            },
            include: { grammarEncounter: true },
            orderBy: [{ due: 'asc' }, { reps: 'asc' }],
            take: limit,
        });

        const [due, reviewed, total] = await Promise.all([
            prisma.skillMemory.count({
                where: {
                    skill: SKILL.GRAMMAR,
                    due: { lte: now },
                    grammarEncounter: { language, confidence: { not: 'low' } },
                },
            }),
            prisma.skillMemory.count({
                where: {
                    skill: SKILL.GRAMMAR,
                    reps: { gt: 0 },
                    grammarEncounter: { language, confidence: { not: 'low' } },
                },
            }),
            prisma.grammarEncounter.count({ where: { language, confidence: { not: 'low' } } }),
        ]);

        return NextResponse.json({
            cards: memories.map((memory) => ({
                id: memory.grammarEncounter.id,
                memoryKey: memory.key,
                word: memory.grammarEncounter.word,
                lemma: memory.grammarEncounter.lemma,
                sentence: memory.grammarEncounter.sentence,
                caseCode: memory.grammarEncounter.caseCode,
                caseLabel: memory.grammarEncounter.caseLabel,
                pattern: memory.grammarEncounter.pattern,
                reason: memory.grammarEncounter.reason,
                source: memory.grammarEncounter.source,
                confidence: memory.grammarEncounter.confidence,
                preview: previewSchedule(memory, now),
            })),
            stats: { due, reviewed, total },
        });
    } catch (error) {
        console.error('Grammar fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { id, answer = '' } = await request.json();
        const encounter = await prisma.grammarEncounter.findUnique({ where: { id } });
        if (!encounter) {
            return NextResponse.json({ error: 'Grammar encounter not found' }, { status: 404 });
        }
        const correct = normalizeWord(answer.trim()) === normalizeWord(encounter.word);
        return NextResponse.json({
            correct,
            expected: encounter.word,
            lemma: encounter.lemma,
            caseLabel: encounter.caseLabel,
            reason: encounter.reason,
            pattern: encounter.pattern,
        });
    } catch (error) {
        console.error('Grammar check error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
