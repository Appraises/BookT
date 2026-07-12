import { NextResponse } from 'next/server';
import { aiFetch } from '@/lib/aiService';

// POST /api/tts - Generate TTS audio via the local Python service
export async function POST(request) {
    try {
        const { word, language } = await request.json();

        const res = await aiFetch('/tts', {
            body: { text: word, language },
            timeoutMs: 20000,
        });

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
