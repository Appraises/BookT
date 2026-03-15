import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

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

// DELETE /api/books/:id - Delete a book
export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        await prisma.book.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
