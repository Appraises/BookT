import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// GET /api/books/[id]/sync?page=N — Get sync entries for a specific page
export async function GET(request, { params }) {
    try {
        const { id: bookId } = await params;
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page'));

        if (!page) {
            return NextResponse.json({ error: 'page parameter required' }, { status: 400 });
        }

        const syncEntries = await prisma.audioSync.findMany({
            where: { bookId, pageNumber: page },
            orderBy: { startTime: 'asc' },
        });

        return NextResponse.json(syncEntries);
    } catch (error) {
        console.error('Sync fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
