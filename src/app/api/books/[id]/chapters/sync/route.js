import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { aiFetch, AIServiceError } from '@/lib/aiService';

// GET /api/books/[id]/chapters/sync?jobId=…&chapterId=…
// Polls an alignment job on the AI service. While running it relays progress;
// when the job finishes it persists the sentence sync for the chapter (the AI
// service hands the result out exactly once, so persistence runs once too).
export async function GET(request, { params }) {
    try {
        const { id: bookId } = await params;
        const { searchParams } = new URL(request.url);
        const jobId = searchParams.get('jobId');
        const chapterId = searchParams.get('chapterId');
        if (!jobId || !chapterId) {
            return NextResponse.json({ error: 'jobId and chapterId are required' }, { status: 400 });
        }

        const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
        if (!chapter || chapter.bookId !== bookId) {
            return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
        }

        let job;
        try {
            const res = await aiFetch(`/align-status/${jobId}`, { method: 'GET', timeoutMs: 10000 });
            job = await res.json();
        } catch (err) {
            if (err instanceof AIServiceError && err.status === 404) {
                // Job already consumed or the service restarted mid-alignment.
                return NextResponse.json({ status: 'uploaded_no_sync', error: 'Alignment job lost' });
            }
            throw err;
        }

        if (job.status === 'error') {
            return NextResponse.json({ status: 'uploaded_no_sync', error: job.error || 'Alignment failed' });
        }

        if (job.status !== 'done') {
            // queued | transcribing | aligning
            return NextResponse.json({ status: job.status, progress: job.progress ?? 0 });
        }

        const entries = job.result?.alignment || [];
        await prisma.$transaction(async (tx) => {
            await tx.audioSync.deleteMany({ where: { chapterId } });
            if (entries.length > 0) {
                await tx.audioSync.createMany({
                    data: entries.map(entry => ({
                        bookId,
                        chapterId,
                        pageNumber: entry.pageNumber + chapter.startPage - 1,
                        startTime: entry.startTime,
                        endTime: entry.endTime,
                        text: entry.text,
                    })),
                });
            }
        });

        return NextResponse.json({
            status: entries.length > 0 ? 'synced' : 'uploaded_no_sync',
            syncCount: entries.length,
            duration: job.result?.duration,
            audioUrl: chapter.audioUrl,
        });
    } catch (error) {
        console.error('Chapter sync poll error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
