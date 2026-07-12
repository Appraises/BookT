import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import path from 'path';

// GET /api/books/:id - Get book details
export async function GET(request, { params }) {
    try {
        const { id } = await params;
        const book = await prisma.book.findUnique({ where: { id } });
        if (!book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });
        return NextResponse.json(book);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PATCH /api/books/:id - Update reading progress
export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const data = await request.json();
        const book = await prisma.book.update({
            where: { id },
            data: { currentPage: data.currentPage, updatedAt: new Date() },
        });
        return NextResponse.json(book);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE /api/books/:id - Delete a book (and its chapter audio files)
export async function DELETE(request, { params }) {
    try {
        const { id } = await params;

        const chapters = await prisma.chapter.findMany({
            where: { bookId: id, audioUrl: { not: null } },
            select: { audioUrl: true },
        });

        await prisma.book.delete({ where: { id } });

        // Clean up audio files under public/ so deletes don't leave orphans
        await Promise.allSettled(
            chapters.map(({ audioUrl }) =>
                rm(path.join(process.cwd(), 'public', ...audioUrl.split('/').filter(Boolean)), { force: true })
            )
        );

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
