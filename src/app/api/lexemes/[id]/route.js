import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// PATCH /api/lexemes/:id — Correct a lexeme's translation (and optionally its
// short meaning list) by hand, for flashcards where the machine translation is
// wrong. Keeps the Word cache in sync so a later lookup serves the fix too.
export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const body = await request.json();
        const translation = typeof body.translation === 'string' ? body.translation.trim() : null;

        if (!translation) {
            return NextResponse.json({ error: 'translation is required' }, { status: 400 });
        }

        const lexeme = await prisma.lexeme.findUnique({ where: { id } });
        if (!lexeme) {
            return NextResponse.json({ error: 'lexeme not found' }, { status: 404 });
        }

        const meanings = JSON.stringify([{ meaning: translation, partOfSpeech: lexeme.partOfSpeech || '' }]);
        await prisma.lexeme.update({
            where: { id },
            data: { translation, meanings },
        });

        // The Word cache is keyed by the lemma — refresh it so the reader and
        // future deck backfills don't reintroduce the old machine translation.
        await prisma.word.upsert({
            where: { word_language: { word: lexeme.lemma, language: lexeme.language } },
            update: { translation, meanings },
            create: { word: lexeme.lemma, language: lexeme.language, translation, meanings },
        });

        return NextResponse.json({ id, translation, meanings });
    } catch (error) {
        console.error('Lexeme edit error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
