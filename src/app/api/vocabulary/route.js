import prisma from '@/lib/prisma';
import { normalizeWord, isLearnableWord } from '@/lib/normalizer';
import { LEVEL, toLevel } from '@/lib/status';
import { ensureLexemesForWords } from '@/lib/learning';
import { NextResponse } from 'next/server';

// GET /api/vocabulary?language=pl&status=2&bookId=… - List user vocabulary
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const bookId = searchParams.get('bookId');
        const language = searchParams.get('language');

        const where = {};
        if (status) where.status = status;
        if (bookId) where.bookId = bookId;
        if (language) where.language = language;

        const words = await prisma.userWord.findMany({
            where,
            orderBy: { firstSeen: 'desc' },
        });
        return NextResponse.json(words);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST /api/vocabulary - Bulk mark words as seen (for a page)
export async function POST(request) {
    try {
        const { words, language, bookId, properNouns } = await request.json();

        if (!Array.isArray(words) || !language) {
            return NextResponse.json({ error: 'words[] and language are required' }, { status: 400 });
        }

        const normalized = [...new Set(words.map(normalizeWord).filter(isLearnableWord))];
        if (normalized.length === 0) {
            return NextResponse.json({ added: 0 });
        }

        // Names detected by the reader's capitalization heuristic — kept out of study.
        const properNounSet = new Set(
            (Array.isArray(properNouns) ? properNouns : []).map(normalizeWord).filter(Boolean)
        );

        // Two queries instead of one findUnique+create per word
        const existing = await prisma.userWord.findMany({
            where: { language, word: { in: normalized } },
            select: { word: true },
        });
        const existingSet = new Set(existing.map((w) => w.word));
        const toCreate = normalized.filter((w) => !existingSet.has(w));

        if (toCreate.length > 0) {
            await prisma.userWord.createMany({
                data: toCreate.map((word) => ({
                    word, language, bookId, status: LEVEL.NEW,
                    isStudyable: !properNounSet.has(word),
                })),
            });
        }

        await ensureLexemesForWords(normalized, language, properNounSet);

        return NextResponse.json({ added: toCreate.length });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PATCH /api/vocabulary - Bulk status update (e.g. auto-mark page words as Recognized)
// Body: { words: string[], status: number, language: string, onlyBelow?: boolean }
// onlyBelow (default true) restricts the update to words still New so a bulk
// "mark as recognized" never downgrades words the user rated higher.
export async function PATCH(request) {
    try {
        const body = await request.json();
        const { words, language, onlyBelow = true } = body;
        const status = toLevel(body.status, NaN);

        if (!Array.isArray(words) || Number.isNaN(status) || !language) {
            return NextResponse.json({ error: 'words[], numeric status and language are required' }, { status: 400 });
        }

        const normalized = [...new Set(words.map(normalizeWord).filter(Boolean))];
        if (normalized.length === 0) {
            return NextResponse.json({ updated: 0 });
        }

        const where = {
            language,
            word: { in: normalized },
            // only promote words still being learned (New..below target); never
            // touch Ignored(0) or words already at/above the target level.
            ...(onlyBelow ? { status: { gte: LEVEL.NEW, lt: status } } : {}),
        };

        const result = await prisma.userWord.updateMany({
            where,
            data: { status, lastSeen: new Date() },
        });

        return NextResponse.json({ updated: result.count });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
