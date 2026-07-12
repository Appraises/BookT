import prisma from '@/lib/prisma';
import { normalizeWord } from '@/lib/normalizer';
import { NextResponse } from 'next/server';

// POST /api/vocabulary/context
// Body: { word, language, sentence, audioUrl?, start?, end? }
// Stores the sentence a word was studied in (and the aligned audio clip, when
// available) so flashcards can show it in context.
export async function POST(request) {
    try {
        const body = await request.json();
        const { language, sentence } = body;
        const word = normalizeWord(body.word || '');

        if (!word || !language || !sentence) {
            return NextResponse.json({ error: 'word, language and sentence are required' }, { status: 400 });
        }

        const result = await prisma.userWord.updateMany({
            where: { word, language },
            data: {
                contextSentence: sentence.slice(0, 600),
                contextAudioUrl: body.audioUrl ?? null,
                contextStart: typeof body.start === 'number' ? body.start : null,
                contextEnd: typeof body.end === 'number' ? body.end : null,
            },
        });

        const form = await prisma.userWord.findUnique({
            where: { word_language: { word, language } },
            select: { lexemeId: true },
        });
        if (form?.lexemeId) {
            await prisma.lexeme.update({
                where: { id: form.lexemeId },
                data: {
                    contextSentence: sentence.slice(0, 600),
                    contextAudioUrl: body.audioUrl ?? null,
                    contextStart: typeof body.start === 'number' ? body.start : null,
                    contextEnd: typeof body.end === 'number' ? body.end : null,
                    lastSeen: new Date(),
                },
            });
            if (body.audioUrl) {
                await prisma.skillMemory.upsert({
                    where: { key: `${form.lexemeId}:listening` },
                    update: {},
                    create: {
                        key: `${form.lexemeId}:listening`,
                        lexemeId: form.lexemeId,
                        skill: 'listening',
                    },
                });
            }
        }

        return NextResponse.json({ updated: result.count });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
