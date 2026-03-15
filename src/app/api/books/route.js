import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET /api/books - List all books
export async function GET() {
    try {
        const books = await prisma.book.findMany({
            orderBy: { updatedAt: 'desc' },
        });
        return NextResponse.json(books);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST /api/books - Create a new book
export async function POST(request) {
    try {
        const { title, language, totalPages, pages, chapters } = await request.json();

        const book = await prisma.book.create({
            data: {
                title,
                language,
                totalPages,
                pages: {
                    create: pages.map((p) => ({
                        pageNumber: p.pageNumber,
                        content: p.content,
                    })),
                },
                chapters: chapters && chapters.length > 0 ? {
                    create: chapters.map((ch) => ({
                        number: ch.number,
                        title: ch.title,
                        startPage: ch.startPage,
                        endPage: ch.endPage,
                    })),
                } : undefined,
            },
            include: { chapters: true },
        });

        return NextResponse.json(book, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
