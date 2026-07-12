import prisma from '@/lib/prisma';
import { normalizeWord } from '@/lib/normalizer';
import { LEVEL } from '@/lib/status';
import { NextResponse } from 'next/server';

// POST /api/vocabulary/expose
// Body: { words: string[], language: string }
// Records that these words were seen on a page-view. New words gently promote
// to Recognized only after being exposed EXPOSURE_PROMOTE_THRESHOLD times —
// replacing the old "one page-turn = Recognized" behavior.
export async function POST(request) {
    try {
        const { words, language } = await request.json();
        if (!Array.isArray(words) || !language) {
            return NextResponse.json({ error: 'words[] and language are required' }, { status: 400 });
        }

        const normalized = [...new Set(words.map(normalizeWord).filter(Boolean))];
        if (normalized.length === 0) {
            return NextResponse.json({ promoted: [] });
        }

        // Exposure is passive evidence. It changes prioritization, never the
        // learner's demonstrated knowledge level.
        await prisma.userWord.updateMany({
            where: { language, word: { in: normalized }, status: { not: LEVEL.IGNORED } },
            data: { exposureCount: { increment: 1 }, lastSeen: new Date() },
        });

        const linked = await prisma.userWord.findMany({
            where: {
                language,
                word: { in: normalized },
                lexemeId: { not: null },
            },
            select: { lexemeId: true },
        });
        for (const lexemeId of new Set(linked.map((item) => item.lexemeId).filter(Boolean))) {
            await prisma.lexeme.update({
                where: { id: lexemeId },
                data: { exposureCount: { increment: 1 }, lastSeen: new Date() },
            });
        }

        return NextResponse.json({ promoted: [], exposed: normalized.length });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
