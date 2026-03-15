import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET /api/vocabulary - List user vocabulary
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');
        const bookId = searchParams.get('bookId');

        const where = {};
        if (status) where.status = status;
        if (bookId) where.bookId = bookId;

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
        const { words, language, bookId } = await request.json();

        // Upsert each word — if already exists, skip
        const results = [];
        for (const word of words) {
            const normalized = word.toLowerCase().replace(/[^\p{L}\p{N}\-']/gu, '').trim();
            if (!normalized) continue;

            try {
                const existing = await prisma.userWord.findUnique({
                    where: { word_language: { word: normalized, language } },
                });
                if (!existing) {
                    const created = await prisma.userWord.create({
                        data: { word: normalized, language, bookId, status: 'NEW' },
                    });
                    results.push(created);
                }
            } catch (e) {
                // Skip duplicates
            }
        }

        return NextResponse.json({ added: results.length });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
