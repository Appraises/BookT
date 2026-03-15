import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');

        if (!language) {
            return NextResponse.json({ error: 'Language is required' }, { status: 400 });
        }

        // Parallel queries for speed
        const [statusCounts, flashcardStats] = await Promise.all([
            // Get counts of words grouped by status (1=New, 2=Recognized, 3=Familiar, 4=Known)
            prisma.userWord.groupBy({
                by: ['status'],
                where: { language },
                _count: {
                    status: true,
                },
            }),
            // Flashcard deck stats
            prisma.userWord.aggregate({
                where: {
                    language,
                    status: { in: ['1', '2', '3'] }, // Only cards still in learning
                },
                _count: {
                    id: true,
                },
                _sum: {
                    reviewCount: true,
                    correctCount: true,
                },
            }),
        ]);

        // Get count of cards due right now
        const now = new Date();
        const dueCount = await prisma.userWord.count({
            where: {
                language,
                status: { in: ['1', '2', '3'] },
                nextReview: {
                    lte: now,
                },
            },
        });

        // Format vocabulary progress
        const vocab = {
            total: 0,
            learning: 0, // NEW (1) + RECOGNIZED (2) + FAMILIAR (3)
            known: 0,    // KNOWN (4)
            breakdown: {
                new: 0,
                recognized: 0,
                familiar: 0,
                known: 0,
            }
        };

        statusCounts.forEach((group) => {
            const count = group._count.status;
            vocab.total += count;

            if (group.status === '4' || group.status === 'KNOWN') {
                vocab.known += count;
                vocab.breakdown.known += count;
            } else {
                vocab.learning += count;
                if (group.status === '1') vocab.breakdown.new += count;
                if (group.status === '2') vocab.breakdown.recognized += count;
                if (group.status === '3') vocab.breakdown.familiar += count;
            }
        });

        // Format flashcard statistics
        const reviewCount = flashcardStats._sum.reviewCount || 0;
        const correctCount = flashcardStats._sum.correctCount || 0;
        const retentionRate = reviewCount > 0 ? Math.round((correctCount / reviewCount) * 100) : 0;

        const flashcards = {
            totalInDeck: flashcardStats._count.id || 0,
            dueToday: dueCount,
            totalReviews: reviewCount,
            retentionRate,
        };

        return NextResponse.json({
            language,
            vocab,
            flashcards,
        });
    } catch (error) {
        console.error('Failed to fetch stats:', error);
        return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
    }
}
