import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { LEVEL } from '@/lib/status';

function createVocabSummary() {
    return {
        total: 0,
        learning: 0,
        known: 0,
        breakdown: {
            new: 0,
            recognized: 0,
            familiar: 0,
            known: 0,
        },
    };
}

function addStatusCount(vocab, status, count) {
    vocab.total += count;

    if (status === LEVEL.KNOWN) {
        vocab.known += count;
        vocab.breakdown.known += count;
        return;
    }

    vocab.learning += count;

    if (status === LEVEL.RECOGNIZED) vocab.breakdown.recognized += count;
    else if (status === LEVEL.FAMILIAR) vocab.breakdown.familiar += count;
    else vocab.breakdown.new += count;
}

async function getLanguageSummaries() {
    const [statusCounts, bookCounts] = await Promise.all([
        prisma.lexeme.groupBy({
            by: ['language', 'status'],
            _count: { status: true },
        }),
        prisma.book.groupBy({
            by: ['language'],
            _count: { language: true },
        }),
    ]);

    const summaries = new Map();

    const ensureSummary = (language) => {
        if (!summaries.has(language)) {
            summaries.set(language, {
                language,
                total: 0,
                learning: 0,
                known: 0,
                bookCount: 0,
            });
        }
        return summaries.get(language);
    };

    bookCounts.forEach((group) => {
        const summary = ensureSummary(group.language);
        summary.bookCount = group._count.language;
    });

    statusCounts.forEach((group) => {
        const count = group._count.status;
        const summary = ensureSummary(group.language);
        summary.total += count;

        if (group.status === LEVEL.KNOWN) summary.known += count;
        else summary.learning += count;
    });

    return [...summaries.values()].sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        return a.language.localeCompare(b.language);
    });
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        const languages = await getLanguageSummaries();

        if (!language) {
            return NextResponse.json({ languages });
        }

        // Parallel queries for speed
        const [statusCounts, skillStats, totalReviews, correctReviews, formsSeen] = await Promise.all([
            // Get counts of words grouped by status (1=New, 2=Recognized, 3=Familiar, 4=Known)
            prisma.lexeme.groupBy({
                by: ['status'],
                where: { language },
                _count: {
                    status: true,
                },
            }),
            prisma.skillMemory.groupBy({
                by: ['skill'],
                where: { lexeme: { language } },
                _count: { id: true },
                _sum: { reps: true },
            }),
            prisma.skillReview.count({ where: { memory: { lexeme: { language } } } }),
            prisma.skillReview.count({
                where: { rating: { gte: 3 }, memory: { lexeme: { language } } },
            }),
            prisma.userWord.count({ where: { language, isStudyable: true } }),
        ]);

        // Get count of cards due right now
        const now = new Date();
        const dueCount = await prisma.skillMemory.count({
            where: {
                lexeme: { language },
                due: { lte: now },
            },
        });

        // Format vocabulary progress
        const vocab = createVocabSummary();

        statusCounts.forEach((group) => {
            addStatusCount(vocab, group.status, group._count.status);
        });

        // Format flashcard statistics
        const reviewCount = totalReviews || 0;
        const correctCount = correctReviews || 0;
        const retentionRate = reviewCount > 0 ? Math.round((correctCount / reviewCount) * 100) : 0;

        const flashcards = {
            totalInDeck: skillStats.reduce((sum, group) => sum + group._count.id, 0),
            dueToday: dueCount,
            totalReviews: reviewCount,
            retentionRate,
            bySkill: Object.fromEntries(skillStats.map((group) => [group.skill, {
                cards: group._count.id,
                reviews: group._sum.reps || 0,
            }])),
        };

        return NextResponse.json({
            language,
            languages,
            vocab,
            formsSeen,
            flashcards,
        });
    } catch (error) {
        console.error('Failed to fetch stats:', error);
        return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
    }
}
