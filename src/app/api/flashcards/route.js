import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET /api/flashcards?language=fr&limit=20
// Fetch words due for review (Anki-style)
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        const limit = parseInt(searchParams.get('limit') || '20');

        if (!language) {
            return NextResponse.json({ error: 'language is required' }, { status: 400 });
        }

        const now = new Date();

        // Get words that are due for review:
        // - Status 2 (Recognized) or 3 (Familiar)
        // - nextReview is null (never reviewed) OR nextReview <= now (due)
        const dueWords = await prisma.userWord.findMany({
            where: {
                language,
                status: { in: ['2', '3'] },
                OR: [
                    { nextReview: null },
                    { nextReview: { lte: now } },
                ],
            },
            orderBy: [
                { nextReview: 'asc' }, // Most overdue first
            ],
            take: limit,
        });

        // For each word, fetch its cached translation
        const wordsWithTranslations = await Promise.all(
            dueWords.map(async (uw) => {
                const cached = await prisma.word.findUnique({
                    where: { word_language: { word: uw.word, language: uw.language } },
                });
                return {
                    word: uw.word,
                    language: uw.language,
                    status: parseInt(uw.status) || 2,
                    interval: uw.interval,
                    easeFactor: uw.easeFactor,
                    reviewCount: uw.reviewCount,
                    correctCount: uw.correctCount,
                    nextReview: uw.nextReview,
                    translation: cached?.translation || '',
                    meanings: cached?.meanings ? JSON.parse(cached.meanings) : [],
                    ipa: cached?.ipa || '',
                };
            })
        );

        // Also get stats
        const [totalDue, totalReviewed, totalWords] = await Promise.all([
            prisma.userWord.count({
                where: {
                    language,
                    status: { in: ['2', '3'] },
                    OR: [{ nextReview: null }, { nextReview: { lte: now } }],
                },
            }),
            prisma.userWord.count({
                where: { language, reviewCount: { gt: 0 } },
            }),
            prisma.userWord.count({ where: { language } }),
        ]);

        return NextResponse.json({
            cards: wordsWithTranslations,
            stats: {
                due: totalDue,
                reviewed: totalReviewed,
                total: totalWords,
            },
        });
    } catch (error) {
        console.error('Flashcard fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
