import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';

// POST /api/books/[id]/audio — Upload audio file and trigger alignment
export async function POST(request, { params }) {
    try {
        const { id: bookId } = await params;
        const formData = await request.formData();
        const audioFile = formData.get('audio');

        if (!audioFile) {
            return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
        }

        // Verify book exists and get all pages
        const book = await prisma.book.findUnique({
            where: { id: bookId },
            include: { pages: { orderBy: { pageNumber: 'asc' } } },
        });

        if (!book) {
            return NextResponse.json({ error: 'Book not found' }, { status: 404 });
        }

        // Save audio file
        const ext = path.extname(audioFile.name) || '.mp3';
        const filename = `${bookId}${ext}`;
        const audioDir = path.join(process.cwd(), 'public', 'audio');
        await mkdir(audioDir, { recursive: true });
        const filePath = path.join(audioDir, filename);
        const buffer = Buffer.from(await audioFile.arrayBuffer());
        await writeFile(filePath, buffer);

        const audioUrl = `/audio/${filename}`;

        // Update book with audio URL
        await prisma.book.update({
            where: { id: bookId },
            data: { audioUrl },
        });

        // Call Python alignment service
        const pageTexts = book.pages.map(p => p.content);

        try {
            const alignRes = await fetch('http://127.0.0.1:8000/align', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_path: filePath,
                    pages: pageTexts,
                    language: book.language,
                }),
            });

            if (alignRes.ok) {
                const alignData = await alignRes.json();

                // Clear any old sync data for this book
                await prisma.audioSync.deleteMany({ where: { bookId } });

                // Store alignment entries
                if (alignData.alignment && alignData.alignment.length > 0) {
                    await prisma.audioSync.createMany({
                        data: alignData.alignment.map(entry => ({
                            bookId,
                            pageNumber: entry.pageNumber,
                            startTime: entry.startTime,
                            endTime: entry.endTime,
                            text: entry.text,
                        })),
                    });
                }

                return NextResponse.json({
                    audioUrl,
                    syncCount: alignData.alignment?.length || 0,
                    duration: alignData.duration,
                    status: 'synced',
                });
            } else {
                const err = await alignRes.text();
                console.error('Alignment failed:', err);
                return NextResponse.json({
                    audioUrl,
                    status: 'uploaded_no_sync',
                    error: 'Alignment failed — audio uploaded but sync not available',
                });
            }
        } catch (alignErr) {
            console.error('Alignment service unreachable:', alignErr.message);
            return NextResponse.json({
                audioUrl,
                status: 'uploaded_no_sync',
                error: 'Python service unreachable — audio uploaded but sync not available',
            });
        }
    } catch (error) {
        console.error('Audio upload error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// GET /api/books/[id]/audio — Get audio URL and sync status
export async function GET(request, { params }) {
    try {
        const { id: bookId } = await params;
        const book = await prisma.book.findUnique({
            where: { id: bookId },
            select: { audioUrl: true },
        });

        if (!book) {
            return NextResponse.json({ error: 'Book not found' }, { status: 404 });
        }

        const syncCount = await prisma.audioSync.count({ where: { bookId } });

        return NextResponse.json({
            audioUrl: book.audioUrl,
            hasSync: syncCount > 0,
            syncCount,
        });
    } catch (error) {
        console.error('Get audio error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
