import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';
import { aiFetch, AIServiceError } from '@/lib/aiService';

// Kick off an async alignment job on the AI service for a chapter's audio.
// Returns { jobId } — progress and persistence happen via the /sync route.
async function startAlignJob(chapter, filePath) {
    const chapterPages = chapter.book.pages
        .filter(p => p.pageNumber >= chapter.startPage && p.pageNumber <= chapter.endPage)
        .map(p => p.content);

    const res = await aiFetch('/align-start', {
        body: { audio_path: filePath, pages: chapterPages, language: chapter.book.language },
        timeoutMs: 15000,
    });
    const data = await res.json();
    return data.job;
}

async function loadChapter(bookId, chapterId) {
    const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
        include: { book: { include: { pages: { orderBy: { pageNumber: 'asc' } } } } },
    });
    if (!chapter || chapter.bookId !== bookId) return null;
    return chapter;
}

// GET /api/books/[id]/chapters — List chapters for a book
export async function GET(request, { params }) {
    try {
        const { id: bookId } = await params;
        const chapters = await prisma.chapter.findMany({
            where: { bookId },
            orderBy: { number: 'asc' },
        });
        return NextResponse.json(chapters);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST /api/books/[id]/chapters — Upload audio for a specific chapter and
// start alignment. Responds as soon as the file is stored; the client follows
// job progress through GET /api/books/[id]/chapters/sync.
export async function POST(request, { params }) {
    try {
        const { id: bookId } = await params;
        const formData = await request.formData();
        const audioFile = formData.get('audio');
        const chapterId = formData.get('chapterId');

        if (!audioFile || !chapterId) {
            return NextResponse.json({ error: 'audio and chapterId are required' }, { status: 400 });
        }

        const chapter = await loadChapter(bookId, chapterId);
        if (!chapter) {
            return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
        }

        // Save audio file
        const ext = path.extname(audioFile.name) || '.mp3';
        const filename = `${bookId}_ch${chapter.number}${ext}`;
        const audioDir = path.join(process.cwd(), 'public', 'audio');
        await mkdir(audioDir, { recursive: true });
        const filePath = path.join(audioDir, filename);
        const buffer = Buffer.from(await audioFile.arrayBuffer());
        await writeFile(filePath, buffer);

        const audioUrl = `/audio/${filename}`;
        await prisma.chapter.update({
            where: { id: chapterId },
            data: { audioUrl },
        });

        try {
            const jobId = await startAlignJob(chapter, filePath);
            return NextResponse.json({ audioUrl, jobId, status: 'aligning' });
        } catch (alignErr) {
            const message = alignErr instanceof AIServiceError ? alignErr.message : 'Alignment failed';
            console.error('Chapter alignment start failed:', message);
            return NextResponse.json({ audioUrl, status: 'uploaded_no_sync', error: message });
        }
    } catch (error) {
        console.error('Chapter audio upload error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PUT /api/books/[id]/chapters — Re-sync a chapter using its already-uploaded
// audio (upgrades old coarse sync). Body: { chapterId }. Job-based like POST.
export async function PUT(request, { params }) {
    try {
        const { id: bookId } = await params;
        const { chapterId } = await request.json();
        if (!chapterId) {
            return NextResponse.json({ error: 'chapterId is required' }, { status: 400 });
        }

        const chapter = await loadChapter(bookId, chapterId);
        if (!chapter) {
            return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
        }
        if (!chapter.audioUrl) {
            return NextResponse.json({ error: 'Chapter has no audio to re-sync' }, { status: 400 });
        }

        const filePath = path.join(process.cwd(), 'public', ...chapter.audioUrl.split('/').filter(Boolean));
        try {
            const jobId = await startAlignJob(chapter, filePath);
            return NextResponse.json({ audioUrl: chapter.audioUrl, jobId, status: 'aligning' });
        } catch (alignErr) {
            const message = alignErr instanceof AIServiceError ? alignErr.message : 'Alignment failed';
            console.error('Chapter re-sync start failed:', message);
            return NextResponse.json({ audioUrl: chapter.audioUrl, status: 'uploaded_no_sync', error: message });
        }
    } catch (error) {
        console.error('Chapter re-sync error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
