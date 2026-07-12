import prisma from '@/lib/prisma';
import { normalizeWord } from '@/lib/normalizer';
import { toLevel, LEVEL } from '@/lib/status';
import { ensureLexemesForWords, setLexemeStatusForForm } from '@/lib/learning';
import { NextResponse } from 'next/server';

// PATCH /api/vocabulary/:word - Set a single word's knowledge level (upsert).
export async function PATCH(request, { params }) {
    try {
        const { word: rawWord } = await params;
        const body = await request.json();
        const { language } = body;
        const word = normalizeWord(decodeURIComponent(rawWord));

        if (!word || !language) {
            return NextResponse.json({ error: 'valid word and language are required' }, { status: 400 });
        }

        // Manual name override: mark a word as (non-)studyable, e.g. a name the
        // capitalization heuristic missed. Applies to every form of its lexeme so
        // the flashcard deck picks up the change immediately.
        if (typeof body.isStudyable === 'boolean') {
            const form = await prisma.userWord.findUnique({
                where: { word_language: { word, language } },
            });
            if (!form) return NextResponse.json({ error: 'word not found' }, { status: 404 });
            if (!form.lexemeId) await ensureLexemesForWords([word], language);
            const scope = form.lexemeId ? { lexemeId: form.lexemeId } : { word, language };
            await prisma.userWord.updateMany({ where: scope, data: { isStudyable: body.isStudyable } });
            return NextResponse.json(
                await prisma.userWord.findUnique({ where: { word_language: { word, language } } })
            );
        }

        const status = toLevel(body.status, NaN);
        if (Number.isNaN(status) || status < LEVEL.IGNORED || status > LEVEL.KNOWN) {
            return NextResponse.json(
                { error: 'valid word, language and status (0..4) are required' },
                { status: 400 }
            );
        }

        // Upsert so setting a level never 500s on a word not yet in the table.
        const updated = await prisma.userWord.upsert({
            where: { word_language: { word, language } },
            update: { status, lastSeen: new Date() },
            create: { word, language, status, bookId: body.bookId ?? null },
        });

        if (!updated.lexemeId) await ensureLexemesForWords([word], language);
        await setLexemeStatusForForm(word, language, status);

        return NextResponse.json(
            await prisma.userWord.findUnique({ where: { word_language: { word, language } } })
        );
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
