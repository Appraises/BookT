import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET /api/books/:id/pages/:pageNumber - Get page content
export async function GET(request, { params }) {
    try {
        const { id, pageNumber } = await params;
        const page = await prisma.page.findUnique({
            where: {
                bookId_pageNumber: {
                    bookId: id,
                    pageNumber: parseInt(pageNumber),
                },
            },
        });
        if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
        return NextResponse.json(page);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
