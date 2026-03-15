import { NextResponse } from 'next/server';

// POST /api/tts - Generate TTS audio via Qwen3-TTS (local Python service)
export async function POST(request) {
    try {
        const { word, language } = await request.json();

        // Call local Python TTS service
        const res = await fetch('http://localhost:8000/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: word, language }),
        });

        if (!res.ok) {
            throw new Error('TTS service unavailable');
        }

        const audioBuffer = await res.arrayBuffer();
        return new NextResponse(audioBuffer, {
            headers: {
                'Content-Type': 'audio/wav',
                'Cache-Control': 'public, max-age=86400',
            },
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 503 });
    }
}
