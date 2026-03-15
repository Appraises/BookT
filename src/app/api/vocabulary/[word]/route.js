import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// PATCH /api/vocabulary/:word - Update word status
export async function PATCH(request, { params }) {
    try {
        const { word: rawWord } = await params;
        const { status, language } = await request.json();
        const word = decodeURIComponent(rawWord);

        const updated = await prisma.userWord.update({
            where: { word_language: { word, language } },
            data: { status },
        });

        return NextResponse.json(updated);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
