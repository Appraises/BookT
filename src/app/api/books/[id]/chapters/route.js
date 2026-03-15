import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';

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

// POST /api/books/[id]/chapters/audio — Upload audio for a specific chapter
export async function POST(request, { params }) {
    try {
        const { id: bookId } = await params;
        const formData = await request.formData();
        const audioFile = formData.get('audio');
        const chapterId = formData.get('chapterId');

        if (!audioFile || !chapterId) {
            return NextResponse.json({ error: 'audio and chapterId are required' }, { status: 400 });
        }

        // Get chapter and book info
        const chapter = await prisma.chapter.findUnique({
            where: { id: chapterId },
            include: {
                book: {
                    include: { pages: { orderBy: { pageNumber: 'asc' } } }
                }
            },
        });

        if (!chapter || chapter.bookId !== bookId) {
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

        // Update chapter with audio URL
        await prisma.chapter.update({
            where: { id: chapterId },
            data: { audioUrl },
        });

        // Get only the pages for this chapter
        const chapterPages = chapter.book.pages
            .filter(p => p.pageNumber >= chapter.startPage && p.pageNumber <= chapter.endPage)
            .map(p => p.content);

        // Call Python alignment service
        try {
            const alignRes = await fetch('http://127.0.0.1:8000/align', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_path: filePath,
                    pages: chapterPages,
                    language: chapter.book.language,
                }),
            });

            if (alignRes.ok) {
                const alignData = await alignRes.json();
                console.log(`[AudioSync] Python returned: duration=${alignData.duration}, alignment_count=${alignData.alignment?.length}`);

                // Clear old sync data for this chapter
                await prisma.audioSync.deleteMany({ where: { chapterId } });

                // Store alignment entries (adjust page numbers to absolute)
                if (alignData.alignment && alignData.alignment.length > 0) {
                    const createData = alignData.alignment.map(entry => ({
                        bookId,
                        chapterId,
                        pageNumber: entry.pageNumber + chapter.startPage - 1, // relative -> absolute
                        startTime: entry.startTime,
                        endTime: entry.endTime,
                        text: entry.text,
                    }));
                    console.log(`[AudioSync] First mapped DB entry:`, createData[0]);

                    await prisma.audioSync.createMany({
                        data: createData,
                    });
                    console.log(`[AudioSync] Successfully saved ${createData.length} entries to DB`);
                } else {
                    console.log(`[AudioSync] WARNING: Python returned OK but alignment array is empty or missing!`);
                }

                return NextResponse.json({
                    audioUrl,
                    syncCount: alignData.alignment?.length || 0,
                    duration: alignData.duration,
                    status: 'synced',
                });
            } else {
                return NextResponse.json({
                    audioUrl,
                    status: 'uploaded_no_sync',
                    error: 'Alignment service returned an error',
                });
            }
        } catch (alignErr) {
            console.error('Alignment service unreachable:', alignErr.message);
            return NextResponse.json({
                audioUrl,
                status: 'uploaded_no_sync',
                error: 'Python service unreachable',
            });
        }
    } catch (error) {
        console.error('Chapter audio upload error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
